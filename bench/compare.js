// Compare two sets of bench/runtime.js and bench/instructions.js results.
//
//   qjs bench/compare.js [options] BASE HEAD
//   qjs bench/compare.js [options] RESULTS
//
//   BASE, HEAD             JSON files written with `runtime.js --json` or
//                          `instructions.js --json`. Each may be a comma
//                          separated list of files from repeated runs of the
//                          same build; the best (lowest) time per benchmark
//                          is used, which filters out the noise of a busy
//                          machine, and the instruction counts are picked up
//                          from whichever files carry them.
//   RESULTS                with a single argument, print the best time and
//                          the instruction count of each benchmark over the
//                          given files
//   --threshold PERCENT    time change below which a benchmark counts as
//                          unchanged (default 5)
//   --instructions-threshold PERCENT
//                          the same for the instruction count, which is
//                          deterministic so a much smaller change is
//                          meaningful (default 1)
//   --markdown             print a GitHub flavored markdown table instead of
//                          plain text
//   --fail-on-regression   exit with status 1 if any benchmark got slower or
//                          executes more instructions by more than the
//                          thresholds
import * as std from "qjs:std";

function parse_args(args) {
    const opts = { threshold: 5, ithreshold: 1, markdown: false, fail: false, files: [] };
    const usage = "usage: qjs bench/compare.js [--threshold PERCENT] [--instructions-threshold PERCENT] [--markdown] [--fail-on-regression] BASE [HEAD]";
    for (let i = 0; i < args.length; i++) {
        const a = args[i];
        if (a === "--threshold")
            opts.threshold = +args[++i];
        else if (a === "--instructions-threshold")
            opts.ithreshold = +args[++i];
        else if (a === "--markdown")
            opts.markdown = true;
        else if (a === "--fail-on-regression")
            opts.fail = true;
        else if (a === "--help" || a === "-h") {
            print(usage);
            std.exit(0);
        } else if (a.startsWith("-")) {
            print("unknown option: " + a);
            std.exit(1);
        } else
            opts.files.push(a);
    }
    if (opts.files.length < 1 || opts.files.length > 2 || !(opts.threshold >= 0) || !(opts.ithreshold >= 0)) {
        print(usage);
        std.exit(1);
    }
    return opts;
}

function load(filename) {
    const f = std.open(filename, "r");
    if (!f) {
        print("cannot open " + filename);
        std.exit(1);
    }
    const data = JSON.parse(f.readAsString());
    f.close();
    if (!data || typeof data.results !== "object") {
        print(filename + ": not a result file");
        std.exit(1);
    }
    return data;
}

// Merge repeated runs: keep the best time and the lowest instruction count
// of each benchmark (the count is the same on every run within a few parts
// per million).
function load_set(list) {
    const merged = { runs: 0, instruction_runs: 0, results: {} };
    for (const filename of list.split(",")) {
        const data = load(filename);
        let timed = false, counted = false;
        for (const [name, r] of Object.entries(data.results)) {
            const cur = merged.results[name] ??= { group: r.group, ns_per_op: null, instructions_per_op: null };
            if (typeof r.ns_per_op === "number") {
                timed = true;
                if (cur.ns_per_op === null || r.ns_per_op < cur.ns_per_op)
                    cur.ns_per_op = r.ns_per_op;
            }
            if (typeof r.instructions_per_op === "number") {
                counted = true;
                if (cur.instructions_per_op === null || r.instructions_per_op < cur.instructions_per_op)
                    cur.instructions_per_op = r.instructions_per_op;
            }
        }
        merged.runs += timed;
        merged.instruction_runs += counted;
    }
    return merged;
}

function format_ns(ns) {
    if (ns < 10)
        return ns.toFixed(2);
    if (ns < 100)
        return ns.toFixed(1);
    return String(Math.round(ns));
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

function format_change(pct) {
    if (Math.abs(pct) < 0.05)
        return "0.0%";
    return (pct > 0 ? "+" : "") + pct.toFixed(1) + "%";
}

function plural(n, what) {
    return n + " " + what + (n === 1 ? "" : "s");
}

function print_single(set, opts) {
    const rows = Object.entries(set.results).sort((a, b) => a[0].localeCompare(b[0]));
    const counts = set.instruction_runs > 0;
    const ns = r => r.ns_per_op === null ? "" : format_ns(r.ns_per_op);
    const ic = r => r.instructions_per_op === null ? "" : format_count(r.instructions_per_op);
    if (opts.markdown) {
        print(`Nanoseconds per operation, best of ${plural(set.runs, "run")}` +
              (counts ? ", and instructions per operation" : "") + "; lower is better.");
        print("");
        print(counts ? "| Benchmark | ns/op | instr/op |" : "| Benchmark | ns/op |");
        print(counts ? "|---|---:|---:|" : "|---|---:|");
        for (const [name, r] of rows)
            print(`| ${r.group}/${name} | ${ns(r)} |` + (counts ? ` ${ic(r)} |` : ""));
    } else {
        print("benchmark".padEnd(38), "ns/op".padStart(9), counts ? "instr/op".padStart(10) : "");
        for (const [name, r] of rows)
            print((r.group + "/" + name).padEnd(38), ns(r).padStart(9), counts ? ic(r).padStart(10) : "");
    }
    return 0;
}

// Relative change of a metric with its status against a threshold; null
// when one side lacks the metric.
function compare_metric(b, h, threshold) {
    if (b === null || h === null)
        return null;
    // positive change = slower (more per operation)
    const change = (h - b) * 100 / b;
    const status = change > threshold ? "slower" : change < -threshold ? "faster" : "same";
    return { base: b, head: h, change, status };
}

class Stats {
    constructor(what, unit, threshold) {
        this.what = what;
        this.unit = unit;
        this.threshold = threshold;
        this.slower = this.faster = this.same = 0;
        this.log_sum = this.count = 0;
    }
    add(m) {
        if (!m)
            return;
        this[m.status]++;
        this.log_sum += Math.log(m.head / m.base);
        this.count++;
    }
    geomean() {
        return this.count ? (Math.exp(this.log_sum / this.count) - 1) * 100 : 0;
    }
    summary() {
        return `${this.what}: ${this.faster} ${this.unit[0]}, ${this.slower} ${this.unit[1]}, ${this.same} unchanged` +
               ` (threshold ±${this.threshold}%), geometric mean ${format_change(this.geomean())}`;
    }
}

function main() {
    const opts = parse_args(scriptArgs.slice(1));
    const base = load_set(opts.files[0]);
    if (opts.files.length === 1)
        return print_single(base, opts);
    const head = load_set(opts.files[1]);

    const time = new Stats("time", ["faster", "slower"], opts.threshold);
    const instr = new Stats("instructions", ["fewer", "more"], opts.ithreshold);
    const rows = [];
    for (const [name, h] of Object.entries(head.results)) {
        const b = base.results[name];
        if (!b) {
            rows.push({ name, group: h.group, status: "new", head: h });
            continue;
        }
        const row = {
            name, group: h.group, status: "compared",
            time: compare_metric(b.ns_per_op, h.ns_per_op, opts.threshold),
            instr: compare_metric(b.instructions_per_op, h.instructions_per_op, opts.ithreshold),
        };
        time.add(row.time);
        instr.add(row.instr);
        rows.push(row);
    }
    for (const [name, b] of Object.entries(base.results)) {
        if (!head.results[name])
            rows.push({ name, group: b.group, status: "removed", base: b });
    }
    const counts = instr.count > 0;
    const times = time.count > 0 || !counts; // hide the time columns when only counts were given

    // regressions first, then improvements, then the rest; the instruction
    // count decides when available since it is deterministic, the time
    // breaks ties
    const order = { slower: 0, faster: 1, same: 2 };
    const rank = m => m ? order[m.status] : 2;
    const key = r => r.status === "compared" ? [rank(r.instr ?? r.time), rank(r.time),
                                                 -Math.abs(r.instr?.change ?? 0), -Math.abs(r.time?.change ?? 0)]
                                             : [3, r.status === "new" ? 0 : 1, 0, 0];
    rows.sort((a, b) => {
        const ka = key(a), kb = key(b);
        for (let i = 0; i < ka.length; i++)
            if (ka[i] !== kb[i])
                return ka[i] - kb[i];
        return a.name.localeCompare(b.name);
    });

    const marker = { slower: "🔴", faster: "🟢", same: "" };
    const summary = [times ? time.summary() : null, counts ? instr.summary() : null].filter(x => x).join("; ");

    if (opts.markdown) {
        const runs = s => plural(s.runs, "run");
        print(`**Runtime benchmarks:** ${summary}`);
        print("");
        print([times ? `Times are nanoseconds per operation, best of ${runs(base)} (base) and ${runs(head)} (head)` : null,
               counts ? "instructions are per operation, counted with cachegrind, and do not depend on the load of the runner" : null]
              .filter(x => x).join("; ") + "; lower is better.");
        print("");
        const cell = (m, fmt) => m ? `${fmt(m.base)} | ${fmt(m.head)} | ${format_change(m.change)} ${marker[m.status]}` : " | | ";
        if (times && counts) {
            print("| Benchmark | Base ns | Head ns | Time | Base instr | Head instr | Instructions |");
            print("|---|---:|---:|---:|---:|---:|---:|");
        } else if (counts) {
            print("| Benchmark | Base instr | Head instr | Change |");
            print("|---|---:|---:|---:|");
        } else {
            print("| Benchmark | Base | Head | Change |");
            print("|---|---:|---:|---:|");
        }
        for (const r of rows) {
            const name = `${r.group}/${r.name}`;
            if (r.status !== "compared") {
                // one side only: its values in that side's columns
                const v = r.status === "new" ? r.head : r.base;
                const t = v.ns_per_op === null ? "" : format_ns(v.ns_per_op);
                const i = v.instructions_per_op === null ? "" : format_count(v.instructions_per_op);
                const side = v => r.status === "new" ? ` | ${v}` : `${v} | `;
                const status = r.status + (r.status === "new" ? " 🆕" : " ⚪");
                if (times && counts)
                    print(`| ${name} | ${side(t)} | ${status} | ${side(i)} | |`);
                else
                    print(`| ${name} | ${side(counts ? i : t)} | ${status} |`);
                continue;
            }
            if (times && counts)
                print(`| ${name} | ${cell(r.time, format_ns)} | ${cell(r.instr, format_count)} |`);
            else
                print(`| ${name} | ${cell(counts ? r.instr : r.time, counts ? format_count : format_ns)} |`);
        }
    } else {
        const flag = m => !m || m.status === "same" ? "" : m.status === "slower" ? "  <-- " + m.status : "  " + m.status;
        print("benchmark".padEnd(38), times ? "base".padStart(9) + "head".padStart(10) + "time".padStart(10) : "",
              counts ? "base".padStart(11) + "head".padStart(10) + "instr".padStart(9) : "");
        for (const r of rows) {
            const name = (r.group + "/" + r.name).padEnd(38);
            if (r.status !== "compared") {
                print(name, r.status);
                continue;
            }
            let line = name;
            if (times)
                line += r.time ? format_ns(r.time.base).padStart(9) + format_ns(r.time.head).padStart(9) + format_change(r.time.change).padStart(9)
                               : "-".padStart(9) + "-".padStart(9) + "".padStart(9);
            if (counts)
                line += r.instr ? format_count(r.instr.base).padStart(11) + format_count(r.instr.head).padStart(10) + format_change(r.instr.change).padStart(9)
                                : "-".padStart(11) + "-".padStart(10) + "".padStart(9);
            print(line + flag(r.time) + flag(r.instr).replace("slower", "more instructions").replace("faster", "fewer instructions"));
        }
        print("");
        print(summary);
    }
    return opts.fail && (time.slower > 0 || instr.slower > 0) ? 1 : 0;
}

std.exit(main());
