// Run the Octane 2.0 benchmark suite (https://github.com/chromium/octane).
//
//   qjs bench/octane.js [options] OCTANE_DIR [suite ...]
//
//   OCTANE_DIR      a checkout of the octane repository
//   suite           only run these suites (e.g. Richards Splay), all when
//                   none is given
//   --json FILE     also write the results to FILE as JSON (see upstream.js)
//   --list          print the suite names and exit
//
// Every suite runs in its own process, started with the same qjs binary as
// this script, so that the peak resident memory of each suite can be
// reported (read from /proc/self/status, so only on Linux) and a suite that
// crashes does not take the others down. The score of each benchmark is the
// one Octane computes (higher is better) and the total is their geometric
// mean, as in the official runner.
import * as std from "qjs:std";
import * as os from "qjs:os";

// suite name: the files it needs besides base.js, in load order
const SUITES = {
    Richards: ["richards.js"],
    DeltaBlue: ["deltablue.js"],
    Crypto: ["crypto.js"],
    RayTrace: ["raytrace.js"],
    EarleyBoyer: ["earley-boyer.js"],
    RegExp: ["regexp.js"],
    Splay: ["splay.js"],
    NavierStokes: ["navier-stokes.js"],
    PdfJS: ["pdfjs.js"],
    Mandreel: ["mandreel.js"],
    Gameboy: ["gbemu-part1.js", "gbemu-part2.js"],
    CodeLoad: ["code-load.js"],
    Box2D: ["box2d.js"],
    zlib: ["zlib.js", "zlib-data.js"],
    Typescript: ["typescript.js", "typescript-input.js", "typescript-compiler.js"],
};

function parse_args(args) {
    const opts = { json: null, list: false, dir: null, suites: [] };
    const usage = "usage: qjs bench/octane.js [--json FILE] [--list] OCTANE_DIR [suite ...]";
    for (let i = 0; i < args.length; i++) {
        const a = args[i];
        if (a === "--json")
            opts.json = args[++i];
        else if (a === "--list")
            opts.list = true;
        else if (a === "--help" || a === "-h") {
            print(usage);
            std.exit(0);
        } else if (a.startsWith("-")) {
            print("unknown option: " + a);
            std.exit(1);
        } else if (opts.dir === null)
            opts.dir = a;
        else
            opts.suites.push(a);
    }
    if (opts.list)
        return opts;
    if (opts.dir === null || (opts.json !== null && !opts.json)) {
        print(usage);
        std.exit(1);
    }
    for (const s of opts.suites) {
        if (!SUITES[s]) {
            print("unknown suite: " + s + " (see --list)");
            std.exit(1);
        }
    }
    if (opts.suites.length === 0)
        opts.suites = Object.keys(SUITES);
    return opts;
}

// Peak resident set size of this process in KiB, null where /proc is missing.
function max_rss_kb() {
    const status = std.loadFile("/proc/self/status");
    const m = status && /^VmHWM:\s+(\d+) kB/m.exec(status);
    return m ? +m[1] : null;
}

// Child process: run one suite and print its results as one JSON line.
function run_child(dir, suite) {
    const path = f => dir + "/" + f;
    globalThis.load = f => std.loadScript(path(f));
    globalThis.read = f => std.loadFile(path(f)); // zlib reads its data file
    const out = { results: {}, errors: {}, max_rss_kb: null };
    load("base.js");
    for (const f of SUITES[suite])
        load(f);
    BenchmarkSuite.RunSuites({
        NotifyResult(name, result) { out.results[name] = +result; },
        NotifyError(name, error) { out.errors[name] = String(error); },
    });
    out.max_rss_kb = max_rss_kb();
    std.out.puts("\n" + JSON.stringify(out) + "\n");
}

// Start this script on one suite in a child process with the same binary
// and collect its JSON line.
function run_suite(exe, script, dir, suite) {
    const [rfd, wfd] = os.pipe();
    const pid = os.exec([exe, script, "--child", dir, suite], { block: false, stdout: wfd });
    os.close(wfd);
    const f = std.fdopen(rfd, "r");
    const output = f.readAsString();
    f.close();
    const [, status] = os.waitpid(pid, 0);
    const last = output.trim().split("\n").pop();
    try {
        return JSON.parse(last);
    } catch (e) {
        return { results: {}, errors: { [suite]: `exited with status ${status}` }, max_rss_kb: null };
    }
}

function geomean(xs) {
    return Math.exp(xs.reduce((s, x) => s + Math.log(x), 0) / xs.length);
}

function main() {
    const args = scriptArgs.slice(1);
    if (args[0] === "--child")
        return run_child(args[1], args[2]);

    const opts = parse_args(args);
    if (opts.list) {
        for (const [name, files] of Object.entries(SUITES))
            print(name.padEnd(14), files.join(" "));
        return 0;
    }
    const [exe, err] = os.readlink("/proc/self/exe");
    if (err) {
        print("cannot find the qjs binary from /proc/self/exe");
        return 1;
    }
    if (!std.loadFile(opts.dir + "/base.js")) {
        print("not an octane checkout: " + opts.dir);
        return 1;
    }

    const data = { engine: exe, octane_dir: opts.dir, results: {}, errors: {}, score: null };
    print("benchmark".padEnd(18), "score".padStart(8), "max RSS".padStart(10));
    for (const suite of opts.suites) {
        const r = run_suite(exe, scriptArgs[0], opts.dir, suite);
        for (const [name, score] of Object.entries(r.results)) {
            data.results[name] = { suite, score, max_rss_kb: r.max_rss_kb };
            const rss = r.max_rss_kb === null ? "" : (r.max_rss_kb / 1024).toFixed(1) + " MB";
            print(name.padEnd(18), String(score).padStart(8), rss.padStart(10));
        }
        for (const [name, error] of Object.entries(r.errors)) {
            data.errors[name] = error;
            print(name.padEnd(18), "error: " + error);
        }
    }
    const scores = Object.values(data.results).map(r => r.score).filter(s => s > 0);
    if (scores.length)
        data.score = geomean(scores);
    print("");
    print("score (geometric mean):", data.score === null ? "-" : Math.round(data.score));

    if (opts.json) {
        const f = std.open(opts.json, "w");
        if (!f) {
            print("cannot write " + opts.json);
            return 1;
        }
        f.puts(JSON.stringify(data, null, 2) + "\n");
        f.close();
    }
    return Object.keys(data.errors).length ? 1 : 0;
}

std.exit(main() ?? 0);
