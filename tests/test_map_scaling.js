// Map and Set must spread every key type over the hash table.
//
// String keys are the reference: their hash is the well tested string hash.
// For every other key type the same sequence of operations is timed on the
// same number of keys and must not be much slower than with string keys.
// Both sides are timed alternately and the best round counts, so machine
// load, sanitizers and the parallel test runner affect them equally. With a
// hash that clusters keys into a few buckets the chains become hundreds of
// records long and the ratio explodes: sequential integer keys used to be
// about 16 times slower than string keys.
//
// Skipped under the GC stress build (gc-stress-skip.txt): a full GC on
// every allocation dwarfs the cost of the hash table.
import { assert } from "./assert.js";

const COUNT = 8192;
const ROUNDS = 3;
// number keys hash faster than string keys, so a ratio near 1 or below is
// expected; a collision problem gives 10 or more
const MAX_RATIO = 4;

function map_work(keys) {
    const m = new Map();
    for (let i = 0; i < COUNT; i++)
        m.set(keys[i], i);
    let t = 0;
    for (let i = 0; i < COUNT; i++)
        t += m.get(keys[i]) + (m.has(keys[i]) ? 1 : 0);
    for (let i = 0; i < COUNT; i++)
        m.delete(keys[i]);
    if (m.size !== 0 || t !== COUNT * (COUNT - 1) / 2 + COUNT)
        throw new Error("bogus result");
}

function set_work(keys) {
    const s = new Set();
    for (let i = 0; i < COUNT; i++)
        s.add(keys[i]);
    let t = 0;
    for (let i = 0; i < COUNT; i++)
        t += s.has(keys[i]) ? 1 : 0;
    for (let i = 0; i < COUNT; i++)
        s.delete(keys[i]);
    if (s.size !== 0 || t !== COUNT)
        throw new Error("bogus result");
}

function time(fn, keys) {
    const t0 = performance.now();
    fn(keys);
    return performance.now() - t0;
}

const string_keys = Array.from({ length: COUNT }, (_, i) => "key" + i);

function check(label, make_key, fn = map_work) {
    const keys = Array.from({ length: COUNT }, (_, i) => make_key(i));
    fn(keys); // warm up
    fn(string_keys);
    let best = Infinity, best_ref = Infinity;
    for (let r = 0; r < ROUNDS; r++) {
        best_ref = Math.min(best_ref, time(fn, string_keys));
        best = Math.min(best, time(fn, keys));
    }
    const ratio = best / Math.max(best_ref, 0.01);
    assert(ratio < MAX_RATIO, true,
           `${label}: ${COUNT} keys take ${ratio.toFixed(1)}x as long as string keys` +
           ` (${best.toFixed(2)} ms vs ${best_ref.toFixed(2)} ms)`);
}

check("sequential ints", i => i);
check("negative ints", i => -i);
check("even ints", i => 2 * i);
check("ints, stride 4096", i => i * 4096);
check("ints near 2**31", i => 2 ** 31 - 1 - i);
check("ints beyond 2**32", i => 2 ** 32 + i);
check("half floats", i => i + 0.5);
check("small floats", i => i * 1e-3);
check("large floats", i => i * 1e15);
check("objects", i => ({ i }));
check("symbols", i => Symbol(i));
check("bigints", i => BigInt(i));
check("big bigints", i => BigInt(i) << 64n);
check("wide strings", i => "\u00e9" + i);
check("sequential ints in a Set", i => i, set_work);
check("half floats in a Set", i => i + 0.5, set_work);
check("objects in a Set", () => ({}), set_work);
