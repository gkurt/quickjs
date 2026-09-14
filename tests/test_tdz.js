// Temporal dead zone of lexical declarations (let, const, class, `this`
// in derived constructors). The compiler removes the initialization check
// from accesses it can prove initialized on every path; every access it
// cannot prove must still throw a ReferenceError, and the ones it can
// must behave exactly like before.
import { assert, assertThrows } from "./assert.js";

function throws(fn, label) {
    let ok = false;
    try { fn(); } catch (e) { ok = e instanceof ReferenceError; if (!ok) throw e; }
    assert(ok, true, label + ": ReferenceError expected");
}

// --- accesses that must still throw ------------------------------------------

throws(() => { x; let x = 1; }, "read before let");
throws(() => { x; const x = 1; }, "read before const");
throws(() => { x = 2; let x = 1; }, "write before let");
throws(() => { typeof x; let x = 1; }, "typeof before let");
throws(() => { new C(); class C {} }, "class used before declaration");
throws(() => { x++; let x = 1; }, "increment before let");
throws(() => { x += 1; let x = 1; }, "compound assignment before let");
throws(() => { const y = x + 1; let x = 1; }, "read in initializer before let");
throws(() => { let x = x + 1; }, "self referencing initializer");
throws(() => { const x = x; }, "const self reference");
throws(() => { { x; } let x = 1; }, "read in nested block before let");
throws(() => { for (let i = 0; i < 1; i++) { x; } let x = 1; }, "read in loop before let");
throws(() => { switch (1) { case 0: let x = 1; case 1: x; } }, "switch: case skips the declaration");
throws(() => { switch (1) { case 0: let x = 1; break; case 1: x = 2; } }, "switch: write skips the declaration");
throws(() => { switch (1) { case 0: const c = 1; case 1: c; } }, "switch: const");
throws(() => {
    // the declaration is executed in the previous iteration, but every
    // iteration re-enters the scope
    for (let i = 0; i < 2; i++) { if (i === 1) x; let x = i; }
}, "block re-entered by a loop");
throws(() => {
    let i = 0;
    while (true) { if (i === 1) x; let x = i; if (++i > 1) break; }
}, "while body re-entered");
throws(() => {
    let i = 0;
    do { if (i === 1) x; let x = 1; i++; } while (i < 2);
}, "do-while body before declaration on second iteration");
throws(() => { label: { break label; } x; let x = 1; }, "read after labeled block, before let");
throws(() => { if (Math.random() < 2) { } else { let x = 1; return x; } x; let x = 2; }, "read in one branch, declared in another");
throws(() => { try { throw 1; } catch (e) { x; } let x = 1; }, "read in catch before let");
throws(() => { try { x; } finally { } let x = 1; }, "read in try before let");
throws(() => { try { } finally { x; } let x = 1; }, "read in finally before let");
throws(() => { const f = () => x; f(); let x = 1; }, "closure read before let");
throws(() => { const f = () => { x = 1; }; f(); let x; }, "closure write before let");
throws(() => { function g() { return x; } g(); let x = 1; }, "hoisted function read before let");
throws(() => { class B { constructor() { this.a = 1; } } class D extends B { constructor() { this.b = 2; super(); } } new D(); }, "this before super()");
throws(() => { class B {} class D extends B { constructor() { const t = () => this; t(); super(); } } new D(); }, "this in arrow before super()");
throws(() => { class B {} class D extends B { constructor(c) { if (c) super(); this.x = 1; } } new D(false); }, "this after conditional super()");
throws(() => { class B {} class D extends B { constructor() { super(); super(); } } new D(); }, "super() twice");
throws(() => { function* g() { x; let x = 1; yield x; } g().next(); }, "generator read before let");
throws(() => { let x = (() => x)(); }, "initializer calls closure reading the variable");
throws(() => { const o = { get v() { return x; } }; o.v; let x = 1; }, "getter reads before let");
throws(() => { eval("x"); let x = 1; }, "direct eval reads before let");
throws(() => { class C { static m() { return C2; } } class C2 extends C { static [C2.m()]() {} } }, "class name in computed key before initialization");
throws(() => { class C { static x = C2; } class C2 { } }, "static field reads later class");
throws(() => {
    // the label after the switch merges a path that executed the
    // declaration with one that did not
    let v = 1;
    switch (v) { case 1: break; case 2: let z = 1; }
    switch (v) { case 0: let z = 1; case 1: z; }
}, "switch after another switch");
throws(() => {
    let out;
    for (const k of [1]) { out = () => y; }
    out();
    let y = 1;
}, "closure created in loop, called before let");

// --- accesses that must work -------------------------------------------------

{
    const n = 3;
    let sum = 0;
    for (let i = 0; i < n; i++) { const sq = i * i; sum += sq + n; }
    assert(sum, 14);
}
{
    let i = 0, acc = 0;
    while (i < 5) { const d = i * 2; acc += d; i++; }
    assert(acc, 20);
    do { const d = i; acc += d; i--; } while (i > 0);
    assert(acc, 35);
}
{
    const fs = [];
    for (let i = 0; i < 3; i++) fs.push(() => i);
    assert(fs.map(f => f()).join(), "0,1,2");
    const gs = [];
    for (const v of [1, 2, 3]) gs.push(() => v * 2);
    assert(gs.map(g => g()).join(), "2,4,6");
    for (let i = 0; i < 2; i++) { let j = i; const f = () => j++; f(); assert(j, i + 1); }
}
{
    let x = 1;
    { let x = 2; assert(x, 2); { let x = 3; assert(x, 3); } assert(x, 2); }
    assert(x, 1);
    { const y = x + 1; x = y; }
    assert(x, 2);
}
{
    let r = 0;
    switch (2) { case 1: let a = 1; r = a; break; case 2: let b = 2; r = b; break; }
    assert(r, 2);
    switch (1) { case 1: let c = 1; r = c; case 2: r += c; }
    assert(r, 2);
}
{
    let r = 0;
    try { const a = 1; r = a; throw new Error("x"); } catch (e) { const b = 2; r += b; } finally { const c = 3; r += c; }
    assert(r, 6);
    const before = 10;
    try { r = before; } finally { r += before; }
    assert(r, 20);
    try { throw 1; } catch (e) { r = before + e; }
    assert(r, 11);
}
{
    class B { constructor() { this.a = 1; } }
    class D extends B { constructor() { super(); this.b = this.a + 1; } m() { return this.b; } }
    assert(new D().m(), 2);
    class E extends B { constructor(c) { if (c) { super(); } else { super(); } this.c = 3; } }
    assert(new E(true).c, 3);
    class F extends B { constructor() { super(); const t = () => this.a; this.t = t(); } }
    assert(new F().t, 1);
    class G { static s = 5; static t = G.s + 1; m() { return G.t; } }
    assert(new G().m(), 6);
    const C = class Named { f() { return Named; } };
    assert(new C().f(), C);
}
{
    function* g(n) { for (let i = 0; i < n; i++) { const v = yield i; if (v) i += v; } }
    const it = g(10);
    assert(it.next().value, 0); assert(it.next(2).value, 3); assert(it.next().value, 4);
    async function af() { const a = await 1; let b = a + 1; b += await 1; return b; }
    assert(await af(), 3);
}
{
    let out = 0;
    outer: for (let i = 0; i < 3; i++) {
        for (let j = 0; j < 3; j++) { const p = i * j; if (p === 2) continue outer; if (p === 4) break outer; out += p; }
    }
    assert(out, 1);
    let k = 0;
    lbl: { const q = 5; k = q; if (k) break lbl; k = 0; }
    assert(k, 5);
}
{
    // conditional initialization: the check stays and passes at runtime
    let x;
    if (Math.random() < 2) x = 1;
    assert(x, 1);
    let y;
    for (let i = 0; i < 1; i++) y = i;
    assert(y, 0);
}
{
    // a variable read and written from many places, including closures
    let count = 0;
    const inc = () => ++count;
    for (let i = 0; i < 10; i++) { if (i & 1) inc(); else count += 2; }
    assert(count, 15);
    const [a, b = a + 1, ...rest] = [1, undefined, 3, 4];
    const { p, q = p * 2 } = { p: 3 };
    assert(a + b + rest.length + p + q, 14);
}
{
    // eval creating and using variables, and using enclosing lexicals
    const base = 7;
    let r = eval("let e = base + 1; e * 2");
    assert(r, 16);
    assert(eval("const f = () => base; f()"), 7);
}
{
    // arguments and this pseudo variables next to lexical ones
    function h(a) { const b = arguments.length; let c = this === undefined ? 0 : 1; return a + b + c; }
    assert(h(1, 2), 3);
    assert(h.call({}, 1), 3);
    function n() { const t = new.target; let v = t ? 1 : 0; return v; }
    assert(n(), 0);
    assert(new n() instanceof n, true);
}
