// Helper of bench/ts_transpile_bench.mjs; not meant to be run by hand.
//
//   qjs bench/ts_transpile_qjs.js <job.json> <result.json>
//
// The job lists source texts to compile (not run) and whether each is
// TypeScript. Every source is compiled repeatedly and the best time in
// microseconds per compilation is written to the result file, or the
// error message when it does not compile. Compiling includes parsing and
// bytecode generation, i.e. everything QuickJS does with a source before
// running it.
//
// Modules are compiled against empty stubs of their imports (see
// ts_module_stubs.js), so only the file itself is measured. A context
// keeps every module it compiled, so compiling a source thousands of
// times retains memory, which slows down what is measured after it: every
// source is measured in a worker thread of its own, which has a fresh
// runtime.
//
// job:    { rounds, min_ms, files: [{ name, module, sources: { label: { code, typescript } } }] }
// result: { version, files: { name: { label: microseconds | { error } } } }
import * as std from "qjs:std";
import * as os from "qjs:os";
import { stubImports } from "./ts_module_stubs.js";

// milliseconds; os.now() counts microseconds
const now = os.now ? () => os.now() / 1000 : () => Date.now();

function compile(code, filename, module, typescript) {
    std.evalScript(code, { compile_only: true, compile_module: module, typescript, filename });
}

// microseconds per call: the best of `rounds` rounds of at least `min_ms`
// milliseconds each, to keep clock frequency changes and other noise out.
// Same method as ts_transpile_bench.mjs uses for the transpilers.
function measure(fn, rounds, min_ms) {
    let best = Infinity;
    fn(); fn();
    for (let r = 0; r < rounds; r++) {
        let n = 0, t0 = now(), t;
        do {
            fn();
            n++;
            t = now();
        } while (t - t0 < min_ms);
        best = Math.min(best, (t - t0) * 1000 / n);
    }
    return best;
}

// worker: measure one source
function measureSource({ name, module, imports, code, typescript, rounds, min_ms }) {
    const filename = name + (typescript ? ".ts" : ".js");
    try {
        if (module)
            stubImports(filename, imports);
        compile(code, filename, module, typescript);
    } catch (e) {
        return { error: String(e) };
    }
    return measure(() => compile(code, filename, module, typescript), rounds, min_ms);
}

if (os.Worker.parent) {
    const parent = os.Worker.parent;
    parent.onmessage = e => {
        parent.postMessage(measureSource(e.data));
        parent.onmessage = null; // done: terminates the worker
    };
} else {
    const [, job_path, result_path] = scriptArgs;
    if (!result_path) {
        console.log("usage: qjs bench/ts_transpile_qjs.js <job.json> <result.json>");
        std.exit(1);
    }
    const job = JSON.parse(std.loadFile(job_path));
    const inWorker = msg => new Promise(resolve => {
        const worker = new os.Worker("./ts_transpile_qjs.js");
        worker.onmessage = e => {
            worker.onmessage = null;
            resolve(e.data);
        };
        worker.postMessage(msg);
    });
    const files = {};
    for (const { name, module, sources } of job.files) {
        const results = files[name] = {};
        // the imports of the TypeScript source cover those of every output
        const imports = sources.ts.code;
        for (const [label, { code, typescript }] of Object.entries(sources))
            results[label] = await inWorker({ name, module, imports, code, typescript, rounds: job.rounds, min_ms: job.min_ms });
    }
    const version = typeof navigator === "object" && navigator.userAgent
        ? navigator.userAgent.replace(/^quickjs-ng\//, "") : "";
    const out = std.open(result_path, "w");
    out.puts(JSON.stringify({ version, files }));
    out.close();
}
