// Inline paths of the interpreter: loose equality with objects, null and
// undefined, number accumulation in a local, and stores of numbers into
// typed arrays. Each must match the generic semantics.
import { assert, assertThrows } from "./assert.js";

function same(actual, expected, label) {
    assert(Object.is(actual, expected), true,
           (label || "") + " got " + String(actual) + " expected " + String(expected));
}

// loose equality
var o = {}, o2 = {};
assert(o == o, true);
assert(o != o, false);
assert(o == o2, false);
assert(o == null, false);
assert(o != undefined, true);
assert(null == o, false);
assert(undefined != o, true);
assert(null == undefined, true);
assert(undefined == undefined, true);
assert(null != null, false);
assert(0 == null, false);
assert("" == undefined, false);
assert(false == null, false);
assert(1 == 1.0, true);
assert(1.5 != 1, true);
assert(NaN == NaN, false);
assert("1" == 1, true);
assert({ valueOf() { return 3; } } == 3, true);
assert({ toString() { return "x"; } } != "x", false);
var f = function () {};
assert(f == f, true);
assert(f == null, false);
if (typeof $262 !== "undefined" && $262.IsHTMLDDA) {
    var dda = $262.IsHTMLDDA;
    assert(dda == null, true);
    assert(dda == undefined, true);
    assert(dda != null, false);
}

// number accumulation in a local
function acc() {
    var s = 0.5;
    for (var i = 0; i < 10; i++)
        s += i;
    var t = 2 ** 31;
    t += 1;
    var u = 1;
    u += 0.25;
    var z = -0;
    z += -0;
    var n = 0.1;
    n += 0.2;
    var v = "a";
    v += 1;
    var w = 1;
    w += "b";
    var x = 1n;
    x += 2n;
    var y = 1.5;
    y += { valueOf() { return 1; } };
    return [s, t, u, z, n, v, w, x, y];
}
var r = acc();
same(r[0], 45.5);
same(r[1], 2147483649);
same(r[2], 1.25);
same(r[3], -0);
same(r[4], 0.30000000000000004);
same(r[5], "a1");
same(r[6], "1b");
same(r[7], 3n);
same(r[8], 2.5);
assertThrows(TypeError, () => { var b = 1.5; b += 1n; });

// stores into typed arrays
var i8 = new Int8Array(4);
i8[0] = 200; i8[1] = -129; i8[2] = 1.9; i8[3] = "5";
assert(i8.join(), "-56,127,1,5");
var u8 = new Uint8Array(2);
u8[0] = -1; u8[1] = 263;
assert(u8.join(), "255,7");
var c8 = new Uint8ClampedArray(3);
c8[0] = 300; c8[1] = -5; c8[2] = 1.5;
assert(c8.join(), "255,0,2");
var i16 = new Int16Array(2);
i16[0] = 40000; i16[1] = -1;
assert(i16.join(), "-25536,-1");
var i32 = new Int32Array(3);
i32[0] = 2147483647; i32[1] = 4294967295; i32[2] = -0.5;
assert(i32.join(), "2147483647,-1,0");
var u32 = new Uint32Array(1);
u32[0] = -1;
assert(u32[0], 4294967295);
var f32 = new Float32Array(2);
f32[0] = 0.1; f32[1] = 3;
same(f32[0], Math.fround(0.1));
same(f32[1], 3);
var f64 = new Float64Array(2);
f64[0] = -0; f64[1] = 7;
same(f64[0], -0);
same(f64[1], 7);
var t = new Int32Array(2);
t[5] = 1; t[-1] = 2;
assert(t.length, 2);
assert(t[5], undefined);
var iv = new Int32Array(1);
iv[0] = { valueOf() { return 9; } };
assert(iv[0], 9);
var b64 = new BigInt64Array(1);
b64[0] = 5n;
assert(b64[0], 5n);
assertThrows(TypeError, () => { b64[0] = 1; });
var rab = new ArrayBuffer(8, { maxByteLength: 16 });
var ri = new Int32Array(rab);
rab.resize(4);
ri[1] = 3;
assert(ri.length, 1);
assert(ri[1], undefined);
rab.resize(16);
ri[3] = 4;
assert(ri[3], 4);
