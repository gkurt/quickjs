// Fetch a corpus of real-world TypeScript for bench/ts_parse_bench.js and
// bench/ts_transpile_bench.mjs.
//
//   node bench/ts_corpus.mjs [--out DIR] [--per-package N] [package[@version] ...]
//
// The sources of a few well known libraries that ship their .ts files on
// npm are downloaded with `npm pack` and written flat to DIR/ts/NAME.ts
// (default DIR: bench/corpus). Tests, declaration files, files under 1 KB
// and files that are not erasable TypeScript (enums, namespaces with code,
// parameter properties, ... as reported by ts-blank-space) are left out;
// of the rest up to N files per package (default 25) are kept, spread
// over the size range. DIR/js/NAME.js is the twin of each file with every
// type replaced by blanks, as bench/ts_parse_bench.js expects.
//
// Needs `npm` and `tar` on the PATH and ts-blank-space installed
// (`npm install` in bench/).
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const bench_dir = path.dirname(fileURLToPath(import.meta.url));
const default_packages = [
    "rxjs", "zod", "effect", "mobx", "@reduxjs/toolkit", "redux", "immer",
    "@tanstack/query-core",
];

let out_dir = path.join(bench_dir, "corpus"), per_package = 25;
const packages = [];
for (let i = 2; i < process.argv.length; i++) {
    const a = process.argv[i];
    if (a === "--out")
        out_dir = path.resolve(process.argv[++i]);
    else if (a === "--per-package")
        per_package = +process.argv[++i];
    else if (a === "-h" || a === "--help" || a.startsWith("-")) {
        console.log("usage: node bench/ts_corpus.mjs [--out DIR] [--per-package N] [package[@version] ...]");
        process.exit(a === "-h" || a === "--help" ? 0 : 1);
    } else
        packages.push(a);
}
if (packages.length === 0)
    packages.push(...default_packages);

let blank;
try {
    blank = (await import("ts-blank-space")).default;
} catch {
    console.error("ts-blank-space is not installed: run `npm install` in bench/");
    process.exit(1);
}

const npm = process.platform === "win32" ? "npm.cmd" : "npm";
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "ts-corpus-"));

const skip_re = /(^|[\\/])(test|tests|__tests__|spec|specs|fixtures|node_modules|examples?)([\\/]|$)|\.(spec|test|d)\.ts$/;
function* tsFiles(dir) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const p = path.join(dir, entry.name);
        if (entry.isDirectory())
            yield* tsFiles(p);
        else if (entry.name.endsWith(".ts") && !skip_re.test(p))
            yield p;
    }
}

// pick n items spread evenly over a sorted array
function spread(arr, n) {
    if (arr.length <= n)
        return arr;
    const picked = [];
    for (let i = 0; i < n; i++)
        picked.push(arr[Math.round(i * (arr.length - 1) / (n - 1))]);
    return picked;
}

fs.mkdirSync(path.join(out_dir, "ts"), { recursive: true });
fs.mkdirSync(path.join(out_dir, "js"), { recursive: true });
const used = new Set(fs.readdirSync(path.join(out_dir, "ts")).map(f => f.replace(/\.ts$/, "")));
let total_files = 0, total_bytes = 0;
console.log("package                        version   .ts  erasable   kept     KB");
for (const spec of packages) {
    let tgz;
    try {
        const dest = fs.mkdtempSync(path.join(tmp, "pkg-"));
        const info = JSON.parse(execFileSync(npm, ["pack", spec, "--pack-destination", dest, "--json", "--silent"],
                                             { encoding: "utf8", stdio: ["ignore", "pipe", "inherit"] }));
        tgz = { path: path.join(dest, info[0].filename), version: info[0].version, dest };
    } catch (e) {
        console.log(`${spec}: npm pack failed: ${e.message}`);
        continue;
    }
    execFileSync("tar", ["-xzf", tgz.path, "-C", tgz.dest]);
    const root = path.join(tgz.dest, "package");
    const candidates = [];
    let n_ts = 0;
    for (const file of tsFiles(root)) {
        n_ts++;
        const code = fs.readFileSync(file, "utf8");
        if (code.length < 1024)
            continue;
        let erasable = true;
        const js = blank(code, () => { erasable = false; });
        if (!erasable || js.length !== code.length)
            continue;
        candidates.push({ file, code, js });
    }
    candidates.sort((a, b) => a.code.length - b.code.length);
    const kept = spread(candidates, per_package);
    const short = spec.replace(/(.)@[^@]*$/, "$1").replace(/^@/, "").replace(/\//g, "-");
    let bytes = 0;
    for (const { file, code, js } of kept) {
        // NAME is package-basename, with parent directories added on collision
        const parts = path.relative(root, file).replace(/\.ts$/, "").split(/[\\/]/);
        let name, depth = 1;
        do {
            name = short + "-" + parts.slice(-depth).join("-");
            depth++;
        } while (used.has(name) && depth <= parts.length);
        used.add(name);
        fs.writeFileSync(path.join(out_dir, "ts", name + ".ts"), code);
        fs.writeFileSync(path.join(out_dir, "js", name + ".js"), js);
        bytes += code.length;
    }
    total_files += kept.length;
    total_bytes += bytes;
    console.log(spec.padEnd(28), tgz.version.padStart(10), String(n_ts).padStart(5),
                String(candidates.length).padStart(9), String(kept.length).padStart(6),
                (bytes / 1024).toFixed(0).padStart(6));
}
fs.rmSync(tmp, { recursive: true, force: true });
console.log(`${total_files} files, ${(total_bytes / 1024).toFixed(0)} KB, written to ${out_dir}`);
