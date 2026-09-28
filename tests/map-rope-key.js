// A string rope (a long concatenation not yet flattened) and a flat string
// with the same characters are the same key of a Map or a Set: they must
// hash to the same bucket, whatever the size of the table.
import { assert } from "./assert.js";

const parts = [
    ["x".repeat(3000), "y".repeat(3000)],
    ["x".repeat(3000), "ሴy".repeat(1500)],             // 8 and 16 bits
    ["x".repeat(2000), "y".repeat(2000) + "z".repeat(2000)], // nested
];

for (const [a, b] of parts) {
    const flat = JSON.parse(JSON.stringify(a + b));
    for (const n of [0, 1, 3, 20, 1000]) {
        const m = new Map(), s = new Set();
        for (let i = 0; i < n; i++) {
            m.set(i, i);
            s.add(i);
        }
        m.set(a + b, "rope");
        s.add(a + b);
        assert(m.get(flat), "rope", `${n}`);
        assert(s.has(flat), true, `${n}`);
        m.set(flat, "flat");
        s.add(flat);
        assert(m.size, n + 1, `${n}`);
        assert(s.size, n + 1, `${n}`);
        assert(m.get(a + b), "flat", `${n}`);
        assert(m.delete(a + b), true, `${n}`);
        assert(m.has(flat), false, `${n}`);
        assert(s.delete(flat), true, `${n}`);
        assert(s.has(a + b), false, `${n}`);
    }
}
