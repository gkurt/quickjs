// Fast paths of the interpreter and the runtime which must keep the
// generic semantics: the computed property store, the global variable
// cache, arrays made fast again when they become dense, comparisons
// fused with the conditional jump which follows them, 'x | 0', the
// elements of typed arrays read inline, ...
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

function test_array_dense_again()
{
    const fill_back = (n, f = i => i) => {
        const a = [];
        let i = n;
        while (--i >= 0)
            a[i] = f(i);
        return a;
    };
    let a = fill_back(50);
    assert(a.length, 50);
    assert(a.join(), Array.from({ length: 50 }, (v, i) => i).join());
    assert(Object.keys(a).join(), Object.keys(Array.from({ length: 50 }, (v, i) => i)).join());
    a.push(50);
    a[51] = 51;
    assert(a.length, 52);
    assert(a[51] + a[50] + a[0], 101);
    assert(a.indexOf(25), 25);
    a.length = 10;
    assert(a.join(), "0,1,2,3,4,5,6,7,8,9");
    delete a[3];
    assert(3 in a, false);
    assert(a.length, 10);
    a[3] = "x";
    assert(a.join(), "0,1,2,x,4,5,6,7,8,9");

    // holes are not filled
    a = [];
    a[5] = 5;
    a[3] = 3;
    a[1] = 1;
    assert(a.length, 6);
    assert(0 in a, false);
    assert(JSON.stringify(a), "[null,1,null,3,null,5]");
    a[0] = 0; a[2] = 2; a[4] = 4;
    assert(JSON.stringify(a), "[0,1,2,3,4,5]");
    assert(a.map(x => x * 2).join(), "0,2,4,6,8,10");

    // a named property, an accessor element, a read only element
    a = [];
    a.foo = "bar";
    for (let i = 9; i >= 0; i--)
        a[i] = i;
    assert(a.foo, "bar");
    assert(a.join(), "0,1,2,3,4,5,6,7,8,9");
    a.push(10);
    assert(a.length, 11);
    assert(Object.keys(a).join(), "0,1,2,3,4,5,6,7,8,9,10,foo");

    let gets = 0;
    a = [];
    a[3] = 3;
    Object.defineProperty(a, 2, { get() { gets++; return "g"; }, enumerable: true, configurable: true });
    a[1] = 1;
    a[0] = 0;
    assert(a.join(), "0,1,g,3");
    assert(gets, 1);
    for (let i = 4; i < 100; i++)
        a[i] = i;
    assert(a[2], "g");
    assert(a.length, 100);

    a = [];
    a[2] = 2;
    Object.defineProperty(a, 1, { value: 1, writable: false, enumerable: true, configurable: true });
    a[0] = 0;
    assert(a.join(), "0,1,2");
    Function("a", "a[1] = 5;")(a);   // sloppy: ignored
    assert(a[1], 1);
    assertThrows(TypeError, () => { a[1] = 5; });

    // read only length, frozen, not extensible
    a = [];
    a[1] = 1;
    Object.defineProperty(a, "length", { writable: false });
    a[0] = 0;
    assert(a.join(), "0,1");
    assertThrows(TypeError, () => { a[2] = 2; });
    assert(a.length, 2);
    a = [];
    a[1] = 1;
    a[0] = 0;
    Object.freeze(a);
    assertThrows(TypeError, () => { a[0] = 5; });
    assert(a[0], 0);

    // a subclass
    class MyArray extends Array {}
    a = new MyArray();
    a[2] = 2; a[1] = 1; a[0] = 0;
    assert(a instanceof MyArray, true);
    assert(a.join(), "0,1,2");
    assert(a.map(x => x + 1) instanceof MyArray, true);

    // typed values and objects survive the move to the fast array
    a = fill_back(20, i => ({ v: i }));
    let sum = 0;
    for (const o of a)
        sum += o.v;
    assert(sum, 190);
    a = fill_back(30, i => "s" + i);
    assert(a.sort().slice(0, 3).join(), "s0,s1,s10");
}

function test_compare_branch()
{
    const values = [0, -0, 1, -1, 2.5, NaN, Infinity, -Infinity, 1e300,
                    "1", "a", "", null, undefined, true, false, {}, [],
                    [1], 10n, Symbol.iterator];
    const ops = ["<", "<=", ">", ">=", "==", "!=", "===", "!=="];
    for (const op of ops) {
        // the comparison as a value and as the condition of a jump,
        // taken and not taken, in both polarities
        const value = Function("a", "b", "return a " + op + " b;");
        const cond = Function("a", "b", "if (a " + op + " b) return 1; else return 0;");
        const not = Function("a", "b", "if (!(a " + op + " b)) return 0; return 1;");
        const loop = Function("a", "b", "var n = 0; while (a " + op + " b && n < 3) n++; return n;");
        for (const a of values) {
            for (const b of values) {
                let v;
                try {
                    v = value(a, b);
                } catch (e) {
                    assertThrows(TypeError, () => cond(a, b));
                    continue;
                }
                assert(cond(a, b), v ? 1 : 0);
                assert(not(a, b), v ? 1 : 0);
                assert(loop(a, b), v ? 3 : 0);
            }
        }
    }
    // 'x == null' as a value and as a condition
    const eqn = Function("x", "return [x == null, x != null, null == x, x == null ? 1 : 0," +
                         " x != null ? 1 : 0];");
    for (const x of values) {
        const r = (x === null || x === undefined);
        assert(eqn(x).join(), [r, !r, r, r ? 1 : 0, r ? 0 : 1].join());
    }
    // a loop counting down with a comparison jumping backward
    let n = 0, i = 10;
    do { n++; } while (--i > 0);
    assert(n, 10);
    // the objects compared are released
    const o = {};
    let hits = 0;
    for (let k = 0; k < 100; k++) {
        if ({} == o) hits++;
        if (o === o) hits++;
        if ("a" + k === "a" + k) hits++;
    }
    assert(hits, 200);
}

test_computed_store_order();
test_global_var_cache();
test_array_dense_again();
function test_or_zero()
{
    const or0 = x => x | 0;
    const ref = x => x | (x === x ? 0 : 0) ;
    const values = [0, -0, 1, -1, 1.5, -1.5, 2147483647, 2147483648,
                    -2147483649, 4294967296 + 5, 1e21, -1e21, NaN, Infinity,
                    -Infinity, "12", "0x10", " 7 ", "abc", "", true, false,
                    null, undefined, [], [3], {}, 2 ** 53, -(2 ** 53) + 1];
    const expect = [0, 0, 1, -1, 1, -1, 2147483647, -2147483648,
                    2147483647, 5, -559939584, 559939584, 0, 0, 0, 12, 16, 7,
                    0, 0, 1, 0, 0, 0, 0, 3, 0, 0, 1];
    for (let i = 0; i < values.length; i++) {
        assert(Object.is(or0(values[i]), expect[i]), true);
        assert(or0(values[i]), ref(values[i]));
    }
    let calls = 0;
    assert(or0({ valueOf() { calls++; return 42.9; } }), 42);
    assert(calls, 1);
    assertThrows(TypeError, () => or0(1n));
    assertThrows(TypeError, () => or0(Symbol()));
    assertThrows(TypeError, () => or0({ valueOf() { return 1n; } }));
    assertThrows(RangeError, () => or0({ valueOf() { throw new RangeError(); } }));
    assert(0 | 7.5, 7);
    let acc = 0;
    for (let i = 0; i < 100; i++)
        acc = (acc + i * 1.5) | 0;
    assert(acc, 7400);
}

test_compare_branch();
function test_typed_array_read()
{
    const types = [Int8Array, Uint8Array, Uint8ClampedArray, Int16Array,
                   Uint16Array, Int32Array, Uint32Array, Float32Array,
                   Float64Array, BigInt64Array, BigUint64Array];
    const src = [0, 1, -1, 127, 128, 255, 256, 65535, 2 ** 31, -(2 ** 31), 1.5, -2.5];
    for (const T of types) {
        const big = T === BigInt64Array || T === BigUint64Array;
        const a = new T(src.length);
        for (let i = 0; i < src.length; i++)
            a[i] = big ? BigInt(Math.trunc(src[i])) : src[i];
        const read = (t, i) => t[i];
        let out = [];
        for (let i = 0; i < src.length; i++)
            out.push(read(a, i));
        assert(out.join(), Array.from(a).join());
        assert(read(a, src.length), undefined);
        assert(read(a, -1), undefined);
        assert(read(a, 1.5), undefined);
        // detached buffer: no element
        const b = new T(new ArrayBuffer(8 * T.BYTES_PER_ELEMENT));
        assert(read(b, 0), big ? 0n : 0);
        b.buffer.transfer();
        assert(read(b, 0), undefined);
    }
    // a resizable buffer shrinking under the view
    const rab = new ArrayBuffer(16, { maxByteLength: 32 });
    const u8 = new Uint8Array(rab);
    u8[15] = 7;
    const read = (t, i) => t[i];
    assert(read(u8, 15), 7);
    rab.resize(8);
    assert(read(u8, 15), undefined);
    assert(u8.length, 8);
}

test_or_zero();
test_typed_array_read();
