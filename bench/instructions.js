// Count the instructions executed per operation by the runtime benchmarks.
//
//   qjs bench/instructions.js [options] QJS [filter ...]
//
//   QJS                      the qjs binary to measure (a Release build)
//   --iterations-from FILE   take the iteration count of each benchmark from
//                            a result file written by `runtime.js --json` or
//                            by this script, so that two builds do exactly
//                            the same work
//   --min-ms N               without --iterations-from, calibrate the
//                            iteration counts with QJS so that one benchmark
//                            lasts about N ms natively (default 20)
//   --json FILE              also write the results to FILE as JSON, in the
//                            format of runtime.js (see compare.js)
//   --jobs N                 run N valgrind processes at a time (default 1)
//   --valgrind PATH          the valgrind binary (default "valgrind")
//   filter                   only measure the benchmarks selected by the
//                            filters, as for runtime.js
//
// Wall clock times on a shared machine move by tens of percent between runs
// of the same binary. The number of instructions a benchmark executes does
// not: it is the same on every run to a few parts per million, so it tells
// a change of the code apart from noise (but not a change of the memory
// access pattern or branch prediction, which time does measure).
//
// Every benchmark runs twice under cachegrind, once with its iteration count
// and once with 0 iterations. Both runs start the engine, compile the
// benchmark script and warm the benchmark up the same way, so the difference
// of the two instruction counts is the cost of the iterations alone. The
// count per operation still depends a little on the iteration count for the
// benchmarks that allocate (garbage collections, a string that grows with
// every iteration), so two builds are only comparable at the same counts:
// see --iterations-from.
//
// Needs valgrind (Linux or macOS). Compare two builds with compare.js by
// listing the result file with the timing results of the same build.
import * as std from "qjs:std";
import * as os from "qjs:os";

const script_dir = scriptArgs[0].replace(/[^\/]*$/, "");
const runtime_js = script_dir + "runtime.js";

const usage = "usage: qjs bench/instructions.js [--iterations-from FILE] [--min-ms N] [--json FILE] [--jobs N] [--valgrind PATH] QJS [filter ...]";

function parse_args(args) {
    const opts = { qjs: null, from: null, min_ms: 20, json: null, jobs: 1, valgrind: "valgrind", filters: [] };
    for (let i = 0; i < args.length; i++) {
        const a = args[i];
        if (a === "--iterations-from")
            opts.from = args[++i];
        else if (a === "--min-ms")
            opts.min_ms = +args[++i];
        else if (a === "--json")
            opts.json = args[++i];
        else if (a === "--jobs")
            opts.jobs = +args[++i];
        else if (a === "--valgrind")
            opts.valgrind = args[++i];
        else if (a === "--help" || a === "-h") {
            print(usage);
            std.exit(0);
        } else if (a.startsWith("-")) {
            print("unknown option: " + a);
            std.exit(1);
        } else if (opts.qjs === null)
            opts.qjs = a;
        else
            opts.filters.push(a);
    }
    if (opts.qjs === null || !(opts.min_ms > 0) || !(opts.jobs >= 1)) {
        print(usage);
        std.exit(1);
    }
    return opts;
}

// Run a command and return its exit status with what it wrote to stdout
// and stderr.
function run(args) {
    const out = std.tmpfile(), err = std.tmpfile();
    const status = os.exec(args, { block: true, usePath: true, stdout: out.fileno(), stderr: err.fileno() });
    out.seek(0, std.SEEK_SET);
    err.seek(0, std.SEEK_SET);
    const r = { status, stdout: out.readAsString(), stderr: err.readAsString() };
    out.close();
    err.close();
    return r;
}

function fail(what, r) {
    print(what + " failed with status " + r.status);
    if (r.stdout)
        print(r.stdout.trimEnd());
    if (r.stderr)
        print(r.stderr.trimEnd());
    std.exit(1);
}

function list_benchmarks(opts) {
    const r = run([opts.qjs, runtime_js, "--list", ...opts.filters]);
    if (r.status !== 0)
        fail("listing the benchmarks", r);
    return r.stdout.trimEnd().split("\n").filter(l => l).map(l => {
        const [group, name] = l.trim().split(/\s+/);
        return { group, name };
    });
}

function load_results(filename) {
    const text = std.loadFile(filename);
    if (text === null) {
        print("cannot open " + filename);
        std.exit(1);
    }
    const data = JSON.parse(text);
    if (!data || typeof data.results !== "object") {
        print(filename + ": not a runtime.js result file");
        std.exit(1);
    }
    return data.results;
}

// Iteration counts for which a benchmark runs about min_ms natively, as
// runtime.js calibrates them.
function calibrate(opts) {
    const tmp = (std.getenv("TMPDIR") || "/tmp") + "/bench-instructions-" + os.getpid() + ".json";
    const r = run([opts.qjs, runtime_js, "--rounds", "1", "--min-ms", String(opts.min_ms), "--json", tmp, ...opts.filters]);
    if (r.status !== 0)
        fail("calibrating the iteration counts", r);
    const results = load_results(tmp);
    os.remove(tmp);
    return results;
}

// Start `qjs runtime.js --warmup w --iterations n group/name` under
// cachegrind without waiting for it.
function start_count(opts, b, warmup, n) {
    const err = std.tmpfile();
    const args = [opts.valgrind, "--tool=cachegrind", "--cache-sim=no", "--cachegrind-out-file=/dev/null",
                  opts.qjs, runtime_js, "--warmup", String(warmup), "--iterations", String(n), b.group + "/" + b.name];
    const pid = os.exec(args, { block: false, usePath: true, stdout: err.fileno(), stderr: err.fileno() });
    return { pid, err, b };
}

// Instructions executed by a finished process started with start_count().
function finish_count(job, status) {
    job.err.seek(0, std.SEEK_SET);
    const output = job.err.readAsString();
    job.err.close();
    const m = /^==\d+== I\s+refs:\s+([\d,]+)/m.exec(output);
    if (status !== 0 || !m)
        fail("valgrind on " + job.b.group + "/" + job.b.name, { status: status !== 0 ? status : "no instruction count in the output", stdout: output, stderr: "" });
    return Number(m[1].replace(/,/g, ""));
}

// Run all the counts, at most opts.jobs at a time (the counts do not depend
// on the load of the machine), and call done(b, per_op) for each benchmark
// as its two runs complete.
function count_all(opts, selected, iterations, done) {
    const pending = [];
    for (const b of selected) {
        const n = iterations[b.name]?.iterations;
        if (!(n > 0)) {
            done(b, null, null);
            continue;
        }
        // warming up more than the measured count would only add time to
        // the two runs; the first iterations fill the caches anyway
        const warmup = Math.min(1000, n);
        const state = { b, n, total: null, base: null };
        pending.push(() => ({ ...start_count(opts, b, warmup, n), state, field: "total" }));
        pending.push(() => ({ ...start_count(opts, b, warmup, 0), state, field: "base" }));
    }
    const running = new Map();
    while (pending.length > 0 || running.size > 0) {
        while (pending.length > 0 && running.size < opts.jobs) {
            const job = pending.shift()();
            running.set(job.pid, job);
        }
        const [pid, status] = os.waitpid(-1, 0);
        const job = running.get(pid);
        if (!job)
            continue;
        running.delete(pid);
        job.state[job.field] = finish_count(job, status);
        const st = job.state;
        if (st.total !== null && st.base !== null)
            done(st.b, (st.total - st.base) / st.n, st.n);
    }
}

function format_count(x) {
    if (x < 100)
        return x.toFixed(1);
    if (x < 1e4)
        return String(Math.round(x));
    if (x < 1e6)
        return (x / 1e3).toFixed(1) + "k";
    return (x / 1e6).toFixed(2) + "M";
}

function main() {
    const opts = parse_args(scriptArgs.slice(1));
    const selected = list_benchmarks(opts);
    if (selected.length === 0) {
        print("no benchmark matches the filter");
        return 1;
    }
    const iterations = opts.from ? load_results(opts.from) : calibrate(opts);

    const results = {};
    print("group".padEnd(12), "benchmark".padEnd(24), "instr/op".padStart(10), "iterations".padStart(12));
    count_all(opts, selected, iterations, (b, per_op, n) => {
        if (per_op === null) {
            print(b.group.padEnd(12), b.name.padEnd(24), "no iteration count".padStart(23));
            return;
        }
        results[b.name] = { group: b.group, instructions_per_op: per_op, iterations: n };
        print(b.group.padEnd(12), b.name.padEnd(24), format_count(per_op).padStart(10), String(n).padStart(12));
    });

    if (opts.json) {
        const out = {
            version: 1,
            date: new Date().toISOString(),
            tool: "cachegrind",
            qjs: opts.qjs,
            iterations_from: opts.from,
            results,
        };
        const f = std.open(opts.json, "w");
        if (!f) {
            print("cannot open " + opts.json);
            return 1;
        }
        f.puts(JSON.stringify(out, null, 2) + "\n");
        f.close();
    }
    return 0;
}

std.exit(main());
