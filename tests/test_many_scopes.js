// Scope indexes of the bytecode emitter are 16 bits: an if statement no
// longer takes a scope of its own, and a function with more than 65536
// scopes is a SyntaxError rather than miscompiled.
import { assert, assertThrows } from "./assert.js";

function ifs(n) {
    let src = "let x = 0;\n";
    for (let i = 0; i < n; i++)
        src += "if (a) x++; else x--;\n";
    return new Function("a", src + "return x;");
}
for (const n of [65534, 65535, 65536, 70000]) {
    const f = ifs(n);
    assert(f(true), n);
    assert(f(false), -n);
}

function blocks(n) {
    let src = "let x = 0;\n";
    for (let i = 0; i < n; i++)
        src += "{ x++; }\n";
    return new Function(src + "return x;");
}
assert(blocks(65000)(), 65000);
assertThrows(SyntaxError, () => blocks(70000));

// Annex B.3.4: a function declaration in a branch is in a block of its own
let r = (0, eval)("let f = 1; if (1) function f() {} f");
assert(r, 1);
r = (0, eval)("if (1) function g() { return 2 } else function h() {} [g(), typeof h]");
assert(r.join(), "2,undefined");
r = (0, eval)("if (0) ; else function k() { return 3 } k()");
assert(r, 3);
