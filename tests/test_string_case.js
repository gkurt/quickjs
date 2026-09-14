// String.prototype.toUpperCase / toLowerCase (and the toLocale* variants,
// which share the implementation). Covers the ASCII fast path and the
// generic Unicode path, with every internal string representation as input.
import { assert, assertThrows } from "./assert.js";

function check(input, upper, lower, label) {
    label = label || JSON.stringify(input);
    assert(input.toUpperCase(), upper, label + " toUpperCase");
    assert(input.toLowerCase(), lower, label + " toLowerCase");
    assert(input.toLocaleUpperCase(), upper, label + " toLocaleUpperCase");
    assert(input.toLocaleLowerCase(), lower, label + " toLocaleLowerCase");
    // converting twice is stable
    assert(upper.toUpperCase(), upper, label + " upper is stable");
    assert(lower.toLowerCase(), lower, label + " lower is stable");
    // the input is not modified
    assert(input, input.slice(), label + " input unchanged");
}

// --- ASCII -----------------------------------------------------------------

check("", "", "");
check("a", "A", "a");
check("Z", "Z", "z");
check("Hello World", "HELLO WORLD", "hello world");
check("HELLO", "HELLO", "hello");
check("hello", "HELLO", "hello");
check("hELLO wORLD", "HELLO WORLD", "hello world");
check("0123456789", "0123456789", "0123456789");
check(" \t\n\r\v\f", " \t\n\r\v\f", " \t\n\r\v\f");
// the characters around the letters in ASCII must not be touched: '@' and
// '[' surround A-Z, '`' and '{' surround a-z
check("@[`{", "@[`{", "@[`{");
check("!\"#$%&'()*+,-./:;<=>?@[\\]^_`{|}~", "!\"#$%&'()*+,-./:;<=>?@[\\]^_`{|}~", "!\"#$%&'()*+,-./:;<=>?@[\\]^_`{|}~");
check("\x00a\x7fB", "\x00A\x7fB", "\x00a\x7fb", "control chars");
check("aZ".repeat(1000), "AZ".repeat(1000), "az".repeat(1000), "long ASCII");
check("x".repeat(99) + "Y", "X".repeat(99) + "Y", "x".repeat(99) + "y", "change at the end");
check("Y" + "x".repeat(99), "Y" + "X".repeat(99), "y" + "x".repeat(99), "change at the start");

// every ASCII letter
{
    const lower = "abcdefghijklmnopqrstuvwxyz", upper = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
    for (let i = 0; i < 26; i++) {
        check(lower[i], upper[i], lower[i]);
        check(upper[i], upper[i], lower[i]);
    }
}

// every 8-bit character alone, against the generic single character mapping
for (let c = 0; c < 256; c++) {
    const s = String.fromCharCode(c);
    const up = s.toUpperCase(), lo = s.toLowerCase();
    // wrapping the character in ASCII text takes the same path as the
    // character alone; the results must agree
    assert(("ab" + s + "CD").toUpperCase(), "AB" + up + "CD", "upper of char " + c + " in ASCII context");
    assert(("ab" + s + "CD").toLowerCase(), "ab" + lo + "cd", "lower of char " + c + " in ASCII context");
    if (c < 128) {
        const expected_up = (c >= 0x61 && c <= 0x7a) ? String.fromCharCode(c - 32) : s;
        const expected_lo = (c >= 0x41 && c <= 0x5a) ? String.fromCharCode(c + 32) : s;
        assert(up, expected_up, "upper of ASCII char " + c);
        assert(lo, expected_lo, "lower of ASCII char " + c);
    }
}

// --- Latin-1 (8-bit strings with special cases) ------------------------------

check("caf\u00e9", "CAF\u00c9", "caf\u00e9");
check("\u00c9COLE", "\u00c9COLE", "\u00e9cole");
check("stra\u00dfe", "STRASSE", "stra\u00dfe", "sharp s expands");
check("\u00df", "SS", "\u00df", "sharp s alone");
check("a\u00dfb", "ASSB", "a\u00dfb", "sharp s in the middle");
check("\u00b5", "\u039c", "\u00b5", "micro sign maps outside Latin-1");
check("\u00ff", "\u0178", "\u00ff", "y with diaeresis maps outside Latin-1");
check("\u00e0\u00e1\u00e2\u00e3\u00e4\u00e5", "\u00c0\u00c1\u00c2\u00c3\u00c4\u00c5", "\u00e0\u00e1\u00e2\u00e3\u00e4\u00e5");
check("\u00aa\u00ba", "\u00aa\u00ba", "\u00aa\u00ba", "ordinal indicators are not cased");
check("\u00d7\u00f7", "\u00d7\u00f7", "\u00d7\u00f7", "multiplication/division signs");
check("Na\u00efve", "NA\u00cfVE", "na\u00efve");
check("ab" + "\u00e9".repeat(500), "AB" + "\u00c9".repeat(500), "ab" + "\u00e9".repeat(500), "long Latin-1");

// --- beyond Latin-1 (16-bit strings) ---------------------------------------

check("\u0130", "\u0130", "i\u0307", "capital I with dot above expands on lowering");
check("\u0131", "I", "\u0131", "dotless i");
check("\ufb00", "FF", "\ufb00", "ff ligature expands");
check("\ufb03", "FFI", "\ufb03", "ffi ligature expands to three");
check("\u0149", "\u02bcN", "\u0149", "n preceded by apostrophe");
check("\u01c5", "\u01c4", "\u01c6", "titlecase digraph");
check("\u03a3", "\u03a3", "\u03c3", "sigma alone");
check("\u03a3\u03a3", "\u03a3\u03a3", "\u03c3\u03c2", "final sigma at the end of a word");
check("\u03a3\u03a3 \u03a3", "\u03a3\u03a3 \u03a3", "\u03c3\u03c2 \u03c3", "sigma after a space is not final");
check("\u039f\u0394\u03a5\u03a3\u03a3\u0395\u03a5\u03a3", "\u039f\u0394\u03a5\u03a3\u03a3\u0395\u03a5\u03a3", "\u03bf\u03b4\u03c5\u03c3\u03c3\u03b5\u03c5\u03c2", "ODYSSEUS");
check("\u0410\u0411\u0412", "\u0410\u0411\u0412", "\u0430\u0431\u0432", "Cyrillic");
check("\u1e9e", "\u1e9e", "\u00df", "capital sharp s lowers into Latin-1");
check("\u4e2d\u6587", "\u4e2d\u6587", "\u4e2d\u6587", "uncased CJK");
check("\ud835\udc00", "\ud835\udc00", "\ud835\udc00", "uncased astral");
check("\ud801\udc00", "\ud801\udc00", "\ud801\udc28", "Deseret astral casing");
check("\ud801\udc28", "\ud801\udc00", "\ud801\udc28", "Deseret astral casing (lower)");
check("\ud800", "\ud800", "\ud800", "lone high surrogate");
check("\udc00", "\udc00", "\udc00", "lone low surrogate");
check("a\ud800b", "A\ud800B", "a\ud800b", "lone surrogate between ASCII");
// ASCII inside a 16-bit string takes the generic path and must agree
check("Hello \u4e16\u754c", "HELLO \u4e16\u754c", "hello \u4e16\u754c");
check("ABC\u4e16", "ABC\u4e16", "abc\u4e16");

// --- internal string representations ----------------------------------------

// concatenation of long strings creates ropes
{
    const a = "abc".repeat(200), b = "DEF".repeat(200);
    const rope = a + b;
    assert(rope.toUpperCase(), "ABC".repeat(200) + "DEF".repeat(200), "rope upper");
    assert(rope.toLowerCase(), "abc".repeat(200) + "def".repeat(200), "rope lower");
    const rope2 = (a + "\u00e9") + b;
    assert(rope2.toUpperCase(), "ABC".repeat(200) + "\u00c9" + "DEF".repeat(200), "rope with Latin-1 upper");
    let built = "";
    for (let i = 0; i < 100; i++)
        built += "aB" + i;
    let expected = "";
    for (let i = 0; i < 100; i++)
        expected += "AB" + i;
    assert(built.toUpperCase(), expected, "incrementally built string");
}

// substrings can share the parent's storage
{
    const parent = "xxHello Worldxx" + "\u00e9".repeat(10) + "zz";
    const slice = parent.substring(2, 13);
    assert(slice, "Hello World");
    assert(slice.toUpperCase(), "HELLO WORLD", "slice upper");
    assert(slice.toLowerCase(), "hello world", "slice lower");
    const long = "ab".repeat(100) + "CD".repeat(100);
    assert(long.slice(50, 250).toUpperCase(), long.slice(50, 250).split("").map(c => c.toUpperCase()).join(""), "long slice upper");
    assert(parent.slice(2), "Hello Worldxx" + "\u00e9".repeat(10) + "zz");
    assert(parent.slice(2).toUpperCase(), "HELLO WORLDXX" + "\u00c9".repeat(10) + "ZZ", "slice with Latin-1 upper");
}

// strings produced by other operations
{
    assert(String.fromCharCode(72, 105).toLowerCase(), "hi");
    assert([..."aBc"].join("").toUpperCase(), "ABC");
    assert("a,B,c".split(",").map(s => s.toUpperCase()).join(""), "ABC");
    assert(JSON.parse('"json Text"').toUpperCase(), "JSON TEXT");
    assert(`tem${"pla"}te`.toUpperCase(), "TEMPLATE");
    assert("abc".padEnd(6, "d").toUpperCase(), "ABCDDD");
    assert((123).toString().toUpperCase(), "123");
    assert("Mixed".normalize().toLowerCase(), "mixed");
    assert(String(Symbol("Desc").description).toUpperCase(), "DESC");
}

// --- results are independent values ---------------------------------------

{
    const s = "hello";
    const u = s.toUpperCase();
    assert(u, "HELLO");
    assert(u.length, 5);
    assert(u + "!", "HELLO!");
    assert(u.charCodeAt(0), 72);
    assert(u.indexOf("L"), 2);
    assert(u === "HELLO", true, "strict equality with a literal");
    assert(u.toLowerCase(), s);
    // an already converted string may come back as the same value; it must
    // still behave as an ordinary string
    const same = u.toUpperCase();
    assert(same, u);
    assert(same.slice(1), "ELLO");
    const o = {};
    o[same] = 1;
    assert(o.HELLO, 1);
    const m = new Map([[same, 2]]);
    assert(m.get("HELLO"), 2);
}

// --- this coercion ---------------------------------------------------------

assert(String.prototype.toUpperCase.call("abc"), "ABC");
assert(String.prototype.toUpperCase.call(new String("abc")), "ABC");
assert(String.prototype.toLowerCase.call(123), "123");
assert(String.prototype.toUpperCase.call(true), "TRUE");
assert(String.prototype.toUpperCase.call({ toString() { return "obj"; } }), "OBJ");
assert(String.prototype.toUpperCase.call(["a", "b"]), "A,B");
assertThrows(TypeError, () => String.prototype.toUpperCase.call(null));
assertThrows(TypeError, () => String.prototype.toUpperCase.call(undefined));
assertThrows(TypeError, () => String.prototype.toLowerCase.call(Symbol()));
assertThrows(TypeError, () => String.prototype.toUpperCase.call({ toString() { throw new TypeError("x"); } }));
assert(String.prototype.toUpperCase.length, 0);
assert(String.prototype.toLowerCase.length, 0);
