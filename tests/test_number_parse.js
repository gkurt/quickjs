// Number parsing: the fast path of js_atod() (a significand of at most 53
// bits with a power of ten of at most 10^22, integers in other radices up
// to 2^53) must give the same results as the general path, which a number
// with more than 19 significant digits always takes.
import { assert } from "./assert.js";

function same(actual, expected, label) {
    assert(Object.is(actual, expected), true,
           (label || "") + " got " + String(actual) + " expected " + String(expected));
}

// the same value with zeros appended to the significand, which forces the
// general path
function general(s) {
    var m = /^([-+]?)(\d*)(?:\.(\d*))?(?:[eE]([-+]?\d+))?$/.exec(s);
    return Number(m[1] + (m[2] || "") + "." + (m[3] || "") + "0".repeat(25) +
                  "e" + (m[4] || "0"));
}

var seed = 1;
function rnd(n) {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    return seed % n;
}
for (var i = 0; i < 20000; i++) {
    var digits = 1 + rnd(18), s = "";
    for (var j = 0; j < digits; j++)
        s += rnd(10);
    if (rnd(2)) {
        var dot = rnd(digits + 1);
        s = s.slice(0, dot) + "." + s.slice(dot);
    }
    if (rnd(3) == 0)
        s += "e" + (rnd(2) ? "-" : "") + rnd(30);
    if (rnd(4) == 0)
        s = "-" + s;
    same(Number(s), general(s), s);
    same(parseFloat(s), general(s), "parseFloat " + s);
}

// boundaries of the fast path
same(Number("9007199254740992"), 9007199254740992);
same(Number("9007199254740993"), 9007199254740992);
same(Number("9007199254740995"), 9007199254740996);
same(Number("1e22"), 1e22);
same(Number("1e23"), 1e23);
same(Number("123e-22"), 1.23e-20);
same(Number("1e-22"), 1e-22);
same(Number("1e-23"), 1e-23);
same(Number("1234567890123456789"), 1234567890123456800);
same(Number("0.1"), 0.1);
same(Number("0.30000000000000004"), 0.1 + 0.2);
same(Number("-0"), -0);
same(Number("-0.0e5"), -0);
same(Number("0e99999"), 0);
same(Number("5."), 5);
same(Number(".5"), 0.5);
same(Number("1.7976931348623157e308"), 1.7976931348623157e308);
same(Number("5e-324"), 5e-324);

// syntax handled by the general path
same(Number("1e"), NaN);
same(Number("1e+"), NaN);
same(Number("1_0"), NaN);
same(Number("."), NaN);
same(Number("1.5.3"), NaN);
same(parseFloat("1e"), 1);
same(parseFloat("1.5.3"), 1.5);
same(parseFloat("12abc"), 12);
same(parseFloat(".e1"), NaN);

// other radices
same(Number("0x1f"), 31);
same(Number("0b101"), 5);
same(Number("0o17"), 15);
same(Number("0x1fffffffffffff"), 9007199254740991);
same(Number("0x20000000000001"), 9007199254740992);
same(Number("0x20000000000003"), 9007199254740996);
same(parseInt("ff", 16), 255);
same(parseInt("zz", 36), 1295);
same(parseInt("123456789012345678901"), 123456789012345680000);
same(parseInt("12.5"), 12);

// literals
same(0x1fffffffffffff, 9007199254740991);
same(1_000_000, 1000000);
same(1.5e3, 1500);
same(.25, 0.25);
// legacy octal literals, sloppy mode only
same((0, eval)("0777"), 511);
same((0, eval)("08"), 8);
same(123456789012345678901234567890, 1.2345678901234568e29);
