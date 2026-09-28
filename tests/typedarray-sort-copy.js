// %TypedArray%.prototype.sort() reads the elements before sorting them
// (SortIndexedProperties): the comparison function sees the original
// values even when it modifies, shrinks or detaches the array
import { assert } from "./assert.js";

let ta = new Int32Array([3, 1, 2]);
let seen = [];
ta.sort((a, b) => {
    seen.push(a, b);
    ta[0] = 100;
    ta[1] = 100;
    ta[2] = 100;
    return a - b;
});
assert(ta.join(), "1,2,3");
assert(seen.every(v => v < 100), true);

// a resizable buffer shrunk by the comparison function
let rab = new ArrayBuffer(8 * 4, { maxByteLength: 8 * 4 });
ta = new Float64Array(rab);
ta.set([5, 4, 3, 2]);
let first = true;
ta.sort((a, b) => {
    if (first) {
        rab.resize(2 * 8);
        first = false;
    }
    return a - b;
});
assert(ta.length, 2);
assert(ta.join(), "2,3");

// detached by the comparison function
let buf = new ArrayBuffer(4 * 4);
ta = new Uint32Array(buf);
ta.set([4, 3, 2, 1]);
ta.sort((a, b) => {
    if (buf.byteLength)
        buf.transfer();
    return a - b;
});
assert(ta.length, 0);

// stable, and an exception of the comparison function is propagated
ta = new Uint8Array([2, 1, 2, 1]);
assert(ta.sort((a, b) => 0).join(), "2,1,2,1");
let e;
try {
    ta.sort(() => { throw new RangeError("cmp"); });
} catch (_e) {
    e = _e;
}
assert(e instanceof RangeError);
assert(ta.join(), "2,1,2,1");
