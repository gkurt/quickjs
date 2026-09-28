// "NaN" is a canonical numeric string (ToString(ToNumber("NaN")) is
// "NaN"), so it is not a valid integer index of a typed array: it is never
// an own property, and setting it is ignored, as for "-0" and "Infinity".
import { assert } from "./assert.js";

for (const ctor of [Int8Array, Float64Array, BigInt64Array]) {
    const ta = new ctor(2);
    const v = ctor === BigInt64Array ? 5n : 5;
    for (const k of ["NaN", "Infinity", "-Infinity", "-0", "1.5", "-1"]) {
        ta[k] = v;
        assert(ta[k], undefined, k);
        assert(Object.hasOwn(ta, k), false, k);
        assert(k in ta, false, k);
        assert(Reflect.defineProperty(ta, k, { value: v }), false, k);
    }
    // not canonical: ordinary properties
    for (const k of ["-NaN", "nan", "0x1", "01", "1e3"]) {
        ta[k] = v;
        assert(ta[k], v, k);
        assert(Object.hasOwn(ta, k), true, k);
    }
    assert(Object.keys(ta).join(), "0,1,-NaN,nan,0x1,01,1e3");
}
