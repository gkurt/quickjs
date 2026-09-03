// Bytecode oracle for TypeScript type erasure.
//
// For each NAME below, NAME.ts is compiled as TypeScript and
// NAME_blank.js, its twin in which every type has been replaced by
// spaces, is compiled as JavaScript. The two must produce byte-identical
// bytecode, including line and column debug information. The twin is
// also compiled with the TypeScript flag on: type erasure must not change
// how plain JavaScript compiles.
//
// test_typescript_blank.js is generated with ts-blank-space:
//   node -e 'const t=require("ts-blank-space").default,fs=require("fs");
//            fs.writeFileSync(process.argv[2],t(fs.readFileSync(process.argv[1],"utf8")))' \
//        tests/test_typescript.ts tests/test_typescript_blank.js
// test_typescript_angle_blank.js is blanked by hand (ts-blank-space does
// not support angle-bracket assertions).
import * as std from "qjs:std";
import * as bjson from "qjs:bjson";
import { assert } from "./assert.js";

const pairs = ["test_typescript", "test_typescript_angle"];

// directory of this file, as a path usable by std.loadFile(). run-test262
// does not set import.meta.url; it runs from the top of the source tree.
const dir = import.meta.url
    ? import.meta.url
        .replace(/^file:\/\//, "")
        .replace(/^\/([A-Za-z]:)/, "$1")
        .replace(/\/[^/]*$/, "")
    : "tests";

// compile without running; returns an ArrayBuffer of bytecode or the
// compilation error
function compile(src, filename, module, typescript) {
    try {
        const obj = std.evalScript(src, {
            compile_only: true,
            compile_module: module,
            typescript,
            filename, // so that relative imports resolve
        });
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

// `exact`: the errors must be identical too; otherwise both must fail
// with the same kind of error (a module compiled as a script fails at its
// first import, which may be a type-only import in the TypeScript source)
function check(what, a, b, exact) {
    if (a instanceof ArrayBuffer && b instanceof ArrayBuffer) {
        const i = firstDifference(a, b);
        assert(i, -1, `${what}: bytecode differs at offset ${i} (${a.byteLength} vs ${b.byteLength} bytes)`);
        return true;
    }
    assert(a instanceof ArrayBuffer, false, `${what}: only the JavaScript twin failed: ${b}`);
    assert(b instanceof ArrayBuffer, false, `${what}: only the TypeScript source failed: ${a}`);
    if (exact)
        assert(String(a), String(b), `${what}: different errors`);
    else
        assert(a.constructor, b.constructor, `${what}: different errors: ${a} / ${b}`);
    return false;
}

for (const name of pairs) {
    const ts = std.loadFile(`${dir}/${name}.ts`);
    const js = std.loadFile(`${dir}/${name}_blank.js`);
    assert(typeof ts, "string", `${name}.ts not found`);
    assert(typeof js, "string", `${name}_blank.js not found`);
    assert(ts.length, js.length, `${name}: the twin must preserve positions`);
    for (const line of ts.split("\n").keys()) {
        assert(ts.split("\n")[line].length, js.split("\n")[line].length,
               `${name}: line ${line + 1} of the twin has a different length`);
    }
    let compiled = 0;
    const filename = `${dir}/${name}.ts`;
    for (const module of [true, false]) {
        const what = `${name} (${module ? "module" : "script"})`;
        const fromTs = compile(ts, filename, module, true);
        const fromJs = compile(js, filename, module, false);
        if (check(what, fromTs, fromJs, false))
            compiled++;
        check(what + ", twin with the TypeScript flag", compile(js, filename, module, true), fromJs, true);
    }
    assert(compiled > 0, true, `${name}: did not compile in any mode`);
}
