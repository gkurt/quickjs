// Helper of bench/ts_runtimes_bench.mjs, run as
//   node --experimental-vm-modules --expose-gc bench/ts_runtimes_node.mjs <job.json> <result.json>
// For every file: the time Node's type stripping takes on the TypeScript
// (module.stripTypeScriptTypes, which is what `node file.ts` does), the
// time V8 takes to compile its output as a module, and the time V8 takes
// to compile the type-blanked JavaScript twin. Each compile gets a unique
// trailing comment so that V8's compilation cache cannot serve it, and
// the garbage of one measurement is collected before the next.
import fs from "node:fs";
import { stripTypeScriptTypes } from "node:module";
import vm from "node:vm";
import { performance } from "node:perf_hooks";

const [job_path, result_path] = process.argv.slice(2);
const job = JSON.parse(fs.readFileSync(job_path, "utf8"));
const now = () => performance.now();
function measure(fn, rounds, min_ms) {
    let best = Infinity;
    globalThis.gc?.();
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
let unique = 0;
const compile = code => new vm.SourceTextModule(code + "\n//" + (unique++));
const strip = code => stripTypeScriptTypes(code, { mode: "strip" });

const files = {};
for (const { name, ts, js } of job.files) {
    const r = files[name] = {};
    try {
        const stripped = strip(ts);
        compile(stripped);
        compile(js);
        r.strip = measure(() => strip(ts), job.rounds, job.min_ms);
        r.compile_stripped = measure(() => compile(stripped), job.rounds, job.min_ms);
        r.compile_js = measure(() => compile(js), job.rounds, job.min_ms);
    } catch (e) {
        r.error = String(e.message || e).split("\n")[0];
    }
}
fs.writeFileSync(result_path, JSON.stringify({ version: process.versions.node, v8: process.versions.v8, files }));
