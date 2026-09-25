// Fast paths of the interpreter and the runtime which must keep the
// generic semantics: the computed property store, the global variable
// cache, ...
import * as std from "qjs:std";
import { assert, assertThrows } from "./assert.js";

function test_computed_store_order()
{
    let log = [];
    const key = (name, ret) => ({
        toString() { log.push("key " + name); return ret; }
    });
    const val = (v) => { log.push("val"); return v; };

    // object base: the key is converted before the value is evaluated
    let o = {};
    o[key("a", "p")] = val(1);
    assert(log.join(), "key a,val");
    assert(o.p, 1);

    // null and undefined base: the value first, then the key, then the error
    for (const base of [null, undefined]) {
        log = [];
        let b = base;
        assertThrows(TypeError, () => { b[key("b", "p")] = val(2); });
        assert(log.join(), "val,key b");
    }

    // the conversion of the key throws: with an object base the value
    // is not evaluated, with a null base it is
    const bad = { toString() { throw new RangeError("key"); } };
    log = [];
    assertThrows(RangeError, () => { o[bad] = val(3); });
    assert(log.join(), "");
    log = [];
    let n = null;
    assertThrows(RangeError, () => { n[bad] = val(3); });
    assert(log.join(), "val");

    // the conversion of the key modifies the variable stored
    let v = 1;
    const k = { toString() { v = 2; return "q"; } };
    o[k] = v;
    assert(o.q, 2);
    let w = 1;
    const k2 = { toString() { w = 3; return "r"; } };
    (function () { o[k2] = w; })();
    assert(o.r, 3);

    // constant values and literal keys
    const k3 = { toString() { log.push("k3"); return "s"; } };
    log = [];
    o[k3] = 5;
    assert(o.s, 5);
    o[k3] = "str";
    assert(o.s, "str");
    o[k3] = undefined;
    assert(o.s, undefined);
    assert(log.join(), "k3,k3,k3");
    o[0] = val(6);
    o["lit"] = val(7);
    o[1.5] = val(8);
    o[10n] = val(9);
    assert(o[0] + o.lit + o["1.5"] + o["10"], 6 + 7 + 8 + 9);
    const sym = Symbol("s");
    o[sym] = val(10);
    assert(o[sym], 10);

    // the value of the assignment expression and chained assignments
    const a = [];
    let i = 0;
    const r = a[i++] = a[i++] = 4;
    assert(r, 4);
    assert(a.join(), "4,4");
    assert(i, 2);

    // arrays, typed arrays and the key converted once
    let count = 0;
    const kc = { valueOf() { count++; return 1; }, toString: undefined };
    const arr = [1, 2, 3];
    arr[kc] = val(20);
    assert(arr[1], 20);
    assert(count, 1);
    const ta = new Int32Array(4);
    for (let j = 0; j < 4; j++)
        ta[j] = j * 2;
    assert(ta.join(), "0,2,4,6");
}

function test_global_var_cache()
{
    // global code, where var and function declarations are properties
    // of the global object and let/const are global lexical variables
    const run = (src) => std.evalScript(src);

    globalThis.gv1 = 1; // configurable, unlike a var declaration
    run("function gv_read() { return gv1; }" +
        "function gv_write(v) { gv1 = v; }" +
        "function gv_typeof() { return typeof gv1; }");
    for (let i = 0; i < 4; i++)
        assert(gv_read(), 1);
    globalThis.gv1 = 2;
    assert(gv_read(), 2);
    gv_write(3);
    assert(globalThis.gv1, 3);
    assert(gv_read(), 3);

    // delete, then define again
    globalThis.gv2 = 10;
    run("function gv2_read() { return gv2; }");
    assert(gv2_read(), 10);
    delete globalThis.gv2;
    assertThrows(ReferenceError, gv2_read);
    run("function gv2_typeof() { return typeof gv2; }");
    assert(gv2_typeof(), "undefined");
    globalThis.gv2 = 11;
    assert(gv2_read(), 11);
    assert(gv2_typeof(), "number");

    // accessor, read only
    let gets = 0;
    Object.defineProperty(globalThis, "gv1", {
        get() { gets++; return "getter"; }, set(v) { gets += 10; },
        configurable: true });
    assert(gv_read(), "getter");
    gv_write(5);
    assert(gets, 11);
    Object.defineProperty(globalThis, "gv1", { value: 7, writable: false,
                                               configurable: true });
    assert(gv_read(), 7);
    gv_write(8);            // sloppy: ignored
    assert(gv_read(), 7);
    run("'use strict'; function gv_write_strict(v) { gv1 = v; }");
    assertThrows(TypeError, () => gv_write_strict(9));
    Object.defineProperty(globalThis, "gv1", { writable: true });
    gv_write(12);
    assert(gv_read(), 12);

    // a lexical declaration shadows a property of the global object
    globalThis.gv3 = "property";
    run("function gv3_read() { return gv3; } function gv3_write(v) { gv3 = v; }");
    assert(gv3_read(), "property");
    gv3_write("property2");
    assert(globalThis.gv3, "property2");
    run("let gv3 = 'lexical';");
    assert(gv3_read(), "lexical");
    gv3_write("lexical2");
    assert(gv3_read(), "lexical2");
    assert(globalThis.gv3, "property2");

    // uninitialized lexical variable
    run("function gv4_read() { return gv4; } function gv4_write(v) { gv4 = v; }");
    assertThrows(ReferenceError, () =>
                 run("gv4_read(); let gv4 = 1;"));
    assertThrows(ReferenceError, gv4_read);
    assertThrows(ReferenceError, () => gv4_write(2));
    assertThrows(ReferenceError, gv4_read);

    // const
    run("const gv5 = 1; function gv5_read() { return gv5; }" +
        "function gv5_write(v) { gv5 = v; }");
    for (let i = 0; i < 4; i++) {
        assert(gv5_read(), 1);
        assertThrows(TypeError, () => gv5_write(2));
    }

    // atoms sharing a cache slot, and many deleted properties so that
    // the properties of the global object are compacted
    const names = [];
    for (let i = 0; i < 600; i++)
        names.push("gv_many" + i);
    run(names.map((n, i) => "var " + n + " = " + i + ";").join("") +
        "function gv_many_sum() { return " + names.join("+") + "; }");
    const sum = names.reduce((s, n, i) => s + i, 0);
    for (let i = 0; i < 3; i++)
        assert(gv_many_sum(), sum);
    for (let i = 0; i < 600; i += 2)
        globalThis[names[i]] = 0;
    assert(gv_many_sum(), names.reduce((s, n, i) => s + (i & 1 ? i : 0), 0));
    for (let i = 0; i < 400; i++)
        globalThis["gv_tmp" + i] = i;
    for (let i = 0; i < 400; i++)
        delete globalThis["gv_tmp" + i];
    assert(gv_many_sum(), names.reduce((s, n, i) => s + (i & 1 ? i : 0), 0));
    assert(gv_read(), 12);
    assert(gv3_read(), "lexical2");
}

test_computed_store_order();
test_global_var_cache();
