// The local variables of the bytecode functions are allocated on a stack of
// chunks of the runtime rather than on the C stack: deep calls with large
// frames cross the chunks, and the frames must stay valid for the closures,
// the exceptions and the generators which reference them.
import { assert, assertThrows } from "./assert.js";

// a function with a large frame: 40 local variables
function big(n, acc)
{
    let v0 = n, v1 = n + 1, v2 = n + 2, v3 = n + 3, v4 = n + 4;
    let v5 = v0 + v1, v6 = v1 + v2, v7 = v2 + v3, v8 = v3 + v4, v9 = v4 + v0;
    let w0 = v5, w1 = v6, w2 = v7, w3 = v8, w4 = v9;
    let w5 = w0 * 2, w6 = w1 * 2, w7 = w2 * 2, w8 = w3 * 2, w9 = w4 * 2;
    let x0 = w5 - v5, x1 = w6 - v6, x2 = w7 - v7, x3 = w8 - v8, x4 = w9 - v9;
    let x5 = x0, x6 = x1, x7 = x2, x8 = x3, x9 = x4;
    let y0 = [x5, x6, x7, x8, x9], y1 = y0.length, y2 = 0, y3, y4, y5, y6;
    for (y3 of y0)
        y2 += y3;
    y4 = y5 = y6 = y2;
    if (n == 0)
        return acc;
    // y4 = x5 + ... + x9 = 10 * n + 20: big(n, 0) = 5 * n * (n + 1) / 2
    return big(n - 1, acc + (y4 - 4 * y1) / 2);
}

const sum = (n) => 5 * n * (n + 1) / 2;

// the calls of big() which fit in the stack depend on the build (the
// sanitizers and the unoptimized builds use much larger C frames: 45 calls
// with clang -O0 in a thread of run-test262): the tests use half of them
let max_depth = 0;
function probe(n)
{
    // as many local variables as big()
    let p0 = n, p1, p2, p3, p4, p5, p6, p7, p8, p9,
        p10, p11, p12, p13, p14, p15, p16, p17, p18, p19,
        p20, p21, p22, p23, p24, p25, p26, p27, p28, p29,
        p30, p31, p32, p33, p34, p35, p36, p37, p38, p39;
    max_depth = n;
    return probe(n + 1) + p0;
}
assertThrows(RangeError, () => probe(0));
const DEPTH = Math.min(900, max_depth >> 1);
assert(max_depth >= 8, true);

function test_deep_calls()
{
    // several chunks of frames, then back to the first one
    for (let depth of [10, DEPTH >> 1, DEPTH])
        assert(big(depth, 0), sum(depth));
    // a call at the limit of a chunk, repeated
    function at(depth, f) {
        return depth == 0 ? f() : at(depth - 1, f);
    }
    for (let depth of [DEPTH >> 3, DEPTH >> 2, DEPTH >> 1]) {
        let count = 0;
        for (let i = 0; i < 200; i++)
            count += at(depth, () => big(3, 1));
        assert(count, 200 * 31);
    }
}

function test_closures()
{
    // the closures of the frames of every chunk keep their variables once
    // the frames are freed
    function make(n, fns) {
        let a = n, b = n * 2, c = [n], d, e, f, g, h, i, j, k, l, m, o;
        let p0, p1, p2, p3, p4, p5, p6, p7, p8, p9, q0, q1, q2, q3, q4;
        fns.push(() => a + b + c[0]);
        if (n > 0)
            make(n - 1, fns);
        a++;
        return fns;
    }
    const fns = make(DEPTH, []);
    assert(fns.length, DEPTH + 1);
    for (let i = 0; i < fns.length; i++) {
        const n = DEPTH - i;
        assert(fns[i](), n + 1 + n * 2 + n);
    }
}

function test_exceptions()
{
    // an exception thrown deep in the calls frees all the frames
    function thrower(n) {
        let a = n, b, c, d, e, f, g, h, i, j, k, l, m, o, p, q, r, s, t, u;
        if (n == 0)
            throw new Error("deep " + a);
        return thrower(n - 1) + 1;
    }
    for (let i = 0; i < 20; i++) {
        let msg;
        try {
            thrower(DEPTH);
        } catch (e) {
            msg = e.message;
        }
        assert(msg, "deep 0");
    }
    // caught half way, then deeper again
    const half = DEPTH >> 1;
    function catcher(n) {
        if (n == half) {
            try {
                return thrower(half);
            } catch (e) {
                return big(half, 0);
            }
        }
        return catcher(n + 1);
    }
    assert(catcher(0), sum(half));
    assert(big(DEPTH, 0), sum(DEPTH));
}

function test_stack_overflow()
{
    function infinite(n) {
        let a = n, b, c, d, e, f, g, h, i, j, k, l, m, o, p, q, r, s, t, u;
        return infinite(n + 1) + a;
    }
    for (let i = 0; i < 3; i++)
        assertThrows(RangeError, () => infinite(0));
    // the runtime is usable after the overflows
    assert(big(DEPTH, 0), sum(DEPTH));
}

function test_generators()
{
    // the frames of the generators are not on the stack of chunks: calls
    // made between their yields must not free the frames of the others
    function* gen(n) {
        let a = n;
        for (let i = 0; i < 3; i++) {
            const r = big((DEPTH >> 2) + i, a);
            yield r;
        }
    }
    const gens = [gen(1), gen(2), gen(3)];
    const out = [];
    function drive(depth) {
        if (depth > 0)
            return drive(depth - 1);
        for (let k = 0; k < 3; k++)
            for (const g of gens)
                out.push(g.next().value - big((DEPTH >> 2) + k, 0));
    }
    drive(DEPTH >> 2);
    assert(out.join(), "1,2,3,1,2,3,1,2,3");
    // a generator resumed from deep calls, calling deep itself
    function* deep() {
        while (true)
            yield big(DEPTH >> 1, 0);
    }
    const d = deep();
    function resume(n) {
        return n == 0 ? d.next().value : resume(n - 1);
    }
    for (let i = 0; i < 5; i++)
        assert(resume(DEPTH >> 1), sum(DEPTH >> 1));
}

async function test_async()
{
    async function f(n) {
        let a = n, b, c, d, e, f, g, h, i, j, k, l, m, o, p, q, r, s, t, u;
        await null;
        return big(DEPTH >> 1, 0) + a;
    }
    const r = await Promise.all([f(1), f(2), f(3)]);
    assert(r.join(), [1, 2, 3].map(n => sum(DEPTH >> 1) + n).join());
}

test_deep_calls();
test_closures();
test_exceptions();
test_stack_overflow();
test_generators();
await test_async();
