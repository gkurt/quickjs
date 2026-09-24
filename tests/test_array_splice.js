// splice() and unshift() of fast arrays move the elements in one block,
// and deleting the last element keeps the array dense: check the results
// and the cases which must take the generic path.
import { assert, assertThrows } from "./assert.js";

function str(a) {
    return JSON.stringify(a);
}

var a = [1, 2, 3, 4, 5];
assert(str(a.splice(1, 2)), "[2,3]");
assert(str(a), "[1,4,5]");
assert(a.length, 3);

a = [1, 2, 3];
assert(str(a.splice(1, 0, "x", "y")), "[]");
assert(str(a), '[1,"x","y",2,3]');

a = [1, 2, 3];
a.splice(1, 1, 7, 8, 9);
assert(str(a), "[1,7,8,9,3]");

a = [1, 2, 3];
a.splice(0, 3, 9);
assert(str(a), "[9]");

a = [1, 2, 3];
a.splice(3, 0, 4);
assert(str(a), "[1,2,3,4]");

a = [1, 2, 3];
assert(a.unshift(0, -1), 5);
assert(str(a), "[0,-1,1,2,3]");

// more removed elements than the temporary buffer holds
var big = [];
for (var i = 0; i < 100; i++)
    big.push({ i });
var removed = big.splice(10, 50);
assert(removed.length, 50);
assert(removed[0].i, 10);
assert(big.length, 50);
assert(big[10].i, 60);

// repeated splices keep working on the same array
var q = [];
for (var i = 0; i < 1000; i++)
    q.splice(q.length >> 1, 0, i);
for (var i = 0; i < 1000; i++)
    q.splice(q.length >> 1, 1);
assert(q.length, 0);

// deleting the last element leaves a hole at the end
a = [1, 2, 3];
assert(delete a[2], true);
assert(a.length, 3);
assert(2 in a, false);
assert(a[2], undefined);
a.push(4);
assert(a.length, 4);
assert(2 in a, false);
assert(a[3], 4);

a = [1, 2, 3];
delete a[0];
assert(0 in a, false);
assert(a[1], 2);

// a hole reads the prototype
Array.prototype[2] = "proto";
a = [1, 2, 3];
delete a[2];
assert(a[2], "proto");
delete Array.prototype[2];

// frozen arrays and species take the generic path
a = Object.freeze([1, 2, 3]);
assertThrows(TypeError, () => a.splice(0, 1));
assertThrows(TypeError, () => a.unshift(0));

class MyArray extends Array {}
var m = MyArray.from([1, 2, 3]);
var r = m.splice(0, 1);
assert(r instanceof MyArray, true);
assert(str(m), "[2,3]");

// a setter of the prototype sees the elements added past the end
var seen = [];
Object.defineProperty(Array.prototype, 3, {
    set(v) { seen.push(v); }, configurable: true,
});
a = [1, 2, 3];
a.splice(1, 0, "x");
assert(str(seen), '[3]');
delete Array.prototype[3];

// array-like receivers
var o = { length: 3, 0: "a", 1: "b", 2: "c" };
Array.prototype.splice.call(o, 1, 1);
assert(o.length, 2);
assert(o[1], "c");
assert(2 in o, false);
Array.prototype.unshift.call(o, "z");
assert(o.length, 3);
assert(o[0], "z");
assert(o[2], "c");
