// Edge cases of the replace fast path of standard regexps (js_regexp_replace):
// it must be taken only when nothing it skips is observable. The flags getter
// reads the flag getters, so an overridden "sticky" is called (as in the spec).
function eq(a, b) { if (a !== b) throw new Error("got " + JSON.stringify(a) + " expected " + JSON.stringify(b)); }
eq("foo boo zoo moo".replace(/o/g, "0"), "f00 b00 z00 m00");
eq("aaa bbb ccc".replace(/(b+) (c+)/g, "$2-$1[$&]$$`'"), "aaa ccc-bbb[bbb ccc]$`'");
eq("abc".replace(/b/, "[$`|$']"), "a[a|c]c");
eq("abc".replace(/x/g, "y"), "abc");
eq("abc".replace(/(?<n>b)/, "[$<n>]"), "a[b]c");
eq("abc".replace(/(?<n>b)/g, "[$1]"), "a[b]c");
eq("abc".replace(/b/, "[$<n>]"), "a[$<n>]c");
eq("abc".replace(/(x)?b/, "[$1]"), "a[]c");
eq("aaa".replace(/a*?/g, "-"), "-a-a-a-");
eq("aaa".replace(/a/g, ""), "");
eq("abab".replace(/a/g, ""), "bb");
eq("\u{1F600}\u{1F600}".replace(/(?:)/gu, "-"), "-\u{1F600}-\u{1F600}-");
eq("\u{1F600}".replace(/(?:)/g, "-").length, 5);
eq("\u{1F600}\u{1F600}".replace(/(?:)/gv, "-"), "-\u{1F600}-\u{1F600}-");
var r = /a/y; r.lastIndex = 1; eq("aaa".replace(r, "b"), "aba"); eq(r.lastIndex, 2);
r = /a/y; r.lastIndex = 3; eq("aaa".replace(r, "b"), "aaa"); eq(r.lastIndex, 0);
r = /a/y; r.lastIndex = 1.5; eq("aaa".replace(r, "b"), "aba"); eq(r.lastIndex, 2);
r = /a/g; r.lastIndex = 5; eq("aaa".replace(r, "b"), "bbb"); eq(r.lastIndex, 0);
r = /a/; r.lastIndex = 2; eq("aaa".replace(r, "b"), "baa"); eq(r.lastIndex, 2);
r = /a/g; Object.defineProperty(r, "lastIndex", {writable: false});
try { "aaa".replace(r, "b"); throw 1; } catch (e) { eq(e instanceof TypeError, true); }
r = /a/y; Object.defineProperty(r, "lastIndex", {writable: false, value: 0});
try { "aaa".replace(r, "b"); throw 1; } catch (e) { eq(e instanceof TypeError, true); }
r = /a/y; Object.defineProperty(r, "lastIndex", {writable: false, value: 0});
try { r.exec("aaa"); throw 1; } catch (e) { eq(e instanceof TypeError, true); }
var log = [];
r = /a/g; r.lastIndex = { valueOf() { log.push("v"); return 0; } };
eq("aa".replace(r, "b"), "bb");
r = /a/; r.lastIndex = { valueOf() { log.push("w"); return 0; } };
eq("aa".replace(r, "b"), "ba"); eq(log.join(), "w");
var d = Object.getOwnPropertyDescriptor(RegExp.prototype, "sticky");
Object.defineProperty(RegExp.prototype, "sticky", { get() { log.push("sticky"); return d.get.call(this); }, configurable: true });
eq("aa".replace(/a/g, "b"), "bb"); eq(log.join(), "w,sticky");
Object.defineProperty(RegExp.prototype, "sticky", d);
var ex = RegExp.prototype.exec;
RegExp.prototype.exec = function (s) { log.push("exec"); return ex.call(this, s); };
eq("aa".replace(/a/g, "b"), "bb"); eq(log.join(), "w,sticky,exec,exec,exec");
RegExp.prototype.exec = ex;
eq("aa".replace(/a/g, "b"), "bb"); eq(log.join(), "w,sticky,exec,exec,exec");
r = /a/g; r.exec = function (s) { log.push("own"); return null; };
eq("aa".replace(r, "b"), "aa"); eq(log.join(), "w,sticky,exec,exec,exec,own");
class R extends RegExp { exec(s) { log.push("sub"); return super.exec(s); } }
eq("aa".replace(new R("a", "g"), "b"), "bb"); eq(log.join(), "w,sticky,exec,exec,exec,own,sub,sub,sub");
r = /a/g; Object.defineProperty(r, "flags", { get() { log.push("flags"); return "g"; } });
eq("aa".replace(r, "b"), "bb"); eq(log.join(), "w,sticky,exec,exec,exec,own,sub,sub,sub,flags");
var m = /(\d+)-(\w+)(x)?/.exec("abc 123-foo def");
eq(m.length, 4); eq(m[0], "123-foo"); eq(m[1], "123"); eq(m[2], "foo"); eq(m[3], undefined); eq(m.index, 4); eq(m.input, "abc 123-foo def");
eq(Array.isArray(m), true); eq(JSON.stringify(m), '["123-foo","123","foo",null]');
m.push(1); eq(m.length, 5);
m = /(?<a>x)|(?<a>y)/d.exec("-y"); eq(m.groups.a, "y"); eq(m.indices.groups.a[0], 1);
eq(/a/dgimsuy.flags, "dgimsuy"); eq(/a/v.flags, "v");
eq("a-b-c".replaceAll("-", "$&$&"), "a--b--c"); eq("abc".replaceAll("", "_"), "_a_b_c_");
eq("aXbXc".replace("X", "[$`$']"), "a[abXc]bXc");
eq("x".replace(/x/, "$0$00$10"), "$0$00$10");
eq("Ābc".replace(/b/g, "$&$&"), "Ābbc");
eq("abc".replace(/b/g, "Ā"), "aĀc");
eq("abcabc".replace(/(?<x>b)/g, "[$<x>]"), "a[b]ca[b]c");
eq("abc".replace(/b/g, function (m, i, s) { return m + i; }), "ab1c");
eq("aXa".replace(/(?<q>a)/g, (...a) => typeof a[a.length - 1]), "objectXobject");
var o = { [Symbol.replace]: RegExp.prototype[Symbol.replace], exec() { return null; }, flags: "", lastIndex: 0 };
eq("aa".replace(o, "b"), "aa");
