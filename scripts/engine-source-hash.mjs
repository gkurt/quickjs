#!/usr/bin/env node
/**
 * Prints the engine source hash: a 64-bit FNV-1a hash, as 16 lowercase
 * hex digits, of the engine's C sources, which identifies the engine
 * whatever the commit it was built from.
 *
 * Two builds of the engine, the npm package (npm/quickjs-wasi, where
 * build.sh records it as build.engine.sourceHash in package.json and as
 * vm.versions.engineSourceHash) and the Rust crate
 * (rust/rquickjs-sys/build.rs computes the same hash and exposes it as
 * rquickjs_sys::ENGINE_SOURCE_HASH), contain the same engine when their
 * hashes are equal. Any change to this computation must be made in both.
 *
 * The hash covers FILES, in this order. For each file it takes the bytes
 * of its name, one 0x00 byte, the bytes of the file with every CR (0x0D)
 * byte removed (so a checkout with CRLF line endings hashes the same),
 * and one 0x00 byte. FNV-1a 64: offset basis 0xcbf29ce484222325, prime
 * 0x100000001b3; for each byte b, h ^= b, then h = h * prime mod 2^64.
 *
 *   node scripts/engine-source-hash.mjs [engine source directory]
 *
 * The directory defaults to the root of this repository. Plain Node.js,
 * no dependencies.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const FILES = [
    'cutils.h',
    'dtoa.c',
    'dtoa.h',
    'libregexp-opcode.h',
    'libregexp.c',
    'libregexp.h',
    'libunicode-table.h',
    'libunicode.c',
    'libunicode.h',
    'list.h',
    'quickjs-atom.h',
    'quickjs-c-atomics.h',
    'quickjs-opcode.h',
    'quickjs.c',
    'quickjs.h',
    'builtin-array-fromasync.h',
    'builtin-iterator-zip.h',
    'builtin-iterator-zip-keyed.h',
];

const OFFSET_BASIS = 0xcbf29ce484222325n;

/** The engine source hash of the engine sources in `dir`. */
export function engineSourceHash(dir) {
    // FNV-1a on two 32-bit halves, as BigInt arithmetic per byte is slow
    // for quickjs.c: with prime = 2^40 + 0x1b3,
    // h * prime = h * 2^40 + h * 0x1b3 (mod 2^64).
    let hi = Number(OFFSET_BASIS >> 32n);
    let lo = Number(OFFSET_BASIS & 0xffffffffn);
    const feed = (b) => {
        lo = (lo ^ b) >>> 0;
        // (hi:lo) * 0x1b3
        const loMul = lo * 0x1b3;
        const carry = Math.floor(loMul / 0x100000000);
        let newLo = loMul >>> 0;
        let newHi = (Math.imul(hi, 0x1b3) + carry) >>> 0;
        // + (hi:lo) << 40, which only touches the high half: lo << 8
        newHi = (newHi + ((lo << 8) >>> 0)) >>> 0;
        hi = newHi;
        lo = newLo;
    };
    const encoder = new TextEncoder();
    for (const name of FILES) {
        for (const b of encoder.encode(name)) feed(b);
        feed(0);
        for (const b of readFileSync(join(dir, name))) {
            if (b !== 0x0d) feed(b);
        }
        feed(0);
    }
    return ((BigInt(hi) << 32n) | BigInt(lo)).toString(16).padStart(16, '0');
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
    const dir = process.argv[2] ?? fileURLToPath(new URL('..', import.meta.url));
    console.log(engineSourceHash(dir));
}
