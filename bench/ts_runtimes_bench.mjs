// Does erasing types cost QuickJS more than it costs Node or Bun?
//
//   node bench/ts_runtimes_bench.mjs [--qjs PATH] [--node PATH] [--bun PATH]
//                                    [--only quickjs,node,bun] [--files N] [--rounds N] [--min-ms N]
//                                    [--json FILE] [corpus]
//
// For every file of the corpus (bench/corpus by default, see
// bench/ts_corpus.mjs; the type-blanked twins are needed) each runtime
// gets the TypeScript ready to run and, for comparison, the same code
// with the types blanked out:
//
//   quickjs  compile to bytecode with the TypeScript flag  |  compile the twin
//   node     module.stripTypeScriptTypes (what `node file.ts` does), then
//            compile the output as a module with vm.SourceTextModule  |  compile the twin
//   bun      Bun.Transpiler with the ts loader, then JavaScriptCore compiles
//            the output  |  Bun.Transpiler with the js loader (Bun transpiles
//            JavaScript too), then the same compile
//
// The overhead is the ratio of the two. V8 and JavaScriptCore compile
// lazily (inner functions are pre-parsed, not compiled) while QuickJS
// compiles everything, so the compile columns are not comparable across
// runtimes; the overhead within each runtime is. Bun's compile step is
// approximated with `new Function` on the output with its import and
// export statements removed, since module code cannot be compiled without
// being run. Times are the best of a few rounds of repeated in-process
// calls, in a fresh process per file for QuickJS (a context keeps every
// module it compiled).
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const bench_dir = path.dirname(fileURLToPath(import.meta.url));
const root_dir = path.dirname(bench_dir);
const opts = { rounds: 3, min_ms: 50, files: 0, json: null, qjs: null, node: process.execPath, bun: "bun", only: null };
let corpus = path.join(bench_dir, "corpus");
for (let i = 2; i < process.argv.length; i++) {
    const a = process.argv[i];
    if (a === "--qjs") opts.qjs = process.argv[++i];
    else if (a === "--node") opts.node = process.argv[++i];
    else if (a === "--bun") opts.bun = process.argv[++i];
    else if (a === "--files") opts.files = +process.argv[++i];
    else if (a === "--rounds") opts.rounds = +process.argv[++i];
    else if (a === "--min-ms") opts.min_ms = +process.argv[++i];
    else if (a === "--json") opts.json = process.argv[++i];
    else if (a === "--only") opts.only = new Set(process.argv[++i].split(","));
    else if (a.startsWith("-")) {
        console.log("usage: node bench/ts_runtimes_bench.mjs [--qjs PATH] [--node PATH] [--bun PATH] [--only quickjs,node,bun] [--files N] [--rounds N] [--min-ms N] [--json FILE] [corpus]");
        process.exit(a === "-h" || a === "--help" ? 0 : 1);
    } else corpus = a;
}
if (!opts.qjs) {
    const built = path.join(root_dir, "build", process.platform === "win32" ? "qjs.exe" : "qjs");
    opts.qjs = fs.existsSync(built) ? built : "qjs";
}

// ---- corpus: TypeScript and its blanked twin
let files = [];
for (const f of fs.readdirSync(path.join(corpus, "ts")).filter(n => n.endsWith(".ts")).sort()) {
    const name = f.slice(0, -3), twin = path.join(corpus, "js", name + ".js");
    if (!fs.existsSync(twin))
        continue;
    const ts = fs.readFileSync(path.join(corpus, "ts", f), "utf8"), js = fs.readFileSync(twin, "utf8");
    files.push({ name, ts, js, module: /^(import|export)\b/m.test(ts), bytes: Buffer.byteLength(ts) });
}
if (files.length === 0) {
    console.log(`no files with twins in ${corpus}: run node bench/ts_corpus.mjs`);
    process.exit(1);
}
if (opts.files > 0 && files.length > opts.files) {
    files.sort((a, b) => a.bytes - b.bytes);
    const picked = [];
    for (let i = 0; i < opts.files; i++)
        picked.push(files[Math.round(i * (files.length - 1) / (opts.files - 1))]);
    files = picked.sort((a, b) => a.name < b.name ? -1 : 1);
}
const total_bytes = files.reduce((s, f) => s + f.bytes, 0);

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "ts-runtimes-"));
const job_path = path.join(tmp, "job.json"), result_path = path.join(tmp, "result.json");
function run(label, cmd, args, job) {
    process.stderr.write(`${label}...`);
    fs.writeFileSync(job_path, JSON.stringify(job));
    try {
        execFileSync(cmd, [...args, job_path, result_path], { stdio: ["ignore", "inherit", "inherit"] });
    } catch (e) {
        process.stderr.write(` failed: ${e.message.split("\n")[0]}\n`);
        return null;
    }
    process.stderr.write(" done\n");
    return JSON.parse(fs.readFileSync(result_path, "utf8"));
}

const want = name => !opts.only || opts.only.has(name);

// ---- QuickJS, one process per file
const qjs = want("quickjs") ? { version: "", files: {} } : null;
if (qjs)
    process.stderr.write(`${opts.qjs}...`);
for (const f of qjs ? files : []) {
    const job = { rounds: opts.rounds, min_ms: opts.min_ms,
                  files: [{ name: f.name, module: f.module, sources: { ts: { code: f.ts, typescript: true }, js: { code: f.js, typescript: false } } }] };
    fs.writeFileSync(job_path, JSON.stringify(job));
    execFileSync(opts.qjs, [path.join(bench_dir, "ts_transpile_qjs.js"), job_path, result_path], { stdio: "inherit" });
    const r = JSON.parse(fs.readFileSync(result_path, "utf8"));
    qjs.version = r.version;
    Object.assign(qjs.files, r.files);
}
if (qjs)
    process.stderr.write(" done\n");

// ---- Node and Bun
const job = { rounds: opts.rounds, min_ms: opts.min_ms, files: files.map(f => ({ name: f.name, ts: f.ts, js: f.js })) };
const node = want("node") && run("node", opts.node, ["--no-warnings", "--experimental-vm-modules", "--expose-gc", path.join(bench_dir, "ts_runtimes_node.mjs")], job);
const bun = want("bun") && run("bun", opts.bun, [path.join(bench_dir, "ts_runtimes_bun.ts")], job);
fs.rmSync(tmp, { recursive: true, force: true });

// ---- report
const ms = us => (us / 1000).toFixed(1);
const pct = (a, b) => "+" + ((a / b - 1) * 100).toFixed(1) + "%";
const ok = (res, f) => res && res.files[f.name] && !res.files[f.name].error;
const sum = (res, fn) => files.filter(f => ok(res, f)).reduce((s, f) => s + fn(res.files[f.name]), 0);
const errors = res => files.filter(f => res && !ok(res, f)).map(f => `${f.name}: ${res.files[f.name]?.error ?? "no result"}`);

console.log(`\n${files.length} files, ${(total_bytes / 1024).toFixed(0)} KB of TypeScript. Best of ${opts.rounds} rounds of >= ${opts.min_ms} ms, milliseconds, totals over the corpus.\n`);
console.log("runtime                                    TypeScript  blanked JS  overhead   of which erasing types");
const rows = [];
if (qjs) {
    const ts = sum(qjs, r => r.ts), js = sum(qjs, r => r.js);
    rows.push([`quickjs ${qjs.version} --ts (compile)`, ts, js, `${ms(ts - js)} ms in the parser`]);
}
if (node) {
    const strip = sum(node, r => r.strip), cs = sum(node, r => r.compile_stripped), js = sum(node, r => r.compile_js);
    rows.push([`node ${node.version} (strip + compile)`, strip + cs, js, `${ms(strip)} ms stripTypeScriptTypes`]);
}
if (bun) {
    const tts = sum(bun, r => r.transpile_ts), tjs = sum(bun, r => r.transpile_js), c = sum(bun, r => r.compile_out);
    rows.push([`bun ${bun.version} (transpile + compile*)`, tts + c, tjs + c, `${ms(tts - tjs)} ms more in the transpiler (${ms(tts)} vs ${ms(tjs)})`]);
}
for (const [name, ts, js, note] of rows)
    console.log(name.padEnd(42), ms(ts).padStart(10), ms(js).padStart(11), pct(ts, js).padStart(9), "  " + note);
if (bun)
    console.log("\n* Bun's compile step is approximated: new Function on the transpiler output with import/export statements removed.");
console.log("V8 and JavaScriptCore compile lazily, QuickJS compiles everything: compare overheads, not columns.");
for (const [label, res] of [["node", node], ["bun", bun]])
    for (const e of errors(res))
        console.log(`${label} fails on ${e}`);
if (opts.json)
    fs.writeFileSync(opts.json, JSON.stringify({ date: new Date().toISOString(), rounds: opts.rounds, min_ms: opts.min_ms,
        files: Object.fromEntries(files.map(f => [f.name, { bytes: f.bytes, quickjs: qjs?.files[f.name], node: node?.files[f.name], bun: bun?.files[f.name] }])),
        versions: { quickjs: qjs?.version, node: node?.version, v8: node?.v8, bun: bun?.version } }, null, 1));
