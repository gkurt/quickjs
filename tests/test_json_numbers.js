// JSON.parse number handling. Covers the direct integer path (up to 9
// digits) against the strtod path (everything else), boundaries between
// the two, the sign of zero, syntax errors and the source text seen by a
// reviver.
import { assert, assertThrows } from "./assert.js";

function same(actual, expected, label) {
    assert(Object.is(actual, expected), true,
           (label || "") + " got " + String(actual) + " expected " + String(expected));
}

// integers with 1 to 9 digits take the direct path
same(JSON.parse("0"), 0);
same(JSON.parse("1"), 1);
same(JSON.parse("9"), 9);
same(JSON.parse("10"), 10);
same(JSON.parse("123456789"), 123456789);
same(JSON.parse("999999999"), 999999999);
same(JSON.parse("-1"), -1);
same(JSON.parse("-999999999"), -999999999);
same(JSON.parse("100000000"), 1e8);

// 10 digits and more take the generic path
same(JSON.parse("1000000000"), 1000000000);
same(JSON.parse("-1000000000"), -1000000000);
same(JSON.parse("2147483647"), 2147483647);
same(JSON.parse("2147483648"), 2147483648);
same(JSON.parse("-2147483648"), -2147483648);
same(JSON.parse("-2147483649"), -2147483649);
same(JSON.parse("4294967295"), 4294967295);
same(JSON.parse("4294967296"), 4294967296);
same(JSON.parse("9007199254740991"), 2 ** 53 - 1);
same(JSON.parse("9007199254740992"), 2 ** 53);
same(JSON.parse("9007199254740993"), 2 ** 53, "rounds to even");
same(JSON.parse("12345678901234567890"), 12345678901234567000);
same(JSON.parse("1" + "0".repeat(308)), 1e308);
same(JSON.parse("1" + "0".repeat(309)), Infinity);
same(JSON.parse("-1" + "0".repeat(309)), -Infinity);
same(JSON.parse("1" + "0".repeat(5000)), Infinity, "very long integer");

// the sign of zero
same(JSON.parse("-0"), -0);
same(JSON.parse("0"), 0);
same(JSON.parse("-0.0"), -0);
same(JSON.parse("0.0"), 0);
same(JSON.parse("-0e0"), -0);
same(JSON.parse("-0E5"), -0);
same(JSON.parse("[-0]")[0], -0);
same(JSON.parse('{"z":-0}').z, -0);

// fractions and exponents
same(JSON.parse("1.5"), 1.5);
same(JSON.parse("-1.5"), -1.5);
same(JSON.parse("0.1"), 0.1);
same(JSON.parse("1.0"), 1);
same(JSON.parse("1e3"), 1000);
same(JSON.parse("1E3"), 1000);
same(JSON.parse("1e+3"), 1000);
same(JSON.parse("1e-3"), 0.001);
same(JSON.parse("1.5e2"), 150);
same(JSON.parse("123456789e0"), 123456789);
same(JSON.parse("0.000001"), 0.000001);
same(JSON.parse("1e-400"), 0);
same(JSON.parse("-1e-400"), -0);
same(JSON.parse("5e-324"), 5e-324);
same(JSON.parse("1.7976931348623157e308"), 1.7976931348623157e308);
same(JSON.parse("0.30000000000000004"), 0.1 + 0.2);
same(JSON.parse("123456789.123456789"), 123456789.123456789);

// integers parsed from JSON behave exactly like integer literals
{
    const a = JSON.parse("[10,20,30,-5,0]");
    const arr = Array.from({ length: 40 }, (_, i) => i * 2);
    assert(arr[a[0]], 20, "array index");
    assert(arr[a[1]], 40, "array index");
    assert(a[0] === 10, true, "strict equality");
    assert(a[3] === -5, true);
    assert(a[4] === 0, true);
    assert(a[0] + a[1], 30);
    assert(a[0] * a[1], 200);
    assert(a[0] / 4, 2.5);
    assert(a[1] % 7, 6);
    assert(a[0] | 0, 10);
    assert(a[0] << 2, 40);
    assert(a[3] >>> 0, 4294967291);
    assert(a[0] ** 2, 100);
    assert(-a[0], -10);
    assert(typeof a[0], "number");
    assert(Number.isInteger(a[0]), true);
    assert(Number.isSafeInteger(a[3]), true);
    assert(String(a[3]), "-5");
    assert(a[0].toString(2), "1010");
    assert(a[0].toFixed(2), "10.00");
    assert(JSON.stringify(a), "[10,20,30,-5,0]");
    assert(new Uint8Array(4)[a[4]], 0);
    const m = new Map([[10, "ten"]]);
    assert(m.get(a[0]), "ten", "Map key equivalence");
    const s = new Set([-5]);
    assert(s.has(a[3]), true, "Set membership");
    const o = { 10: "prop" };
    assert(o[a[0]], "prop", "property key");
    assert(a.indexOf(20), 1);
    assert(a.includes(-5), true);
    assert([30, 10, 20].sort((x, y) => x - y).join(), "10,20,30");
    assert(Math.max(...a), 30);
    switch (a[1]) {
    case 20: break;
    default: throw new Error("switch on a parsed integer");
    }
}

// floats and big integers keep their value through arithmetic
{
    const b = JSON.parse("[2147483648, 1.5, -2147483649, 1e21]");
    assert(b[0] - 1, 2147483647);
    assert(b[0] === 2 ** 31, true);
    assert(b[1] * 2, 3);
    assert(b[2] + 1, -2147483648);
    assert(b[3], 1e21);
    assert(String(b[3]), "1e+21");
}

// nested structures
{
    const v = JSON.parse('{"a":[1,[2,[3,{"b":-4}]]],"c":{"d":5.5,"e":[0,-0,6e0]}}');
    assert(v.a[0], 1);
    assert(v.a[1][1][1].b, -4);
    assert(v.c.d, 5.5);
    same(v.c.e[1], -0);
    assert(v.c.e[2], 6);
    assert(JSON.stringify(v), '{"a":[1,[2,[3,{"b":-4}]]],"c":{"d":5.5,"e":[0,0,6]}}');
}

// whitespace around numbers
same(JSON.parse(" 42 "), 42);
same(JSON.parse("\n\t-7\r\n"), -7);
same(JSON.parse("[ 1 , 2 ]")[1], 2);
same(JSON.parse('{"a" : 3 }').a, 3);

// syntax errors: everything JSON does not allow in a number
for (const bad of [
    "+1", "+0", "01", "00", "-01", "-00", "-00000000", "000000001", "1.", "1.e5", ".5", "-.5", "-", "--1", "1e", "1e+", "1e-", "1E",
    "0x10", "1_000", "1 2", "Infinity", "-Infinity", "NaN", "1n", "\u0661", "1,", "[1,]", "[1 2]", "1.5.5", "1e5e5",
    "0b1", "0o7", "1f", "1d", "\u00001", "1\u0000", "- 1", "1 .5",
]) {
    assertThrows(SyntaxError, () => JSON.parse(bad));
}
// the error does not leak into later parses
same(JSON.parse("1"), 1);

// reviver: the value and the source text
{
    const seen = [];
    const v = JSON.parse('[1,-2,3.5,-0,1e2,12345678901,0.1]', function (k, v, ctx) {
        if (typeof v === "number")
            seen.push([v, ctx.source]);
        return v;
    });
    assert(JSON.stringify(seen), '[[1,"1"],[-2,"-2"],[3.5,"3.5"],[0,"-0"],[100,"1e2"],[12345678901,"12345678901"],[0.1,"0.1"]]');
    same(seen[3][0], -0, "reviver sees -0");
    assert(v.length, 7);
    assert(JSON.parse("[1,2,3]", (k, v) => typeof v === "number" ? v * 2 : v).join(), "2,4,6");
    assert(JSON.parse("7", (k, v) => typeof v === "number" ? v + 1 : v), 8);
}

// JSON.rawJSON and isRawJSON round trip numbers as written
if (typeof JSON.rawJSON === "function") {
    const raw = JSON.rawJSON("12345678901234567890");
    assert(JSON.stringify({ n: raw }), '{"n":12345678901234567890}');
    assert(JSON.stringify([JSON.rawJSON("-0"), JSON.rawJSON("1e2")]), "[-0,1e2]");
}

// stringify of every kind of number the parser can produce
assert(JSON.stringify(JSON.parse("[0,-0,1,-1,999999999,1000000000,2147483648,-2147483649,1.5,1e21,1e-7,123456789012]")),
       "[0,0,1,-1,999999999,1000000000,2147483648,-2147483649,1.5,1e+21,1e-7,123456789012]");
assert(JSON.stringify([Infinity, -Infinity, NaN]), "[null,null,null]");

// round trips preserve the value exactly
for (const n of [0, 1, -1, 7, 42, 999999999, 1000000000, 2 ** 31 - 1, 2 ** 31, -(2 ** 31), -(2 ** 31) - 1,
                 2 ** 53 - 1, 2 ** 53, 0.5, -0.5, 1e21, 1e-7, 3.141592653589793, 5e-324, 1.7976931348623157e308]) {
    same(JSON.parse(JSON.stringify(n)), n, "round trip of " + n);
    same(JSON.parse(JSON.stringify([n]))[0], n, "round trip in array of " + n);
}
// -0 stringifies as 0, so it does not round trip, by specification
same(JSON.parse(JSON.stringify(-0)), 0);

// many integers in one document
{
    const count = 20000;
    const text = "[" + Array.from({ length: count }, (_, i) => i - count / 2).join(",") + "]";
    const arr = JSON.parse(text);
    assert(arr.length, count);
    let sum = 0;
    for (let i = 0; i < count; i++) {
        if (arr[i] !== i - count / 2)
            throw new Error("wrong value at " + i);
        sum += arr[i];
    }
    assert(sum, -count / 2);
}
