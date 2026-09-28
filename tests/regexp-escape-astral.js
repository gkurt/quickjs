// RegExp.escape() works on code points: a surrogate pair is kept as is,
// a lone surrogate is escaped
import { assert } from "./assert.js";

assert(RegExp.escape("\u{1F600}"), "\u{1F600}");
assert(RegExp.escape("\u{1F600}1"), "\u{1F600}1");
assert(RegExp.escape("a\u{1F600}b"), "\\x61\u{1F600}b");
assert(RegExp.escape("\ud800c\udc00"), "\\ud800c\\udc00");
assert(RegExp.escape("\udc00\ud800"), "\\udc00\\ud800");
assert(RegExp.escape("x\ud83d"), "\\x78\\ud83d");
assert(RegExp.escape("\u2028\ufeff\u00e9"), "\\u2028\\ufeff\\xe9");
assert(new RegExp(RegExp.escape("\u{1F600}.")).test("\u{1F600}."), true);
