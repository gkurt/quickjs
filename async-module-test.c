/*
 * Proves that a module graph loads without the host ever blocking.
 *
 * The "network" here settles each request a deliberate number of event loop
 * turns later, and in an order unrelated to the order the requests arrive in.
 * Between turns the host does unrelated work and prints a tick, so a
 * synchronous loader would show up as a gap in the tick sequence.
 */
#include <stdio.h>
#include <string.h>
#include <stdlib.h>
#include <stdbool.h>
#include <stdint.h>
#include "quickjs.h"

typedef struct {
    const char *name;
    const char *source;
    int latency; /* turns to wait before settling */
} FakeFile;

/* A diamond (b and c both import d), a cycle (e <-> f), and a deep chain.
   Latencies are chosen so replies come back in a different order than asked. */
static const FakeFile files[] = {
    { "b.js", "import { d } from './d.js';\nexport const b = 'b(' + d + ')';\n", 3 },
    { "c.js", "import { d } from './d.js';\nexport const c = 'c(' + d + ')';\n", 1 },
    { "d.js", "export const d = 'd';\n", 4 },
    { "e.js", "import { f } from './f.js';\nexport const e = 'e';\nexport const ef = () => f;\n", 2 },
    { "f.js", "import { e } from './e.js';\nexport const f = 'f';\nexport const fe = () => e;\n", 5 },
    { "g.js", "import { h } from './h.js';\nexport const g = 'g>' + h;\n", 1 },
    { "h.js", "import { i } from './i.js';\nexport const h = 'h>' + i;\n", 1 },
    { "i.js", "export const i = 'i';\n", 1 },
    /* dynamic import inside a statically loaded module */
    { "dyn.js",
      "export async function pull() {\n"
      "  const m = await import('./g.js');\n"
      "  return 'dyn:' + m.g;\n"
      "}\n", 2 },
    /* a graph whose dependency 404s, for the reclamation test */
    { "broken.js", "import { z } from './nope.js';\nexport const q = z;\n", 1 },
    /* reports the url the host gave it, for the import.meta test */
    { "meta.js", "export const where = import.meta.url;\n", 2 },
    /* victim.js reaches back into the host from its own module body, which is the
       one moment it is EVALUATING and sitting on an evaluation stack. leaf.js gives
       that stack a second entry so a spliced chain has somewhere to go wrong. */
    { "leaf.js", "export const leaf = 'leaf';\n", 1 },
    { "victim.js",
      "import { leaf } from './leaf.js';\n"
      "export const victim = 'victim:' + leaf;\n"
      "pumpJobs();\n", 1 },
};

typedef struct PendingLoad {
    struct PendingLoad *next;
    JSModuleLoadHandle *handle;
    char *name;
    int turns_left;
} PendingLoad;

typedef struct {
    PendingLoad *pending;
    int requests;
    int fetches_started;
} FakeNet;

static const FakeFile *find_file(const char *name)
{
    const char *base;
    size_t i;

    /* the loader is handed a normalized path; compare on the basename */
    base = strrchr(name, '/');
    base = base ? base + 1 : name;
    for (i = 0; i < sizeof(files) / sizeof(files[0]); i++)
        if (!strcmp(files[i].name, base))
            return &files[i];
    return NULL;
}

static void fake_loader(JSContext *ctx, const char *module_name,
                        JSValueConst attributes, void *opaque,
                        JSModuleLoadHandle *handle)
{
    FakeNet *net = opaque;
    const FakeFile *f = find_file(module_name);
    PendingLoad *p;

    net->requests++;
    net->fetches_started++;
    printf("    [net] request  %-24s (in flight: %d)\n", module_name,
           net->fetches_started);

    p = malloc(sizeof(*p));
    p->handle = handle;
    p->name = strdup(module_name);
    p->turns_left = f ? f->latency : 1;
    p->next = net->pending;
    net->pending = p;
}

/* Settles everything whose latency has elapsed. Returns true if any remain. */
static bool net_tick(JSContext *ctx, FakeNet *net, int turn)
{
    PendingLoad **pp = &net->pending;
    bool any_left = false;

    while (*pp) {
        PendingLoad *p = *pp;
        if (--p->turns_left <= 0) {
            const FakeFile *f = find_file(p->name);
            *pp = p->next;
            net->fetches_started--;
            if (f) {
                printf("    [net] deliver  %-24s (turn %d)\n", p->name, turn);
                JS_FulfillModuleLoad(ctx, p->handle, f->source, strlen(f->source));
            } else {
                JSValue err = JS_NewError(ctx);
                printf("    [net] 404      %-24s (turn %d)\n", p->name, turn);
                JS_SetPropertyStr(ctx, err, "message",
                                  JS_NewString(ctx, "module not found"));
                JS_RejectModuleLoad(ctx, p->handle, err);
                JS_FreeValue(ctx, err);
            }
            free(p->name);
            free(p);
        } else {
            any_left = true;
            pp = &p->next;
        }
    }
    return any_left;
}

typedef struct {
    int settled; /* 0 pending, 1 fulfilled, 2 rejected */
    JSValue value;
} Result;

static JSValue on_settled(JSContext *ctx, JSValueConst this_val,
                          int argc, JSValueConst *argv, int magic,
                          JSValueConst *func_data)
{
    Result *r;
    int64_t p = 0;

    JS_ToInt64(ctx, &p, func_data[0]);
    r = (Result *)(intptr_t)p;
    r->settled = magic;
    r->value = JS_DupValue(ctx, argv[0]);
    return JS_UNDEFINED;
}

static void track(JSContext *ctx, JSValueConst promise, Result *r)
{
    JSValue funcs[2], ret, then;
    JSValue holder = JS_NewInt64(ctx, (int64_t)(intptr_t)r);

    funcs[0] = JS_NewCFunctionData(ctx, on_settled, 1, 1, 1, (JSValueConst *)&holder);
    funcs[1] = JS_NewCFunctionData(ctx, on_settled, 1, 2, 1, (JSValueConst *)&holder);
    JS_FreeValue(ctx, holder);

    then = JS_GetPropertyStr(ctx, promise, "then");
    ret = JS_Call(ctx, then, promise, 2, (JSValueConst *)funcs);
    JS_FreeValue(ctx, then);
    JS_FreeValue(ctx, ret);
    JS_FreeValue(ctx, funcs[0]);
    JS_FreeValue(ctx, funcs[1]);
}

/* Drives the loop the way a host would: deliver whatever the network has,
   drain the job queue, repeat. Never blocks on a fetch. */
static int pump(JSContext *ctx, JSRuntime *rt, FakeNet *net, Result *r)
{
    int turn = 0, ticks = 0;

    while (r->settled == 0 && turn < 200) {
        JSContext *c;

        turn++;
        ticks++; /* unrelated host work: the thread that must never block */
        net_tick(ctx, net, turn);
        while (JS_ExecutePendingJob(rt, &c) > 0)
            ;
        if (net->pending == NULL && !JS_IsJobPending(rt))
            break;
    }
    printf("    [host] %d turns of unrelated work while loading\n", ticks);
    return turn;
}

static int failures = 0;

static void check(const char *what, bool ok)
{
    printf("  %s %s\n", ok ? "PASS" : "FAIL", what);
    if (!ok)
        failures++;
}

static void run_case(const char *title, const char *root_src,
                     bool expect_ok, const char *expect_export,
                     const char *expect_value)
{
    JSRuntime *rt;
    JSContext *ctx;
    FakeNet net;
    Result r;
    JSValue promise;

    printf("\n== %s ==\n", title);
    memset(&net, 0, sizeof(net));
    memset(&r, 0, sizeof(r));
    r.value = JS_UNDEFINED;

    rt = JS_NewRuntime();
    ctx = JS_NewContext(rt);
    JS_SetModuleLoaderFuncAsync(rt, NULL, fake_loader, NULL, &net);

    promise = JS_EvalModuleAsync(ctx, root_src, strlen(root_src), "root.js");
    if (JS_IsException(promise)) {
        JSValue e = JS_GetException(ctx);
        const char *s = JS_ToCString(ctx, e);
        printf("  FAIL immediate exception: %s\n", s);
        failures++;
        JS_FreeCString(ctx, s);
        JS_FreeValue(ctx, e);
        JS_FreeValue(ctx, promise);
        goto done;
    }

    check("JS_EvalModuleAsync returned without loading anything",
          net.requests > 0 && r.settled == 0);

    track(ctx, promise, &r);
    pump(ctx, rt, &net, &r);
    JS_FreeValue(ctx, promise);

    if (expect_ok) {
        check("graph resolved", r.settled == 1);
        if (r.settled == 1 && expect_export) {
            JSValue v = JS_GetPropertyStr(ctx, r.value, expect_export);
            const char *s = JS_ToCString(ctx, v);
            char buf[256];
            snprintf(buf, sizeof(buf), "%s === '%s' (got '%s')",
                     expect_export, expect_value, s ? s : "<null>");
            check(buf, s && !strcmp(s, expect_value));
            JS_FreeCString(ctx, s);
            JS_FreeValue(ctx, v);
        }
        check("every request was settled", net.fetches_started == 0);
    } else {
        check("graph rejected", r.settled == 2);
        if (r.settled == 2) {
            JSValue msg = JS_GetPropertyStr(ctx, r.value, "message");
            const char *s = JS_ToCString(ctx, msg);
            printf("       rejection: %s\n", s ? s : "<none>");
            JS_FreeCString(ctx, s);
            JS_FreeValue(ctx, msg);
        }
    }
    printf("       %d host fetches issued\n", net.requests);
    JS_FreeValue(ctx, r.value);
 done:
    JS_FreeContext(ctx);
    JS_FreeRuntime(rt);
}

/* The host has to be able to set import.meta.url. With an async loader it
   never sees a JSModuleDef, so JS_SetModuleMetaFunc is the only hook for it -
   and the root here is compiled by the caller and handed to
   JS_LoadModuleAsync, which is the other half of the same story. */
static void meta_func(JSContext *ctx, JSModuleDef *m, JSValueConst meta_obj,
                      void *opaque)
{
    int *calls = opaque;
    JSAtom name = JS_GetModuleName(ctx, m);
    const char *str = JS_AtomToCString(ctx, name);

    (*calls)++;
    JS_SetPropertyStr(ctx, meta_obj, "url",
                      JS_NewString(ctx, str ? str : "<unnamed>"));
    JS_FreeCString(ctx, str);
    JS_FreeAtom(ctx, name);
}

static void run_import_meta(void)
{
    JSRuntime *rt;
    JSContext *ctx;
    FakeNet net;
    Result r;
    JSValue promise, mod;
    int meta_calls = 0;
    const char *src = "import { where } from './meta.js';\n"
                      "export const out = import.meta.url + '|' + where;\n";

    printf("\n== import.meta.url comes from the host ==\n");
    memset(&net, 0, sizeof(net));
    memset(&r, 0, sizeof(r));
    r.value = JS_UNDEFINED;

    rt = JS_NewRuntime();
    ctx = JS_NewContext(rt);
    JS_SetModuleLoaderFuncAsync(rt, NULL, fake_loader, NULL, &net);
    JS_SetModuleMetaFunc(rt, meta_func, &meta_calls);

    /* compiled here rather than by JS_EvalModuleAsync, so the graph is started
       from a module value the caller owns */
    mod = JS_Eval(ctx, src, strlen(src), "http://localhost:3100/root.js",
                  JS_EVAL_TYPE_MODULE | JS_EVAL_FLAG_COMPILE_ONLY |
                  JS_EVAL_FLAG_ASYNC_LOAD);
    check("a root compiled with JS_EVAL_FLAG_ASYNC_LOAD is a module",
          !JS_IsException(mod));
    if (JS_IsException(mod)) {
        JS_FreeValue(ctx, mod);
        goto done;
    }

    promise = JS_LoadModuleAsync(ctx, JS_VALUE_GET_PTR(mod));
    JS_FreeValue(ctx, mod);
    check("JS_LoadModuleAsync returned without loading anything",
          net.requests > 0 && r.settled == 0);
    track(ctx, promise, &r);
    pump(ctx, rt, &net, &r);
    JS_FreeValue(ctx, promise);

    check("graph resolved", r.settled == 1);
    if (r.settled == 1) {
        JSValue v = JS_GetPropertyStr(ctx, r.value, "out");
        const char *str = JS_ToCString(ctx, v);
        const char *want = "http://localhost:3100/root.js|"
                           "http://localhost:3100/meta.js";
        char buf[256];
        snprintf(buf, sizeof(buf), "both urls came from the host (got '%s')",
                 str ? str : "<null>");
        check(buf, str && !strcmp(str, want));
        JS_FreeCString(ctx, str);
        JS_FreeValue(ctx, v);
    }
    /* once per module that read import.meta, not once per module loaded */
    check("the hook ran twice", meta_calls == 2);
    JS_FreeValue(ctx, r.value);
 done:
    JS_FreeContext(ctx);
    JS_FreeRuntime(rt);
}

/* A host that fills import.meta in itself keeps precedence: that is what the
   synchronous loaders do, and the hook must not overwrite it. */
static void run_import_meta_precedence(void)
{
    JSRuntime *rt;
    JSContext *ctx;
    FakeNet net;
    Result r;
    JSValue promise, mod, meta;
    JSModuleDef *m;
    int meta_calls = 0;
    const char *src = "export const out = import.meta.url;\n";

    printf("\n== a pre-filled import.meta wins over the hook ==\n");
    memset(&net, 0, sizeof(net));
    memset(&r, 0, sizeof(r));
    r.value = JS_UNDEFINED;

    rt = JS_NewRuntime();
    ctx = JS_NewContext(rt);
    JS_SetModuleLoaderFuncAsync(rt, NULL, fake_loader, NULL, &net);
    JS_SetModuleMetaFunc(rt, meta_func, &meta_calls);

    mod = JS_Eval(ctx, src, strlen(src), "root.js",
                  JS_EVAL_TYPE_MODULE | JS_EVAL_FLAG_COMPILE_ONLY |
                  JS_EVAL_FLAG_ASYNC_LOAD);
    if (JS_IsException(mod)) {
        check("root compiled", false);
        JS_FreeValue(ctx, mod);
        goto done;
    }
    m = JS_VALUE_GET_PTR(mod);
    meta = JS_GetImportMeta(ctx, m);
    JS_SetPropertyStr(ctx, meta, "url", JS_NewString(ctx, "set-by-hand"));
    JS_FreeValue(ctx, meta);

    promise = JS_LoadModuleAsync(ctx, m);
    JS_FreeValue(ctx, mod);
    track(ctx, promise, &r);
    pump(ctx, rt, &net, &r);
    JS_FreeValue(ctx, promise);

    check("graph resolved", r.settled == 1);
    if (r.settled == 1) {
        JSValue v = JS_GetPropertyStr(ctx, r.value, "out");
        const char *str = JS_ToCString(ctx, v);
        check("import.meta.url is still the host's value",
              str && !strcmp(str, "set-by-hand"));
        JS_FreeCString(ctx, str);
        JS_FreeValue(ctx, v);
    }
    check("the hook did not run", meta_calls == 0);
    JS_FreeValue(ctx, r.value);
 done:
    JS_FreeContext(ctx);
    JS_FreeRuntime(rt);
}

/* Dynamic import() must go through the async loader too, not the sync one. */
static void run_dynamic_import(void)
{
    JSRuntime *rt;
    JSContext *ctx;
    FakeNet net;
    Result r;
    JSValue promise;
    int turn = 0;
    /* the root statically imports dyn.js, which then dynamically imports
       g.js -> h.js -> i.js, a chain the loader has never seen */
    const char *src = "import { pull } from './dyn.js';\n"
                      "export const out = pull();\n";

    printf("\n== dynamic import() uses the async loader ==\n");
    memset(&net, 0, sizeof(net));
    memset(&r, 0, sizeof(r));
    r.value = JS_UNDEFINED;

    rt = JS_NewRuntime();
    ctx = JS_NewContext(rt);
    JS_SetModuleLoaderFuncAsync(rt, NULL, fake_loader, NULL, &net);

    promise = JS_EvalModuleAsync(ctx, src, strlen(src), "root.js");
    track(ctx, promise, &r);
    pump(ctx, rt, &net, &r);
    check("static part of the graph resolved", r.settled == 1);

    /* out is the promise returned by pull(); drive it to completion */
    if (r.settled == 1) {
        Result inner;
        JSValue out = JS_GetPropertyStr(ctx, r.value, "out");

        memset(&inner, 0, sizeof(inner));
        inner.value = JS_UNDEFINED;
        check("out is a promise (the dynamic import is pending)",
              JS_IsObject(out) && !JS_IsUndefined(out));
        track(ctx, out, &inner);
        JS_FreeValue(ctx, out);

        while (inner.settled == 0 && turn < 200) {
            JSContext *c;
            turn++;
            net_tick(ctx, &net, turn);
            while (JS_ExecutePendingJob(rt, &c) > 0)
                ;
            if (net.pending == NULL && !JS_IsJobPending(rt))
                break;
        }
        check("dynamic import resolved", inner.settled == 1);
        if (inner.settled == 1) {
            const char *str = JS_ToCString(ctx, inner.value);
            char buf[256];
            snprintf(buf, sizeof(buf), "dynamic import gave 'dyn:g>h>i' (got '%s')",
                     str ? str : "<null>");
            check(buf, str && !strcmp(str, "dyn:g>h>i"));
            JS_FreeCString(ctx, str);
        }
        check("dyn/g/h/i all came from the async loader",
              net.requests == 4);
        JS_FreeValue(ctx, inner.value);
    }
    printf("       %d host fetches issued\n", net.requests);

    JS_FreeValue(ctx, promise);
    JS_FreeValue(ctx, r.value);
    JS_FreeContext(ctx);
    JS_FreeRuntime(rt);
}

/* A dynamic import() of something that does not exist must reject the promise
   import() returned, not tear anything down. */
static void run_dynamic_import_failure(void)
{
    JSRuntime *rt;
    JSContext *ctx;
    FakeNet net;
    Result r;
    JSValue promise;
    const char *src = "export const out = import('./nope.js');\n";

    printf("\n== dynamic import() of a missing module rejects ==\n");
    memset(&net, 0, sizeof(net));
    memset(&r, 0, sizeof(r));
    r.value = JS_UNDEFINED;

    rt = JS_NewRuntime();
    ctx = JS_NewContext(rt);
    JS_SetModuleLoaderFuncAsync(rt, NULL, fake_loader, NULL, &net);

    promise = JS_EvalModuleAsync(ctx, src, strlen(src), "root.js");
    track(ctx, promise, &r);
    pump(ctx, rt, &net, &r);

    if (r.settled == 1) {
        Result inner;
        JSValue out = JS_GetPropertyStr(ctx, r.value, "out");
        int turn = 0;

        memset(&inner, 0, sizeof(inner));
        inner.value = JS_UNDEFINED;
        track(ctx, out, &inner);
        JS_FreeValue(ctx, out);
        while (inner.settled == 0 && turn < 200) {
            JSContext *c;
            turn++;
            net_tick(ctx, &net, turn);
            while (JS_ExecutePendingJob(rt, &c) > 0)
                ;
            if (net.pending == NULL && !JS_IsJobPending(rt))
                break;
        }
        check("the import() promise rejected", inner.settled == 2);
        JS_FreeValue(ctx, inner.value);
    } else {
        check("root evaluated so import() could run", false);
    }

    JS_FreeValue(ctx, promise);
    JS_FreeValue(ctx, r.value);
    JS_FreeContext(ctx);
    JS_FreeRuntime(rt);
}

/* After a failed load, retrying the same graph must work - and the modules the
   failed attempt left behind must not have been freed out from under anything.
   Repeating it many times also shows the registry is not growing without
   bound, which is what the refcount-aware reclamation buys. */
static void run_failure_reclaim(void)
{
    JSRuntime *rt;
    JSContext *ctx;
    FakeNet net;
    int i;
    const char *broken = "import { q } from './broken.js';\nexport const out = q;\n";
    const char *good = "import { c } from './c.js';\nexport const out = c;\n";
    Result last;

    printf("\n== repeated failures reclaim, then a good load still works ==\n");
    memset(&net, 0, sizeof(net));

    rt = JS_NewRuntime();
    ctx = JS_NewContext(rt);
    JS_SetModuleLoaderFuncAsync(rt, NULL, fake_loader, NULL, &net);

    for (i = 0; i < 25; i++) {
        Result r;
        JSValue p;
        char name[32];

        memset(&r, 0, sizeof(r));
        r.value = JS_UNDEFINED;
        snprintf(name, sizeof(name), "root%d.js", i);
        p = JS_EvalModuleAsync(ctx, broken, strlen(broken), name);
        track(ctx, p, &r);
        pump(ctx, rt, &net, &r);
        if (r.settled != 2) {
            check("each failed attempt rejected", false);
            JS_FreeValue(ctx, r.value);
            JS_FreeValue(ctx, p);
            goto done;
        }
        JS_FreeValue(ctx, r.value);
        JS_FreeValue(ctx, p);
    }
    check("25 failed loads all rejected, none crashed", true);

    /* the registry survived all of that: a fresh good load still works */
    memset(&last, 0, sizeof(last));
    last.value = JS_UNDEFINED;
    {
        JSValue p = JS_EvalModuleAsync(ctx, good, strlen(good), "after.js");
        track(ctx, p, &last);
        pump(ctx, rt, &net, &last);
        JS_FreeValue(ctx, p);
    }
    check("a good load after the failures resolved", last.settled == 1);
    if (last.settled == 1) {
        JSValue v = JS_GetPropertyStr(ctx, last.value, "out");
        const char *str = JS_ToCString(ctx, v);
        check("and produced the right value", str && !strcmp(str, "c(d)"));
        JS_FreeCString(ctx, str);
        JS_FreeValue(ctx, v);
    }
    JS_FreeValue(ctx, last.value);
 done:
    printf("       %d host fetches issued across all attempts\n", net.requests);
    JS_FreeContext(ctx);
    JS_FreeRuntime(rt);
}

/* Two graphs loading at once over a shared dependency, where one of them
   fails. The failing graph must not reclaim modules the other still holds. */
static void run_concurrent(void)
{
    JSRuntime *rt;
    JSContext *ctx;
    FakeNet net;
    Result ok, bad;
    JSValue p_ok, p_bad;
    int turn = 0;
    const char *good = "import { b } from './b.js';\n"
                       "export const out = 'good:' + b;\n";
    /* shares d.js (via c.js) with the graph above, then 404s */
    const char *broken = "import { c } from './c.js';\n"
                         "import { z } from './nope.js';\n"
                         "export const out = c + z;\n";

    printf("\n== two concurrent graphs, shared dependency, one fails ==\n");
    memset(&net, 0, sizeof(net));
    memset(&ok, 0, sizeof(ok));
    memset(&bad, 0, sizeof(bad));
    ok.value = JS_UNDEFINED;
    bad.value = JS_UNDEFINED;

    rt = JS_NewRuntime();
    ctx = JS_NewContext(rt);
    JS_SetModuleLoaderFuncAsync(rt, NULL, fake_loader, NULL, &net);

    p_ok = JS_EvalModuleAsync(ctx, good, strlen(good), "good.js");
    p_bad = JS_EvalModuleAsync(ctx, broken, strlen(broken), "broken.js");
    track(ctx, p_ok, &ok);
    track(ctx, p_bad, &bad);
    JS_FreeValue(ctx, p_ok);
    JS_FreeValue(ctx, p_bad);

    while ((ok.settled == 0 || bad.settled == 0) && turn < 200) {
        JSContext *c;
        turn++;
        net_tick(ctx, &net, turn);
        while (JS_ExecutePendingJob(rt, &c) > 0)
            ;
        if (net.pending == NULL && !JS_IsJobPending(rt))
            break;
    }

    check("the broken graph rejected", bad.settled == 2);
    check("the good graph still resolved", ok.settled == 1);
    if (ok.settled == 1) {
        JSValue v = JS_GetPropertyStr(ctx, ok.value, "out");
        const char *str = JS_ToCString(ctx, v);
        char buf[256];
        snprintf(buf, sizeof(buf), "good graph out === 'good:b(d)' (got '%s')",
                 str ? str : "<null>");
        check(buf, str && !strcmp(str, "good:b(d)"));
        JS_FreeCString(ctx, str);
        JS_FreeValue(ctx, v);
    }
    printf("       %d host fetches issued for both graphs\n", net.requests);

    JS_FreeValue(ctx, ok.value);
    JS_FreeValue(ctx, bad.value);
    JS_FreeContext(ctx);
    JS_FreeRuntime(rt);
}

/* Frees a runtime while loads are still in flight. Nothing settles them, so
   the handles, waiters and graph promise must be reclaimed by teardown. */
static void run_abandoned(void)
{
    JSRuntime *rt;
    JSContext *ctx;
    FakeNet net;
    JSValue promise;
    const char *src = "import { b } from './b.js';\n"
                      "import { g } from './g.js';\n"
                      "export const out = b + g;\n";

    printf("\n== runtime freed with loads still in flight ==\n");
    memset(&net, 0, sizeof(net));

    rt = JS_NewRuntime();
    ctx = JS_NewContext(rt);
    JS_SetModuleLoaderFuncAsync(rt, NULL, fake_loader, NULL, &net);

    promise = JS_EvalModuleAsync(ctx, src, strlen(src), "root.js");
    check("loads are in flight", net.fetches_started > 0);
    JS_FreeValue(ctx, promise);

    /* deliberately no pumping: tear down mid-load */
    JS_FreeContext(ctx);
    JS_FreeRuntime(rt);
    check("teardown with pending loads did not crash", true);

    while (net.pending) {
        PendingLoad *p = net.pending;
        net.pending = p->next;
        free(p->name);
        free(p);
    }
}

/* Linking and evaluation push onto a stack threaded through the same field on
   JSModuleDef, and each is kept off the other's modules only by a status check.
   js_inner_module_linking did not list EVALUATING, so a link pass reaching a module
   whose body was running pushed it, overwrote the link its evaluation was holding,
   and left that evaluation walking off the end of a spliced chain into NULL.

   Upstream cannot get here: loading is synchronous, so linking and evaluation never
   interleave. Loading asynchronously is what made them able to, which is what makes
   this ours rather than upstream's. Two roots sharing a module is the ordinary case
   - an entry document with two script tags - and `pumpJobs` is any host binding a
   module body can reach that drains the queue. That is how it took down an editor. */
static JSValue js_pump_jobs(JSContext *ctx, JSValueConst this_val,
                            int argc, JSValueConst *argv)
{
    JSRuntime *rt = JS_GetRuntime(ctx);
    JSContext *c;
    int ran = 0;

    while (JS_ExecutePendingJob(rt, &c) > 0)
        ran++;
    printf("    [host] a module body drained %d job(s)\n", ran);
    return JS_NewInt32(ctx, ran);
}

static void run_link_during_evaluation(void)
{
    JSRuntime *rt;
    JSContext *ctx;
    FakeNet net;
    Result ra, rb;
    JSValue global, promise, val;
    int turn = 0;
    const char *root_a = "import { victim } from './victim.js';\n"
                         "globalThis.first = 'first(' + victim + ')';\n"
                         "export const out = victim;\n";
    const char *root_b = "import { victim } from './victim.js';\n"
                         "globalThis.second = 'second(' + victim + ')';\n"
                         "export const out = victim;\n";

    printf("\n== two graphs sharing a module, one pumping from its body ==\n");
    memset(&net, 0, sizeof(net));
    memset(&ra, 0, sizeof(ra));
    memset(&rb, 0, sizeof(rb));

    rt = JS_NewRuntime();
    ctx = JS_NewContext(rt);
    JS_SetModuleLoaderFuncAsync(rt, NULL, fake_loader, NULL, &net);

    global = JS_GetGlobalObject(ctx);
    JS_SetPropertyStr(ctx, global, "pumpJobs",
                      JS_NewCFunction(ctx, js_pump_jobs, "pumpJobs", 0));
    JS_FreeValue(ctx, global);

    promise = JS_EvalModuleAsync(ctx, root_a, strlen(root_a), "rootA.js");
    track(ctx, promise, &ra);
    JS_FreeValue(ctx, promise);

    promise = JS_EvalModuleAsync(ctx, root_b, strlen(root_b), "rootB.js");
    track(ctx, promise, &rb);
    JS_FreeValue(ctx, promise);

    while ((ra.settled == 0 || rb.settled == 0) && turn < 200) {
        JSContext *c;
        turn++;
        net_tick(ctx, &net, turn);
        while (JS_ExecutePendingJob(rt, &c) > 0)
            ;
        if (net.pending == NULL && !JS_IsJobPending(rt))
            break;
    }

    check("the graph whose body pumped resolved", ra.settled == 1);
    check("the graph it pumped into resolved", rb.settled == 1);

    val = JS_Eval(ctx, "globalThis.first + '/' + globalThis.second", 41,
                  "check.js", JS_EVAL_TYPE_GLOBAL);
    {
        const char *got = JS_ToCString(ctx, val);
        const char *want = "first(victim:leaf)/second(victim:leaf)";
        check("both graphs ran, sharing one copy of the module",
              got && strcmp(got, want) == 0);
        if (!got || strcmp(got, want) != 0)
            printf("    got '%s'\n", got ? got : "(none)");
        JS_FreeCString(ctx, got);
    }
    JS_FreeValue(ctx, val);

    check("every request was settled", net.fetches_started == 0);

    JS_FreeValue(ctx, ra.value);
    JS_FreeValue(ctx, rb.value);
    JS_FreeContext(ctx);
    JS_FreeRuntime(rt);
}

int main(void)
{
    /* unbuffered: an assert() must not swallow the progress log */
    setvbuf(stdout, NULL, _IONBF, 0);
    printf("async module loading (HostLoadImportedModule) - Windows PoC\n");

    /* Diamond: d.js is imported by both b.js and c.js, and must be fetched
       once. d.js also has the highest latency, so it settles last. */
    run_case("diamond, out-of-order delivery, shared dependency",
             "import { b } from './b.js';\n"
             "import { c } from './c.js';\n"
             "export const out = b + '+' + c;\n",
             true, "out", "b(d)+c(d)");

    /* Cycle: e imports f, f imports e. */
    run_case("cycle",
             "import { e, ef } from './e.js';\n"
             "export const out = e + ef();\n",
             true, "out", "ef");

    /* Deep chain: each hop can only be discovered after the previous one
       arrives, which is the case a prefetch pass cannot flatten. */
    run_case("deep chain discovered one hop at a time",
             "import { g } from './g.js';\n"
             "export const out = g;\n",
             true, "out", "g>h>i");

    /* Missing module rejects rather than throwing synchronously. */
    run_case("missing module rejects the graph promise",
             "import { z } from './nope.js';\n"
             "export const out = z;\n",
             false, NULL, NULL);

    run_import_meta();
    run_import_meta_precedence();
    run_dynamic_import();
    run_dynamic_import_failure();
    run_failure_reclaim();
    run_concurrent();
    run_abandoned();
    run_link_during_evaluation();

    printf("\n%s (%d failure%s)\n", failures ? "FAILED" : "ALL PASSED",
           failures, failures == 1 ? "" : "s");
    return failures ? 1 : 0;
}
