// Helper of bench/ts_runtimes_bench.mjs, run as
//   bun bench/ts_runtimes_bun.ts <job.json> <result.json>
// Bun runs every file, JavaScript included, through its transpiler before
// JavaScriptCore compiles the result. For every file: the transpiler on
// the TypeScript and on the type-blanked JavaScript twin (the outputs are
// the same program, printed the same way), and, as an approximation of
// the JavaScriptCore compile that follows either, `new Function` on the
// output with its import and export statements removed (module code
// cannot be compiled without being linked and run).
import fs from "node:fs";

const [job_path, result_path] = Bun.argv.slice(2);
const job = JSON.parse(fs.readFileSync(job_path, "utf8"));
const now = () => performance.now();
function measure(fn: () => unknown, rounds: number, min_ms: number) {
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
const ts_loader = new Bun.Transpiler({ loader: "ts" });
const js_loader = new Bun.Transpiler({ loader: "js" });
// module syntax -> script: drop import statements, `export ... from` and
// export lists, remove the `export` keyword elsewhere
function asScript(code: string) {
    return code
        .replace(/^import\s+[^;'"]*?from\s*["'][^"']*["'];?[ \t]*$/gm, "")
        .replace(/^import\s*["'][^"']*["'];?[ \t]*$/gm, "")
        .replace(/^export\s*\*(\s*as\s+\w+)?\s*from\s*["'][^"']*["'];?[ \t]*$/gm, "")
        .replace(/^export\s*\{[^}]*\}(\s*from\s*["'][^"']*["'])?;?[ \t]*$/gm, "")
        .replace(/^export default /gm, "")
        .replace(/^export /gm, "");
}
let unique = 0;
const compile = (code: string) => new Function(code + "\n//" + (unique++));

const files: Record<string, Record<string, number | string>> = {};
for (const { name, ts, js } of job.files) {
    const r = files[name] = {};
    try {
        const out = ts_loader.transformSync(ts);
        js_loader.transformSync(js);
        const script = asScript(out);
        compile(script);
        r.transpile_ts = measure(() => ts_loader.transformSync(ts), job.rounds, job.min_ms);
        r.transpile_js = measure(() => js_loader.transformSync(js), job.rounds, job.min_ms);
        r.compile_out = measure(() => compile(script), job.rounds, job.min_ms);
    } catch (e: any) {
        r.error = String(e.message || e).split("\n")[0];
    }
}
fs.writeFileSync(result_path, JSON.stringify({ version: Bun.version, files }));
