// Fast paths of the regexp engine, the parser and the interpreter: a
// pattern anchored with '^', the arrow function lookahead, strict
// equality, instanceof and computed property keys which are atoms.
// Each must match the generic semantics.
import { assert, assertThrows } from "./assert.js";

// '^' without the 'm' flag only matches at the start of the input
assert(/^ab/.exec("xab"), null);
assert(/^ab/.exec("abc")[0], "ab");
assert(/^a|b/.exec("xb")[0], "b");
assert(/^(a)|x/.exec("zx")[0], "x");
assert(/(?:^)?a/.exec("ba")[0], "a");
assert(/^a/m.exec("b\na")[0], "a");
assert(/^a/g.exec("aa")[0], "a");
var re = /^a/g;
re.lastIndex = 1;
assert(re.exec("aa"), null);
assert(re.lastIndex, 0);
assert("aXa".replace(/^a/g, "b"), "bXa");
assert("aaa".match(/^a/g).length, 1);
assert(/^a/y.exec("ba"), null);
assert(/^$/.test(""), true);
var long = " ".repeat(100000) + "'x'";
assert(/^(?:'([^']*)')/.exec(long), null);
assert(/^(?:'([^']*)')/.exec(long.slice(100000))[1], "x");

// arrow function lookahead
assert((function () { return 1; })(), 1);
assert(((a, b) => a + b)(1, 2), 3);
assert((() => 4)(), 4);
assert((({ a }) => a)({ a: 5 }), 5);
assert((([a]) => a)([6]), 6);
assert(((...a) => a.length)(1, 2, 3), 3);
assert((a => a)(7), 7);
assert(("s" + 1), "s1");
assert((-1), -1);
assert((!0), true);
assert((/x/).test("x"), true);
assert((`t${1}`), "t1");
assert((1 + 2) * 3, 9);
var { x: px } = { x: 8 };
assert(px, 8);
var qa, qb;
[qa, qb] = [1, 2];
assert(qa + qb, 3);
({ qa, qb } = { qa: 3, qb: 4 });
assert(qa + qb, 7);

// strict equality
var s1 = "abc", s2 = "ab" + "c", ob = {}, sym = Symbol();
assert(s1 === s2, true);
assert(s1 !== s2, false);
assert(s1 === "abc", true);
assert("x" === "y", false);
assert(ob === ob, true);
assert(ob === {}, false);
assert(null === null, true);
assert(null === undefined, false);
assert(null !== undefined, true);
assert(undefined === undefined, true);
assert(true === true, true);
assert(true === false, false);
assert(1 === true, false);
assert("1" === 1, false);
assert(sym === sym, true);
assert(sym === Symbol(), false);
assert(1n === 1n, true);
assert(1 === 1.0, true);
assert(NaN === NaN, false);
assert(0 === -0, true);
assert(s1 === new String(s1), false);
assert([s2].join("") === s1, true);
assert(Object.keys({ abc: 1 })[0] === s1, true);

// instanceof
class A {}
class B extends A {}
class H { static [Symbol.hasInstance](v) { return v === 1; } }
class HB extends H {}
assert(new B() instanceof A, true);
assert(new A() instanceof B, false);
assert(1 instanceof H, true);
assert(2 instanceof H, false);
assert(1 instanceof HB, true);
assert(new A() instanceof A.bind(null), true);
assert([] instanceof Array, true);
assert(Object.create(null) instanceof Object, false);
assert((function () {}) instanceof Function, true);
assert(1 instanceof A, false);
assertThrows(TypeError, () => ({}) instanceof {});
assertThrows(TypeError, () => ({}) instanceof { [Symbol.hasInstance]: 1 });
var F = function () {};
F.prototype = 1;
assertThrows(TypeError, () => ({}) instanceof F);
assert(new Proxy(new A(), {}) instanceof A, true);
assert(new A() instanceof new Proxy(A, {}), true);

// computed property keys
var ko = { a: 1, b: 2, "4294967295": 3, 7: 4 };
var out = [];
for (var k of Object.keys(ko))
    out.push(k + "=" + ko[k]);
for (var k in ko)
    out.push(ko[k]);
assert(out.join(","), "7=4,a=1,b=2,4294967295=3,4,1,2,3");
assert(ko["7"], 4);
assert(ko[String(7)], 4);
ko[Object.keys(ko)[1]] = 10;
assert(ko.a, 10);
