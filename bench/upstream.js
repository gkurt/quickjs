// Compare two builds on the Octane suite (bench/octane.js) and on
// tests/microbench.js, as the upstream comparison workflow does
// (.github/workflows/bench-upstream.yml). bench/compare.js covers the
// bench/runtime.js and bench/instructions.js results of the same runs.
//
//   qjs bench/upstream.js [options] --octane BASE HEAD --microbench BASE HEAD
//
//   --octane BASE HEAD      JSON files written with `octane.js --json`
//   --microbench BASE HEAD  the microbench-new.txt files tests/microbench.js
//                           writes into its working directory
//                           Each BASE and HEAD may be a comma separated list
//                           of files from repeated runs of the same build;
//                           either option may be left out.
//   --labels BASE,HEAD      names of the two builds (default upstream,fork)
//   --threshold PERCENT     change below which a benchmark counts as
//                           unchanged (default 5)
//   --memory-threshold PERCENT
//                           the same for the peak memory (default 5)
//   --markdown              print GitHub flavored markdown
//
// The median of the repeated runs is used, not the best one as compare.js
// does: tests/microbench.js calibrates its iteration count on every run and
// some of its benchmarks cost more per operation with more iterations, so
// one run can land far from the others in either direction, and the median
// is robust to that.
import * as std from "qjs:std";

function parse_args(args) {
    const opts = { octane: null, microbench: null, labels: ["upstream", "fork"],
                   threshold: 5, mthreshold: 5, markdown: false };
    const usage = "usage: qjs bench/upstream.js [--labels BASE,HEAD] [--threshold PERCENT] [--memory-threshold PERCENT] [--markdown] [--octane BASE HEAD] [--microbench BASE HEAD]";
    for (let i = 0; i < args.length; i++) {
        const a = args[i];
        if (a === "--octane" || a === "--microbench") {
            if (i + 2 >= args.length) {
                print(usage);
                std.exit(1);
            }
            opts[a.slice(2)] = [args[++i], args[++i]];
        } else if (a === "--labels")
            opts.labels = args[++i].split(",");
        else if (a === "--threshold")
            opts.threshold = +args[++i];
        else if (a === "--memory-threshold")
            opts.mthreshold = +args[++i];
        else if (a === "--markdown")
            opts.markdown = true;
        else if (a === "--help" || a === "-h") {
            print(usage);
            std.exit(0);
        } else {
            print(a.startsWith("-") ? "unknown option: " + a : usage);
            std.exit(1);
        }
    }
    if ((!opts.octane && !opts.microbench) || opts.labels.length !== 2 ||
        !(opts.threshold >= 0) || !(opts.mthreshold >= 0)) {
        print(usage);
        std.exit(1);
    }
    return opts;
}

function load(filename) {
    const str = std.loadFile(filename);
    if (str === null) {
        print("cannot open " + filename);
        std.exit(1);
    }
    return JSON.parse(str);
}

function median(xs) {
    const s = xs.slice().sort((a, b) => a - b);
    const m = s.length >> 1;
    return s.length & 1 ? s[m] : (s[m - 1] + s[m]) / 2;
}

function geomean(xs) {
    return Math.exp(xs.reduce((s, x) => s + Math.log(x), 0) / xs.length);
}

// name -> median of the values of each run, from a comma separated list
function merge(list, values_of) {
    const all = {};
    let runs = 0;
    for (const filename of list.split(",")) {
        for (const [name, v] of Object.entries(values_of(load(filename)))) {
            if (typeof v === "number" && v > 0)
                (all[name] ??= []).push(v);
        }
        runs++;
    }
    const out = {};
    for (const [name, vs] of Object.entries(all))
        out[name] = median(vs);
    return { runs, values: out };
}

function load_octane(list) {
    const suite_of = {};
    const scores = merge(list, d => {
        const out = {};
        for (const [name, r] of Object.entries(d.results)) {
            out[name] = r.score;
            suite_of[name] = r.suite;
        }
        return out;
    });
    const memory = merge(list, d => {
        const out = {};
        for (const r of Object.values(d.results))
            out[r.suite] = r.max_rss_kb;
        return out;
    });
    const errors = {};
    for (const filename of list.split(","))
        Object.assign(errors, load(filename).errors);
    return { scores, memory, suite_of, errors };
}

function load_microbench(list) {
    return merge(list, d => d);
}

function format_change(pct) {
    if (Math.abs(pct) < 0.05)
        return "0.0%";
    return (pct > 0 ? "+" : "") + pct.toFixed(1) + "%";
}

function format_ns(ns) {
    return ns < 10 ? ns.toFixed(2) : ns < 100 ? ns.toFixed(1) : String(Math.round(ns));
}

function format_mb(kb) {
    return (kb / 1024).toFixed(1);
}

// Compare base and head values; `better` is +1 when higher is better.
function compare(base, head, threshold, better) {
    const rows = [];
    for (const [name, h] of Object.entries(head)) {
        const b = base[name];
        if (b === undefined)
            continue;
        const change = (h - b) * 100 / b;
        const status = Math.abs(change) <= threshold ? "same" : change * better > 0 ? "better" : "worse";
        rows.push({ name, base: b, head: h, change, status });
    }
    // regressions first, then improvements, the largest changes first
    const order = { worse: 0, better: 1, same: 2 };
    rows.sort((x, y) => order[x.status] - order[y.status] || Math.abs(y.change) - Math.abs(x.change) ||
                        x.name.localeCompare(y.name));
    const count = s => rows.filter(r => r.status === s).length;
    const ratio = rows.length ? (geomean(rows.map(r => r.head / r.base)) - 1) * 100 : 0;
    return { rows, better: count("better"), worse: count("worse"), same: count("same"), geomean: ratio };
}

const MARK = { better: "🟢", worse: "🔴", same: "" };

function print_table(opts, headers, rows, cells) {
    if (opts.markdown) {
        print("| " + headers.join(" | ") + " |");
        print("|---" + "|---:".repeat(headers.length - 1) + "|");
        for (const r of rows)
            print("| " + cells(r).join(" | ") + " |");
    } else {
        const widths = headers.map((h, i) => Math.max(h.length, ...rows.map(r => cells(r)[i].length)));
        const line = cs => cs.map((c, i) => i === 0 ? c.padEnd(widths[i]) : c.padStart(widths[i])).join("  ");
        print(line(headers));
        for (const r of rows)
            print(line(cells(r)));
    }
    print("");
}

function main() {
    const opts = parse_args(scriptArgs.slice(1));
    const [bl, hl] = opts.labels;
    const t = opts.threshold;
    const heading = s => print(opts.markdown ? `**${s}**` : s);
    const mark = r => opts.markdown && MARK[r.status] ? " " + MARK[r.status] : "";
    const runs = n => n + " run" + (n === 1 ? "" : "s");

    if (opts.octane) {
        const base = load_octane(opts.octane[0]);
        const head = load_octane(opts.octane[1]);
        const s = compare(base.scores.values, head.scores.values, t, +1);
        const m = compare(base.memory.values, head.memory.values, opts.mthreshold, -1);
        const total = x => geomean(Object.values(x.scores.values));
        const tb = total(base), th = total(head);
        const peak = x => Math.max(...Object.values(x.memory.values));
        heading(`Octane: score ${Math.round(tb)} (${bl}) → ${Math.round(th)} (${hl}), ${format_change((th - tb) * 100 / tb)}; ` +
                `${s.better} faster, ${s.worse} slower, ${s.same} unchanged (threshold ±${t}%); ` +
                `peak memory geometric mean ${format_change(m.geomean)}`);
        print("");
        print(`Scores are the median of ${runs(base.scores.runs)} (${bl}) and ${runs(head.scores.runs)} (${hl}); higher is better. ` +
              "The total is the geometric mean of the scores, as in the official runner.");
        print("");
        print_table(opts, ["Benchmark", bl, hl, "Score"], s.rows,
                    r => [r.name, String(Math.round(r.base)), String(Math.round(r.head)), format_change(r.change) + mark(r)]);
        print(`Peak resident memory of each suite in its own process, in MB (largest: ${format_mb(peak(base))} → ${format_mb(peak(head))}); lower is better.`);
        print("");
        print_table(opts, ["Suite", bl, hl, "Memory"], m.rows,
                    r => [r.name, format_mb(r.base), format_mb(r.head), format_change(r.change) + mark(r)]);
        for (const [side, x] of [[bl, base], [hl, head]]) {
            for (const [name, error] of Object.entries(x.errors))
                print(`${opts.markdown ? "⚠️ " : ""}${side}: ${name} failed: ${error}`);
        }
    }

    if (opts.microbench) {
        const base = load_microbench(opts.microbench[0]);
        const head = load_microbench(opts.microbench[1]);
        // lower is better for times
        const s = compare(base.values, head.values, t, -1);
        heading(`tests/microbench.js: ${s.better} faster, ${s.worse} slower, ${s.same} unchanged (threshold ±${t}%), ` +
                `geometric mean of the time ${format_change(s.geomean)}`);
        print("");
        print(`Nanoseconds per operation, median of ${runs(base.runs)} (${bl}) and ${runs(head.runs)} (${hl}); lower is better.`);
        print("");
        print_table(opts, ["Benchmark", `${bl} ns`, `${hl} ns`, "Time"], s.rows,
                    r => [r.name, format_ns(r.base), format_ns(r.head), format_change(r.change) + mark(r)]);
    }
    return 0;
}

std.exit(main());
