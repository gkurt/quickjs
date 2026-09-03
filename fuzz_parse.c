// clang -g -O1 -fsanitize=address,undefined,fuzzer -o fuzz_parse fuzz_parse.c
//
// Fuzzes the parser and bytecode compiler: the input is compiled, but not
// run, as a classic script and as a module, both as JavaScript and as
// TypeScript (JS_EVAL_FLAG_TYPESCRIPT).
#include "quickjs.h"
#include "quickjs.c"
#include "cutils.h"
#include "libregexp.c"
#include "libunicode.c"
#include "dtoa.c"

#include <stdint.h>
#include <stdlib.h>
#include <string.h>

int LLVMFuzzerTestOneInput(const uint8_t *buf, size_t len)
{
    static const int eval_flags[] = {
        JS_EVAL_TYPE_GLOBAL,
        JS_EVAL_TYPE_MODULE,
        JS_EVAL_TYPE_GLOBAL | JS_EVAL_FLAG_TYPESCRIPT,
        JS_EVAL_TYPE_MODULE | JS_EVAL_FLAG_TYPESCRIPT,
    };
    char *src;
    size_t i;

    JSRuntime *rt = JS_NewRuntime();
    if (!rt)
        exit(1);
    JSContext *ctx = JS_NewContext(rt);
    if (!ctx)
        exit(1);
    src = malloc(len + 1);
    if (!src)
        exit(1);
    memcpy(src, buf, len);
    src[len] = '\0';
    for (i = 0; i < countof(eval_flags); i++) {
        JSValue val = JS_Eval(ctx, src, len, "<fuzz>",
                              eval_flags[i] | JS_EVAL_FLAG_COMPILE_ONLY);
        if (JS_IsException(val))
            JS_FreeValue(ctx, JS_GetException(ctx));
        JS_FreeValue(ctx, val);
    }
    free(src);
    JS_FreeContext(ctx);
    JS_FreeRuntime(rt);
    return 0;
}
