// Map and Set key handling: hashing, SameValueZero equivalence, deletion
// and iteration order for every key type. Regression test for the hash of
// number and object keys, which used to leave the low bits of the hash
// constant and put sequential integer keys into a handful of buckets.
import { assert, assertArrayEquals } from "./assert.js";

function check_keys(keys, label) {
    // insert, look up, overwrite, delete half, look up again, iteration order
    const m = new Map();
    for (let i = 0; i < keys.length; i++)
        m.set(keys[i], i);
    assert(m.size, keys.length, label + ": size after insert");
    for (let i = 0; i < keys.length; i++) {
        assert(m.has(keys[i]), true, label + ": has " + String(keys[i]));
        assert(m.get(keys[i]), i, label + ": get " + String(keys[i]));
    }
    for (let i = 0; i < keys.length; i++)
        m.set(keys[i], -i);
    assert(m.size, keys.length, label + ": size after overwrite");
    for (let i = 0; i < keys.length; i++)
        assert(m.get(keys[i]), -i, label + ": overwritten value");
    let deleted = 0;
    for (let i = 0; i < keys.length; i += 2)
        deleted += m.delete(keys[i]) ? 1 : 0;
    assert(deleted, Math.ceil(keys.length / 2), label + ": deleted count");
    assert(m.size, keys.length - deleted, label + ": size after delete");
    for (let i = 0; i < keys.length; i++) {
        assert(m.has(keys[i]), (i & 1) === 1, label + ": has after delete " + String(keys[i]));
        assert(m.delete(keys[i]), (i & 1) === 1, label + ": second delete " + String(keys[i]));
    }
    assert(m.size, 0, label + ": empty");

    // insertion order is preserved and survives deletions in the middle
    for (let i = 0; i < keys.length; i++)
        m.set(keys[i], i);
    for (let i = 1; i < keys.length; i += 3)
        m.delete(keys[i]);
    const expected = [];
    for (let i = 0; i < keys.length; i++)
        if ((i % 3) !== 1)
            expected.push(i);
    assertArrayEquals([...m.values()], expected);

    // the same keys work in a Set
    const s = new Set(keys);
    assert(s.size, keys.length, label + ": Set size");
    for (const k of keys)
        assert(s.has(k), true, label + ": Set has " + String(k));
}

function range(n, f) {
    return Array.from({ length: n }, (_, i) => f(i));
}

// small sequential integers are the common case and used to collide
check_keys(range(1200, i => i), "sequential ints");
check_keys(range(1200, i => -i - 1), "negative ints");
check_keys(range(1200, i => i * 1024), "multiples of 1024");
check_keys(range(1200, i => i * 1000003), "large stride ints");
check_keys(range(600, i => 2 ** 31 - 1 - i), "ints near INT32_MAX");
check_keys(range(600, i => -(2 ** 31) + i), "ints near INT32_MIN");
check_keys(range(600, i => 2 ** 32 + i), "ints beyond uint32");
check_keys(range(600, i => 2 ** 53 - i), "ints near 2**53");
check_keys(range(1200, i => i + 0.5), "halves");
check_keys(range(1200, i => i * 0.1), "tenths");
check_keys(range(600, i => i * 1e-300), "denormal-ish floats");
check_keys(range(600, i => i * 1e300), "huge floats");
check_keys(range(600, i => 2 ** (i - 1000)), "powers of two");
check_keys(range(1200, i => "k" + i), "strings");
check_keys(range(600, i => "\u00e9\u4e2d" + i), "wide strings");
check_keys(range(600, i => ("x" + i).repeat(20)), "long strings");
check_keys(range(1200, i => ({ i })), "objects");
check_keys(range(600, i => [i]), "arrays");
check_keys(range(600, i => () => i), "functions");
check_keys(range(600, i => Symbol("s" + i)), "symbols");
check_keys(range(600, i => BigInt(i)), "small bigints");
check_keys(range(600, i => BigInt(i) << 70n), "large bigints");
check_keys(range(600, i => BigInt(i) - (1n << 70n)), "negative large bigints");
check_keys([true, false, null, undefined, 0, -1, NaN, Infinity, -Infinity, "", "0", 0n, {}, Symbol()], "mixed");

// a Map that mixes every key type must still find each key
{
    const keys = [
        ...range(150, i => i), ...range(150, i => i + 0.25), ...range(150, i => "k" + i),
        ...range(150, i => ({})), ...range(150, i => BigInt(i) * 3n), ...range(150, i => Symbol(i)),
    ];
    check_keys(keys, "mixed types");
}

// SameValueZero: +0 and -0 are one key, NaN is one key, int and float
// representations of the same number are one key
{
    const m = new Map();
    m.set(0, "zero");
    assert(m.get(-0), "zero");
    m.set(-0, "minus zero");
    assert(m.size, 1);
    assert(m.get(0), "minus zero");
    assert(Object.is([...m.keys()][0], 0), true, "the key stays +0");

    m.set(NaN, "nan");
    assert(m.get(NaN), "nan");
    assert(m.get(0 / 0), "nan");
    assert(m.get(-NaN), "nan");
    m.set(Number("x"), "nan2");
    assert(m.size, 2);

    m.set(1, "int");
    assert(m.get(1.0), "int");
    assert(m.get(3 / 3), "int");
    assert(m.get(0.5 + 0.5), "int");
    m.set(2 ** 31, "big");
    assert(m.get(2147483648), "big");
    assert(m.get(2147483647 + 1), "big");
    m.set(1e21, "float int");
    assert(m.get(1000000000000000000000), "float int");
    assert(m.size, 5);

    // distinct numbers stay distinct
    assert(m.has(1.0000000000000002), false);
    assert(m.has(2 ** 31 + 1), false);
    assert(m.has(-1), false);
    assert(m.has(Infinity), false);

    // bigints are not numbers, strings are not numbers
    m.set(1n, "bigint");
    m.set("1", "string");
    assert(m.get(1), "int");
    assert(m.get(1n), "bigint");
    assert(m.get("1"), "string");
    assert(m.size, 7);
    assert(m.has(1n + 0n), true);
    assert(m.has(BigInt(2 ** 70)), false);
    m.set(2n ** 70n, "big bigint");
    assert(m.get(BigInt(2 ** 70)), "big bigint");
    assert(m.get(2n ** 70n + 1n - 1n), "big bigint");
    assert(m.has(2n ** 70n + 1n), false);

    // Set uses the same equivalence
    const s = new Set([0, -0, NaN, NaN, 1, 1.0, 1n, "1", 2 ** 31, 2147483648]);
    assert(s.size, 6);
}

// objects hash by identity, not by content
{
    const m = new Map();
    const a = { x: 1 }, b = { x: 1 };
    m.set(a, "a");
    assert(m.has(b), false);
    assert(m.get(a), "a");
    // objects allocated at the same address after the key is gone must not
    // find the stale entry (the entry keeps the key alive, so they cannot)
    for (let i = 0; i < 1000; i++) {
        const k = {};
        m.set(k, i);
        assert(m.get(k), i);
        m.delete(k);
    }
    assert(m.size, 1);
}

// growing and shrinking: many insertions and deletions keep lookups correct
{
    const m = new Map();
    for (let round = 0; round < 3; round++) {
        for (let i = 0; i < 5000; i++)
            m.set(i, round);
        assert(m.size, 5000);
        for (let i = 0; i < 5000; i += 2)
            m.delete(i);
        assert(m.size, 2500);
        for (let i = 0; i < 5000; i++)
            assert(m.get(i), (i & 1) ? round : undefined);
        for (let i = 1; i < 5000; i += 2)
            m.delete(i);
        assert(m.size, 0);
    }
    // re-adding a deleted key appends it at the end of the iteration order
    m.set(1, 1); m.set(2, 2); m.set(3, 3);
    m.delete(1);
    m.set(1, 1);
    assertArrayEquals([...m.keys()], [2, 3, 1]);
}

// iteration sees keys added during iteration and skips deleted ones
{
    const m = new Map([[1, 1], [2, 2], [3, 3]]);
    const seen = [];
    for (const [k] of m) {
        seen.push(k);
        if (k === 1) {
            m.delete(2);
            m.set(4, 4);
        }
    }
    assertArrayEquals(seen, [1, 3, 4]);
}

// WeakMap and WeakSet with many object keys
{
    const wm = new WeakMap();
    const ws = new WeakSet();
    const keys = range(1200, () => ({}));
    keys.forEach((k, i) => { wm.set(k, i); ws.add(k); });
    keys.forEach((k, i) => {
        assert(wm.get(k), i);
        assert(ws.has(k), true);
    });
    keys.forEach((k, i) => { if (i & 1) { wm.delete(k); ws.delete(k); } });
    keys.forEach((k, i) => {
        assert(wm.has(k), (i & 1) === 0);
        assert(ws.has(k), (i & 1) === 0);
    });
    const sym = Symbol("weak");
    wm.set(sym, "symbol key");
    assert(wm.get(sym), "symbol key");
}
