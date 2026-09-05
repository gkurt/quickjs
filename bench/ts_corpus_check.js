// Bytecode oracle over a corpus: every <corpus>/ts/NAME.ts compiled as
// TypeScript must produce the same bytecode as its type-blanked twin
// <corpus>/js/NAME.js compiled as JavaScript, debug information included
// (bench/ts_corpus.mjs builds such a corpus). The same check as
// tests/test_ts_bytecode.js, on real-world code; catches miscompiles that
// do not show up as syntax errors.
//
//   qjs bench/ts_corpus_check.js <corpus>
import * as std from "qjs:std";
import * as os from "qjs:os";
import * as bjson from "qjs:bjson";
import { stubImports } from "./ts_module_stubs.js";

const corpus = scriptArgs[1];
if (!corpus) {
    console.log("usage: qjs bench/ts_corpus_check.js <corpus>");
    std.exit(1);
}
const [names, err] = os.readdir(`${corpus}/ts`);
if (err) {
    console.log(`cannot read ${corpus}/ts: ${std.strerror(err)}`);
    std.exit(1);
}

function compile(src, filename, typescript) {
    try {
        const obj = std.evalScript(src, { compile_only: true, compile_module: true, typescript, filename });
        return bjson.write(obj, bjson.WRITE_OBJ_BYTECODE | bjson.WRITE_OBJ_STRIP_SOURCE);
    } catch (e) {
        return e;
    }
}

// bytes 1-4 hold a checksum of the source, which of course differs
function firstDifference(a, b) {
    const x = new Uint8Array(a), y = new Uint8Array(b);
    const n = Math.min(x.length, y.length);
    for (let i = 5; i < n; i++) {
        if (x[i] !== y[i])
            return i;
    }
    return x.length === y.length ? -1 : n;
}

let checked = 0, failed = 0;
for (const f of names.filter(n => n.endsWith(".ts")).sort()) {
    const name = f.slice(0, -3);
    const ts = std.loadFile(`${corpus}/ts/${f}`), js = std.loadFile(`${corpus}/js/${name}.js`);
    if (typeof js !== "string") {
        console.log(`${name}: no twin`);
        continue;
    }
    stubImports(f, ts);
    const a = compile(ts, f, true), b = compile(js, f, false);
    checked++;
    if (a instanceof ArrayBuffer && b instanceof ArrayBuffer) {
        const i = firstDifference(a, b);
        if (i !== -1) {
            console.log(`${name}: bytecode differs at offset ${i} (${a.byteLength} vs ${b.byteLength} bytes)`);
            failed++;
        }
    } else if (!(a instanceof ArrayBuffer)) {
        console.log(`${name}: TypeScript does not compile: ${a}`);
        failed++;
    } else {
        console.log(`${name}: the JavaScript twin does not compile: ${b}`);
        failed++;
    }
}
console.log(`${checked} files checked, ${failed} failed`);
std.exit(failed ? 1 : 0);
