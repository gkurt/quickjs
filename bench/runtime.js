// Runtime micro benchmarks for the hot paths of the engine.
//
//   qjs bench/runtime.js [options] [filter ...]
//
//   --json FILE     also write the results to FILE as JSON (see compare.js)
//   --rounds N      rounds per benchmark, the best one counts (default 5)
//   --min-ms N      minimum duration of one round in milliseconds (default 100)
//   --iterations N  do not time anything: warm up and run each selected
//                   benchmark once with exactly N iterations (N may be 0),
//                   for use under an instruction counter (see instructions.js)
//   --warmup N      iterations of the warm up before measuring (default 1000)
//   --list          print the benchmark names and exit
//   filter          only run benchmarks whose name contains one of the
//                   filters, whose group is a filter, or whose group/name is
//                   a filter (exact match)
//
// Every benchmark is a function that performs `n` iterations of one
// operation. The iteration count is calibrated so that a round takes at
// least --min-ms, then --rounds rounds are timed and the best one is
// reported as nanoseconds per operation: the minimum is the most stable
// statistic for a micro benchmark since noise only ever adds time.
//
// Use a Release build. Compare two runs with bench/compare.js.
import * as std from "qjs:std";

const now = () => performance.now(); // milliseconds, sub-millisecond resolution

// ---------------------------------------------------------------------------
// benchmarks: [group, name, fn(n)] where fn performs n operations
// ---------------------------------------------------------------------------
const benchmarks = [];
function bench(group, name, fn) {
    benchmarks.push({ group, name, fn });
}

// --- interpreter -----------------------------------------------------------

bench("interp", "int_arith", n => {
    let s = 0;
    for (let i = 0; i < n; i++)
        s = (s + i * 3) | 0;
    return s;
});

bench("interp", "float_arith", n => {
    let s = 0.5;
    for (let i = 0; i < n; i++)
        s = s * 1.000001 + 0.1;
    return s;
});

bench("interp", "func_call", n => {
    function f(a, b) { return a + b; }
    let s = 0;
    for (let i = 0; i < n; i++)
        s = f(s, i);
    return s;
});

bench("interp", "closure_call", n => {
    let c = 0;
    const inc = () => c++;
    for (let i = 0; i < n; i++)
        inc();
    return c;
});

bench("interp", "method_call", n => {
    const o = { v: 0, add(x) { this.v += x; } };
    for (let i = 0; i < n; i++)
        o.add(i);
    return o.v;
});

bench("interp", "arguments_rest", n => {
    function f(...a) { return a.length + arguments.length; }
    let t = 0;
    for (let i = 0; i < n; i++)
        t += f(1, 2, 3);
    return t;
});

bench("interp", "global_var", n => {
    globalThis.__bench_g = 0;
    for (let i = 0; i < n; i++)
        __bench_g += i;
    return __bench_g;
});

bench("interp", "try_catch_throw", n => {
    let t = 0;
    for (let i = 0; i < n; i++) {
        try {
            if (i & 1)
                throw new Error("x");
            t++;
        } catch (e) {
            t += 2;
        }
    }
    return t;
});

bench("interp", "generator", n => {
    function* g(k) { for (let i = 0; i < k; i++) yield i; }
    let t = 0;
    for (const x of g(n))
        t += x;
    return t;
});

bench("interp", "spread_destructure", n => {
    let t = 0;
    for (let i = 0; i < n; i++) {
        const [a, b, ...r] = [i, 2, 3, 4];
        const { x, ...o } = { x: a, y: b, z: r };
        t += x + o.y;
    }
    return t;
});

// --- objects ---------------------------------------------------------------

bench("object", "prop_get_set", n => {
    const o = { a: 1, b: 2, c: 3, d: 4 };
    let s = 0;
    for (let i = 0; i < n; i++) {
        s += o.a + o.b + o.c + o.d;
        o.a = i;
    }
    return s;
});

bench("object", "proto_chain_get", n => {
    class A { get x() { return 1; } }
    class B extends A {}
    class C extends B { m() { return this.x; } }
    const c = new C();
    let s = 0;
    for (let i = 0; i < n; i++)
        s += c.m();
    return s;
});

bench("object", "object_literal", n => {
    let o;
    for (let i = 0; i < n; i++)
        o = { x: i, y: i + 1, z: i + 2 };
    return o;
});

bench("object", "class_new", n => {
    class P { constructor(x, y) { this.x = x; this.y = y; } }
    let o;
    for (let i = 0; i < n; i++)
        o = new P(i, i);
    return o;
});

bench("object", "dynamic_keys", n => {
    let t = 0;
    for (let i = 0; i < n; i++) {
        const o = {};
        o["k" + (i & 7)] = i;
        t += Object.keys(o).length;
    }
    return t;
});

bench("object", "for_in", n => {
    const o = { a: 1, b: 2, c: 3, d: 4, e: 5, f: 6, g: 7, h: 8 };
    let t = 0;
    for (let i = 0; i < n / 8; i++)
        for (const k in o)
            t += o[k];
    return t;
});

// --- arrays ----------------------------------------------------------------

bench("array", "push_index", n => {
    const a = [];
    for (let i = 0; i < n; i++)
        a.push(i);
    let s = 0;
    for (let i = 0; i < n; i++)
        s += a[i];
    return s;
});

bench("array", "map_filter_reduce", n => {
    const a = Array.from({ length: 1000 }, (_, i) => i);
    let s = 0;
    for (let i = 0; i < n / 1000; i++)
        s += a.map(x => x * 2).filter(x => x & 2).reduce((p, c) => p + c, 0);
    return s;
});

bench("array", "for_of", n => {
    const a = Array.from({ length: 1000 }, (_, i) => i);
    let s = 0;
    for (let i = 0; i < n / 1000; i++)
        for (const x of a)
            s += x;
    return s;
});

bench("array", "sort_numbers", n => {
    let t = 0;
    const size = 1000;
    for (let i = 0; i < n / size; i++) {
        const a = Array.from({ length: size }, (_, j) => (j * 7919) % size);
        a.sort((x, y) => x - y);
        t += a[0];
    }
    return t;
});

bench("array", "typed_array", n => {
    const a = new Float64Array(1024);
    let t = 0;
    for (let i = 0; i < n; i++) {
        a[i & 1023] = i;
        t += a[(i * 7) & 1023];
    }
    return t;
});

// --- strings ---------------------------------------------------------------

bench("string", "concat", n => {
    let s = "";
    for (let i = 0; i < n; i++)
        s += "ab";
    return s.length;
});

bench("string", "template_literal", n => {
    let t = 0;
    for (let i = 0; i < n; i++)
        t += `item ${i} of ${n}`.length;
    return t;
});

bench("string", "indexof_slice_split", n => {
    const s = "the quick brown fox jumps over the lazy dog";
    let t = 0;
    for (let i = 0; i < n; i++)
        t += s.indexOf("fox") + s.slice(4, 9).length + s.split(" ").length;
    return t;
});

bench("string", "case_ascii", n => {
    const s = "The Quick Brown Fox Jumps Over The Lazy Dog";
    let t = 0;
    for (let i = 0; i < n; i++)
        t += s.toUpperCase().length + s.toLowerCase().length;
    return t;
});

bench("string", "case_unicode", n => {
    const s = "Straße naïve ΟΔΥΣΣΕΥΣ İstanbul";
    let t = 0;
    for (let i = 0; i < n; i++)
        t += s.toUpperCase().length + s.toLowerCase().length;
    return t;
});

bench("string", "number_to_string", n => {
    let t = 0;
    for (let i = 0; i < n; i++)
        t += String(i).length + (i * 0.5).toString().length;
    return t;
});

bench("string", "string_to_number", n => {
    let t = 0;
    for (let i = 0; i < n; i++)
        t += parseInt("12345", 10) + parseFloat("1.25") + +"42";
    return t;
});

// --- collections -----------------------------------------------------------

bench("collection", "map_int_keys", n => {
    const m = new Map();
    for (let i = 0; i < n; i++)
        m.set(i & 4095, i);
    let t = 0;
    for (let i = 0; i < n; i++)
        t += m.get(i & 4095);
    return t;
});

bench("collection", "map_string_keys", n => {
    const keys = Array.from({ length: 4096 }, (_, i) => "key" + i);
    const m = new Map();
    for (let i = 0; i < n; i++)
        m.set(keys[i & 4095], i);
    let t = 0;
    for (let i = 0; i < n; i++)
        t += m.get(keys[i & 4095]);
    return t;
});

bench("collection", "map_object_keys", n => {
    const keys = Array.from({ length: 4096 }, () => ({}));
    const m = new Map();
    for (let i = 0; i < n; i++)
        m.set(keys[i & 4095], i);
    let t = 0;
    for (let i = 0; i < n; i++)
        t += m.get(keys[i & 4095]);
    return t;
});

bench("collection", "set_add_has", n => {
    const s = new Set();
    for (let i = 0; i < n; i++)
        s.add(i & 8191);
    let t = 0;
    for (let i = 0; i < n; i++)
        t += s.has(i & 8191) ? 1 : 0;
    return t;
});

bench("collection", "weakmap_set_get", n => {
    const keys = Array.from({ length: 1024 }, () => ({}));
    const m = new WeakMap();
    let t = 0;
    for (let i = 0; i < n; i++) {
        const k = keys[i & 1023];
        m.set(k, i);
        t += m.get(k);
    }
    return t;
});

// --- JSON ------------------------------------------------------------------

const json_records = JSON.stringify(Array.from({ length: 200 }, (_, i) => ({
    id: i, score: i * 3, ratio: i / 7, tags: [i, i + 1, i + 2], name: "name" + i,
    active: (i & 1) === 0, nested: { a: null, b: "x" },
})));
const json_object = { a: [1, 2, 3, { b: "hello", c: null, d: true }], e: { f: 1.5, g: "world" } };

bench("json", "parse_ints", n => {
    let t = 0;
    for (let i = 0; i < n; i++)
        t += JSON.parse("[1,22,333,4444,-55555,0,7,-8,999999999]").length;
    return t;
});

bench("json", "parse_records", n => {
    let t = 0;
    for (let i = 0; i < n; i++)
        t += JSON.parse(json_records).length;
    return t;
});

bench("json", "stringify_small", n => {
    let t = 0;
    for (let i = 0; i < n; i++)
        t += JSON.stringify(json_object).length;
    return t;
});

bench("json", "stringify_records", n => {
    const records = JSON.parse(json_records);
    let t = 0;
    for (let i = 0; i < n; i++)
        t += JSON.stringify(records).length;
    return t;
});

// --- regexp ----------------------------------------------------------------

bench("regexp", "exec_groups", n => {
    const re = /(\d+)-(\w+)/;
    let t = 0;
    for (let i = 0; i < n; i++)
        t += re.exec("abc 123-foo def")[1].length;
    return t;
});

bench("regexp", "replace_global", n => {
    const re = /o/g;
    let t = 0;
    for (let i = 0; i < n; i++)
        t += "foo boo zoo moo".replace(re, "0").length;
    return t;
});

// ---------------------------------------------------------------------------
// runner
// ---------------------------------------------------------------------------

function parse_args(args) {
    const opts = { json: null, rounds: 5, min_ms: 100, iterations: null, warmup: 1000, list: false, filters: [] };
    for (let i = 0; i < args.length; i++) {
        const a = args[i];
        if (a === "--json")
            opts.json = args[++i];
        else if (a === "--rounds")
            opts.rounds = +args[++i];
        else if (a === "--min-ms")
            opts.min_ms = +args[++i];
        else if (a === "--iterations")
            opts.iterations = +args[++i];
        else if (a === "--warmup")
            opts.warmup = +args[++i];
        else if (a === "--list")
            opts.list = true;
        else if (a === "--help" || a === "-h") {
            print("usage: qjs bench/runtime.js [--json FILE] [--rounds N] [--min-ms N] [--iterations N] [--warmup N] [--list] [filter ...]");
            std.exit(0);
        } else if (a.startsWith("-")) {
            print("unknown option: " + a);
            std.exit(1);
        } else
            opts.filters.push(a);
    }
    if (!(opts.rounds >= 1) || !(opts.min_ms > 0)) {
        print("invalid --rounds or --min-ms");
        std.exit(1);
    }
    if ((opts.iterations !== null && !(opts.iterations >= 0 && Number.isInteger(opts.iterations))) ||
        !(opts.warmup >= 0 && Number.isInteger(opts.warmup))) {
        print("invalid --iterations or --warmup");
        std.exit(1);
    }
    return opts;
}

function time(fn, n) {
    const t0 = now();
    fn(n);
    return now() - t0;
}

// Find an iteration count for which one round lasts at least min_ms.
function calibrate(fn, min_ms) {
    let n = 1000;
    for (;;) {
        const t = time(fn, n);
        if (t >= min_ms)
            return n;
        // grow towards the target, at least doubling to converge quickly
        const factor = t > 0 ? Math.max(2, (min_ms * 1.2) / t) : 4;
        n = Math.ceil(n * Math.min(factor, 64));
    }
}

function run(b, opts) {
    b.fn(opts.warmup); // warm up: shapes, inline caches, allocator
    const n = calibrate(b.fn, opts.min_ms);
    let best = Infinity;
    for (let r = 0; r < opts.rounds; r++)
        best = Math.min(best, time(b.fn, n));
    return { ns_per_op: best * 1e6 / n, n, rounds: opts.rounds, ms: best };
}

function format_ns(ns) {
    if (ns < 10)
        return ns.toFixed(2);
    if (ns < 100)
        return ns.toFixed(1);
    return String(Math.round(ns));
}

function main() {
    const opts = parse_args(scriptArgs.slice(1));
    let selected = benchmarks;
    if (opts.filters.length > 0)
        selected = benchmarks.filter(b => opts.filters.some(f => f === b.group + "/" + b.name || b.name.includes(f) || b.group === f));
    if (opts.list) {
        for (const b of selected)
            print(b.group.padEnd(12), b.name);
        return 0;
    }
    if (selected.length === 0) {
        print("no benchmark matches the filter");
        return 1;
    }

    if (opts.iterations !== null) {
        // Fixed amount of work, nothing timed: the caller counts the
        // instructions of the whole process and subtracts those of a run
        // with 0 iterations, which does the same setup and warm up.
        for (const b of selected) {
            b.fn(opts.warmup);
            if (opts.iterations > 0)
                b.fn(opts.iterations);
        }
        return 0;
    }

    const results = {};
    print("group".padEnd(12), "benchmark".padEnd(24), "ns/op".padStart(10), "iterations".padStart(12));
    for (const b of selected) {
        const r = run(b, opts);
        results[b.name] = { group: b.group, ns_per_op: r.ns_per_op, iterations: r.n, rounds: r.rounds };
        print(b.group.padEnd(12), b.name.padEnd(24), format_ns(r.ns_per_op).padStart(10), String(r.n).padStart(12));
    }

    if (opts.json) {
        const out = {
            version: 1,
            date: new Date().toISOString(),
            engine: typeof navigator === "object" && navigator.userAgent || "quickjs",
            rounds: opts.rounds,
            min_ms: opts.min_ms,
            results,
        };
        const f = std.open(opts.json, "w");
        if (!f) {
            print("cannot open " + opts.json);
            return 1;
        }
        f.puts(JSON.stringify(out, null, 2) + "\n");
        f.close();
    }
    return 0;
}

std.exit(main());
