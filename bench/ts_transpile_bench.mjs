// QuickJS's TypeScript type erasure compared with TypeScript transpilers.
//
//   node bench/ts_transpile_bench.mjs [options] [file-or-directory ...]
//
// QuickJS erases types while it parses, so a .ts file goes straight to
// bytecode. The alternative is to transpile it to JavaScript first with
// one of sucrase, esbuild, swc, oxc, babel, tsc (transpileModule),
// ts-blank-space or amaro (Node's type stripping) and to compile the
// output. This measures both for every file of a corpus: the time each
// transpiler takes, the time QuickJS then takes to compile its output, and
// the time QuickJS takes to compile the TypeScript directly. Every
// transpiler is configured to only erase types (no import elision, no
// downleveling), so all outputs are the same program. Times are the best
// of a few rounds of repeated in-process calls, i.e. warm; for the Node
// tools that means after JIT warm-up.
//
// Options:
//   --qjs PATH     qjs binary (default: build/qjs, else qjs in PATH)
//   --files N      keep at most N files, spread over the size range
//   --rounds N     rounds per measurement (default 3)
//   --min-ms N     minimum duration of a round in ms (default 50)
//   --only A,B     restrict to these transpilers
//   --per-file     also print a table per file
//   --json FILE    write all measurements to FILE
//
// Without arguments the corpus is bench/corpus/ts (see bench/ts_corpus.mjs)
// if it exists, else tests/test_typescript.ts. Directories are searched
// recursively for .ts/.mts/.cts files. Transpilers that are not installed
// (`npm install` in bench/) are skipped.
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { performance } from "node:perf_hooks";
import { fileURLToPath } from "node:url";

const bench_dir = path.dirname(fileURLToPath(import.meta.url));
const root_dir = path.dirname(bench_dir);
const require = createRequire(import.meta.url);

const opts = { rounds: 3, min_ms: 50, files: 0, per_file: false, json: null, only: null, qjs: null };
const inputs = [];
for (let i = 2; i < process.argv.length; i++) {
    const a = process.argv[i];
    if (a === "--qjs")
        opts.qjs = process.argv[++i];
    else if (a === "--files")
        opts.files = +process.argv[++i];
    else if (a === "--rounds")
        opts.rounds = +process.argv[++i];
    else if (a === "--min-ms")
        opts.min_ms = +process.argv[++i];
    else if (a === "--only")
        opts.only = new Set(process.argv[++i].split(","));
    else if (a === "--per-file")
        opts.per_file = true;
    else if (a === "--json")
        opts.json = process.argv[++i];
    else if (a.startsWith("-")) {
        console.log("usage: node bench/ts_transpile_bench.mjs [--qjs PATH] [--files N] [--rounds N] [--min-ms N] [--only A,B] [--per-file] [--json FILE] [file-or-directory ...]");
        process.exit(a === "-h" || a === "--help" ? 0 : 1);
    } else
        inputs.push(a);
}
if (!opts.qjs) {
    const built = path.join(root_dir, "build", process.platform === "win32" ? "qjs.exe" : "qjs");
    opts.qjs = fs.existsSync(built) ? built : "qjs";
}
if (inputs.length === 0) {
    const corpus = path.join(bench_dir, "corpus", "ts");
    inputs.push(fs.existsSync(corpus) ? corpus : path.join(root_dir, "tests", "test_typescript.ts"));
}

// ---- corpus

function* tsFiles(p) {
    const st = fs.statSync(p);
    if (st.isDirectory()) {
        for (const entry of fs.readdirSync(p, { withFileTypes: true }).sort((a, b) => a.name < b.name ? -1 : 1)) {
            if (entry.name === "node_modules")
                continue;
            yield* tsFiles(path.join(p, entry.name));
        }
    } else if (/\.[mc]?ts$/.test(p) && !/\.d\.[mc]?ts$/.test(p))
        yield p;
}

let files = [];
const used = new Set();
for (const input of inputs) {
    for (const file of tsFiles(input)) {
        const parts = file.replace(/\.[mc]?ts$/, "").split(/[\\/]/);
        let name, depth = 1;
        do {
            name = parts.slice(-depth).join("/");
            depth++;
        } while (used.has(name) && depth <= parts.length);
        used.add(name);
        const code = fs.readFileSync(file, "utf8");
        // like qjs: a .ts file is a module when it imports or exports
        const module = /\.mts$/.test(file) || /^(import|export)\b/m.test(code);
        files.push({ name, file, code, module, bytes: Buffer.byteLength(code) });
    }
}
if (files.length === 0) {
    console.log("no TypeScript files found");
    process.exit(1);
}
if (opts.files > 0 && files.length > opts.files) {
    files.sort((a, b) => a.bytes - b.bytes);
    const n = opts.files, picked = [];
    for (let i = 0; i < n; i++)
        picked.push(files[Math.round(i * (files.length - 1) / (n - 1))]);
    files = picked;
}
files.sort((a, b) => a.name < b.name ? -1 : 1);
const total_bytes = files.reduce((s, f) => s + f.bytes, 0);

// ---- transpilers
//
// Each entry loads a module and returns { version, run, sync, note } where
// run(code, filename) returns the JavaScript (or a promise of it).

function version(pkg) {
    try {
        return require(`${pkg}/package.json`).version;
    } catch {
        // package.json not exported: look for it above the entry point
        for (let dir = path.dirname(require.resolve(pkg)); ; dir = path.dirname(dir)) {
            const p = path.join(dir, "package.json");
            if (fs.existsSync(p)) {
                const info = JSON.parse(fs.readFileSync(p, "utf8"));
                if (info.name === pkg)
                    return info.version;
            }
            if (dir === path.dirname(dir))
                return "?";
        }
    }
}

const transpilers = {
    "sucrase": async () => {
        const { transform } = await import("sucrase");
        const options = { transforms: ["typescript"], keepUnusedImports: true, disableESTransforms: true };
        return { version: version("sucrase"), sync: true, run: code => transform(code, options).code };
    },
    "esbuild": async () => {
        const esbuild = await import("esbuild");
        const options = { loader: "ts", format: "esm", target: "esnext",
                          tsconfigRaw: { compilerOptions: { verbatimModuleSyntax: true } } };
        // the synchronous API spawns a process per call; the asynchronous
        // one talks to a long-lived service process
        return { version: esbuild.version, sync: false, note: "async API, includes the round trip to its service process",
                 run: async code => (await esbuild.transform(code, options)).code };
    },
    "swc": async () => {
        const swc = await import("@swc/core");
        const options = { jsc: { parser: { syntax: "typescript" }, target: "esnext",
                                 transform: { verbatimModuleSyntax: true } },
                          isModule: true, sourceMaps: false, swcrc: false, configFile: false };
        return { version: version("@swc/core"), sync: true,
                 run: (code, filename) => swc.transformSync(code, { ...options, filename }).code };
    },
    "oxc": async () => {
        const oxc = await import("oxc-transform");
        const options = { typescript: { onlyRemoveTypeImports: true }, target: "esnext", sourcemap: false };
        return { version: version("oxc-transform"), sync: true, run: (code, filename) => {
            const r = oxc.transformSync(filename, code, options);
            if (r.errors.length)
                throw new Error(r.errors[0].message);
            return r.code;
        } };
    },
    "tsc": async () => {
        const ts = (await import("typescript")).default;
        const compilerOptions = { target: ts.ScriptTarget.ESNext, module: ts.ModuleKind.ESNext, verbatimModuleSyntax: true };
        return { version: ts.version, sync: true, note: "ts.transpileModule",
                 run: (code, fileName) => ts.transpileModule(code, { fileName, compilerOptions, reportDiagnostics: false }).outputText };
    },
    "ts-blank-space": async () => {
        const blank = (await import("ts-blank-space")).default;
        return { version: version("ts-blank-space"), sync: true, note: "types replaced by blanks, positions preserved",
                 run: code => {
                     let error;
                     const js = blank(code, node => { error ??= new Error("unsupported syntax at offset " + node?.pos); });
                     if (error)
                         throw error;
                     return js;
                 } };
    },
    "amaro": async () => {
        const amaro = await import("amaro");
        return { version: version("amaro"), sync: true, note: "Node's type stripping (swc in wasm)",
                 run: code => amaro.transformSync(code, { mode: "strip-only" }).code };
    },
    "babel": async () => {
        const babel = await import("@babel/core");
        const preset = (await import("@babel/preset-typescript")).default;
        const options = { configFile: false, babelrc: false, compact: false, sourceMaps: false,
                          presets: [[preset, { onlyRemoveTypeImports: true }]] };
        return { version: babel.version, sync: true, note: "@babel/preset-typescript",
                 run: (code, filename) => babel.transformSync(code, { ...options, filename }).code };
    },
};

// ---- measurement
//
// microseconds per call: the best of `rounds` rounds of at least `min_ms`
// milliseconds each, to keep clock frequency changes and other noise out.
// Same method as ts_transpile_qjs.js uses inside QuickJS.

const now = () => performance.now();
function measureSync(fn, rounds, min_ms) {
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
async function measureAsync(fn, rounds, min_ms) {
    let best = Infinity;
    await fn(); await fn();
    for (let r = 0; r < rounds; r++) {
        let n = 0, t0 = now(), t;
        do {
            await fn();
            n++;
            t = now();
        } while (t - t0 < min_ms);
        best = Math.min(best, (t - t0) * 1000 / n);
    }
    return best;
}

const tools = {};   // name -> { version, note, results: { file name -> { transpile: us, code } | { error } } }
const skipped = [];
for (const [name, load] of Object.entries(transpilers)) {
    if (opts.only && !opts.only.has(name))
        continue;
    let tool;
    try {
        tool = await load();
    } catch (e) {
        skipped.push(`${name} (${e.code === "ERR_MODULE_NOT_FOUND" ? "not installed" : e.message})`);
        continue;
    }
    process.stderr.write(`${name} ${tool.version}...`);
    const results = {};
    for (const f of files) {
        const filename = path.basename(f.file);
        try {
            const code = await tool.run(f.code, filename);
            const measure = tool.sync ? measureSync : measureAsync;
            results[f.name] = { transpile: await measure(() => tool.run(f.code, filename), opts.rounds, opts.min_ms), code };
        } catch (e) {
            results[f.name] = { error: String(e.message || e).split("\n")[0] };
        }
    }
    process.stderr.write(" done\n");
    tools[name] = { version: tool.version, note: tool.note, results };
}

// QuickJS: the TypeScript directly, and the output of every transpiler.
// A context keeps every module it compiled, so compiling one file
// thousands of times retains memory and, after a while, slows down: each
// file gets a qjs process of its own.
process.stderr.write(`${opts.qjs}...`);
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "ts-transpile-bench-"));
const job_path = path.join(tmp, "job.json"), result_path = path.join(tmp, "result.json");
const qjs = { version: "", files: {} };
try {
    for (const f of files) {
        const sources = { ts: { code: f.code, typescript: true } };
        for (const [name, tool] of Object.entries(tools)) {
            const r = tool.results[f.name];
            if (r.code !== undefined)
                sources[name] = { code: r.code, typescript: false };
        }
        const job = { rounds: opts.rounds, min_ms: opts.min_ms, files: [{ name: f.name, module: f.module, sources }] };
        fs.writeFileSync(job_path, JSON.stringify(job));
        execFileSync(opts.qjs, [path.join(bench_dir, "ts_transpile_qjs.js"), job_path, result_path], { stdio: "inherit" });
        const result = JSON.parse(fs.readFileSync(result_path, "utf8"));
        qjs.version = result.version;
        Object.assign(qjs.files, result.files);
    }
} catch (e) {
    console.log(`\ncannot run ${opts.qjs}: ${e.message}`);
    process.exit(1);
} finally {
    fs.rmSync(tmp, { recursive: true, force: true });
}
process.stderr.write(" done\n");

// ---- report

const us = t => typeof t === "number" ? t.toFixed(0) : "-";
const mbps = (bytes, t) => typeof t === "number" ? (bytes / t).toFixed(1) : "-";
const ratio = (t, base) => typeof t === "number" && typeof base === "number" ? (t / base).toFixed(2) + "x" : "-";

const per_file = {};    // file -> { bytes, quickjs: us | error, tools: { name -> { transpile, compile, error } } }
for (const f of files) {
    const q = qjs.files[f.name];
    const entry = per_file[f.name] = { bytes: f.bytes, quickjs: q.ts, tools: {} };
    for (const [name, tool] of Object.entries(tools)) {
        const r = tool.results[f.name];
        if (r.error)
            entry.tools[name] = { error: r.error };
        else if (typeof q[name] !== "number")
            entry.tools[name] = { transpile: r.transpile, error: "output does not compile: " + q[name].error };
        else
            entry.tools[name] = { transpile: r.transpile, compile: q[name] };
    }
}

// totals: each tool over the files it handles, QuickJS over the same files
const bad_files = files.filter(f => typeof per_file[f.name].quickjs !== "number");
const ok_files = files.filter(f => !bad_files.includes(f));
const failures = {};
for (const name of Object.keys(tools))
    failures[name] = ok_files.filter(f => per_file[f.name].tools[name].error).map(f => f.name);
const sum = (list, fn) => list.reduce((s, f) => s + fn(per_file[f.name]), 0);
const bytes_of = list => list.reduce((s, f) => s + f.bytes, 0);

// rows: [name, version, files, bytes, transpile, compile, total, quickjs total on the same files, failures]
function table(rows) {
    console.log("tool                version  files    transpile  qjs compile        total  vs qjs --ts    MB/s  fail");
    for (const [name, ver, n, bytes, transpile, compile, total, base, fail] of rows) {
        console.log(name.padEnd(18), String(ver).padStart(10), String(n).padStart(6), us(transpile).padStart(12),
                    us(compile).padStart(12), us(total).padStart(12), ratio(total, base).padStart(12),
                    mbps(bytes, total).padStart(7), (fail ? String(fail) : "").padStart(5));
    }
}
function rowsFor(list) {
    const ts = sum(list, e => e.quickjs);
    const rows = [["quickjs --ts", qjs.version || "", list.length, bytes_of(list), undefined, ts, ts, ts, 0]];
    for (const [name, tool] of Object.entries(tools)) {
        const handled = list.filter(f => !per_file[f.name].tools[name].error);
        const transpile = sum(handled, e => e.tools[name].transpile), compile = sum(handled, e => e.tools[name].compile);
        rows.push([name, tool.version, handled.length, bytes_of(handled), transpile, compile,
                   handled.length ? transpile + compile : undefined, sum(handled, e => e.quickjs), list.length - handled.length]);
    }
    rows.splice(1, rows.length - 1, ...rows.slice(1).sort((a, b) => (a[6] ?? Infinity) - (b[6] ?? Infinity)));
    return rows;
}

console.log(`\n${ok_files.length} files, ${(bytes_of(ok_files) / 1024).toFixed(0)} KB of TypeScript. ` +
            `Best of ${opts.rounds} rounds of >= ${opts.min_ms} ms, microseconds; ` +
            "each tool over the files it handles, quickjs --ts compared on the same files.");
console.log(`node ${process.versions.node}, quickjs-ng ${qjs.version || "?"} (${opts.qjs})\n`);
table(rowsFor(ok_files));
const blank_ok = ok_files.filter(f => !per_file[f.name].tools["ts-blank-space"]?.error);
if (tools["ts-blank-space"] && blank_ok.length) {
    const blanked = sum(blank_ok, e => e.tools["ts-blank-space"].compile), ts = sum(blank_ok, e => e.quickjs);
    console.log(`\nquickjs compiles the same code without types (the ts-blank-space output) in ${us(blanked)} us: ` +
                `erasing the types costs ${((ts / blanked - 1) * 100).toFixed(1)}%`);
}
const notes = Object.entries(tools).filter(([, t]) => t.note).map(([n, t]) => `${n}: ${t.note}`);
if (notes.length)
    console.log("\n" + notes.join("\n"));
if (skipped.length)
    console.log(`\nskipped: ${skipped.join(", ")}`);
if (bad_files.length)
    console.log("");
for (const f of bad_files)
    console.log(`quickjs --ts fails on ${f.name}: ${per_file[f.name].quickjs.error}`);
if (Object.values(failures).some(l => l.length))
    console.log("");
for (const [name, list] of Object.entries(failures)) {
    for (const file of list)
        console.log(`${name} fails on ${file}: ${per_file[file].tools[name].error}`);
}

if (opts.per_file) {
    for (const f of ok_files) {
        console.log(`\n${f.name} (${(f.bytes / 1024).toFixed(1)} KB${f.module ? ", module" : ""})`);
        table(rowsFor([f]));
    }
}

if (opts.json) {
    fs.writeFileSync(opts.json, JSON.stringify({
        date: new Date().toISOString(), node: process.versions.node, quickjs: qjs.version, qjs: opts.qjs,
        platform: `${process.platform} ${os.arch()} ${os.cpus()[0]?.model ?? ""}`.trim(),
        rounds: opts.rounds, min_ms: opts.min_ms,
        tools: Object.fromEntries(Object.entries(tools).map(([n, t]) => [n, { version: t.version, note: t.note }])),
        files: per_file,
    }, null, 1));
    console.log(`\nwritten ${opts.json}`);
}
