// Compare two sets of bench/runtime.js results.
//
//   qjs bench/compare.js [options] BASE HEAD
//   qjs bench/compare.js [options] RESULTS
//
//   BASE, HEAD             JSON files written with `runtime.js --json`. Each
//                          may be a comma separated list of files from
//                          repeated runs of the same build; the best (lowest)
//                          time per benchmark is used, which filters out the
//                          noise of a busy machine.
//   RESULTS                with a single argument, print the best time of
//                          each benchmark over the given files
//   --threshold PERCENT    change below which a benchmark counts as unchanged
//                          (default 5)
//   --markdown             print a GitHub flavored markdown table instead of
//                          plain text
//   --fail-on-regression   exit with status 1 if any benchmark regressed by
//                          more than the threshold
import * as std from "qjs:std";

function parse_args(args) {
    const opts = { threshold: 5, markdown: false, fail: false, files: [] };
    for (let i = 0; i < args.length; i++) {
        const a = args[i];
        if (a === "--threshold")
            opts.threshold = +args[++i];
        else if (a === "--markdown")
            opts.markdown = true;
        else if (a === "--fail-on-regression")
            opts.fail = true;
        else if (a === "--help" || a === "-h") {
            print("usage: qjs bench/compare.js [--threshold PERCENT] [--markdown] [--fail-on-regression] BASE HEAD");
            std.exit(0);
        } else if (a.startsWith("-")) {
            print("unknown option: " + a);
            std.exit(1);
        } else
            opts.files.push(a);
    }
    if (opts.files.length < 1 || opts.files.length > 2 || !(opts.threshold >= 0)) {
        print("usage: qjs bench/compare.js [--threshold PERCENT] [--markdown] [--fail-on-regression] BASE [HEAD]");
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
        print(filename + ": not a runtime.js result file");
        std.exit(1);
    }
    return data;
}

// Merge repeated runs: keep the best time of each benchmark.
function load_set(list) {
    const merged = { runs: 0, engine: null, results: {} };
    for (const filename of list.split(",")) {
        const data = load(filename);
        merged.runs++;
        merged.engine ??= data.engine;
        for (const [name, r] of Object.entries(data.results)) {
            const cur = merged.results[name];
            if (!cur || r.ns_per_op < cur.ns_per_op)
                merged.results[name] = r;
        }
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

function format_change(pct) {
    return (pct > 0 ? "+" : "") + pct.toFixed(1) + "%";
}

function print_single(set, opts) {
    const rows = Object.entries(set.results).sort((a, b) => a[0].localeCompare(b[0]));
    if (opts.markdown) {
        print(`Nanoseconds per operation, best of ${set.runs} run${set.runs > 1 ? "s" : ""}; lower is better.`);
        print("");
        print("| Benchmark | ns/op |");
        print("|---|---:|");
        for (const [name, r] of rows)
            print(`| ${r.group}/${name} | ${format_ns(r.ns_per_op)} |`);
    } else {
        print("benchmark".padEnd(38), "ns/op".padStart(9));
        for (const [name, r] of rows)
            print((r.group + "/" + name).padEnd(38), format_ns(r.ns_per_op).padStart(9));
    }
    return 0;
}

function main() {
    const opts = parse_args(scriptArgs.slice(1));
    const base = load_set(opts.files[0]);
    if (opts.files.length === 1)
        return print_single(base, opts);
    const head = load_set(opts.files[1]);

    const rows = [];
    let log_sum = 0, log_count = 0;
    for (const [name, h] of Object.entries(head.results)) {
        const b = base.results[name];
        if (!b) {
            rows.push({ name, group: h.group, base: null, head: h.ns_per_op, change: null, status: "new" });
            continue;
        }
        // positive change = slower (more ns per operation)
        const change = (h.ns_per_op - b.ns_per_op) * 100 / b.ns_per_op;
        let status = "same";
        if (change > opts.threshold)
            status = "slower";
        else if (change < -opts.threshold)
            status = "faster";
        rows.push({ name, group: h.group, base: b.ns_per_op, head: h.ns_per_op, change, status });
        log_sum += Math.log(h.ns_per_op / b.ns_per_op);
        log_count++;
    }
    for (const name of Object.keys(base.results)) {
        if (!head.results[name])
            rows.push({ name, group: base.results[name].group, base: base.results[name].ns_per_op, head: null, change: null, status: "removed" });
    }
    // regressions first, then improvements, then the rest
    const order = { slower: 0, faster: 1, same: 2, new: 3, removed: 4 };
    rows.sort((a, b) => order[a.status] - order[b.status] || (b.change ?? 0) - (a.change ?? 0) || a.name.localeCompare(b.name));

    const n_slower = rows.filter(r => r.status === "slower").length;
    const n_faster = rows.filter(r => r.status === "faster").length;
    const n_same = rows.filter(r => r.status === "same").length;
    const geomean = log_count ? (Math.exp(log_sum / log_count) - 1) * 100 : 0;
    const marker = { slower: "🔴", faster: "🟢", same: "", new: "🆕", removed: "⚪" };

    const summary = `${n_faster} faster, ${n_slower} slower, ${n_same} unchanged` +
          ` (threshold ±${opts.threshold}%); geometric mean of the change: ${format_change(geomean)}`;

    if (opts.markdown) {
        print(`**Runtime benchmarks:** ${summary}`);
        print("");
        print("Times are nanoseconds per operation, best of " +
              `${base.runs} run${base.runs > 1 ? "s" : ""} (base) and ${head.runs} run${head.runs > 1 ? "s" : ""} (head); lower is better.`);
        print("");
        print("| Benchmark | Base | Head | Change | |");
        print("|---|---:|---:|---:|:-:|");
        for (const r of rows) {
            const b = r.base === null ? "" : format_ns(r.base);
            const h = r.head === null ? "" : format_ns(r.head);
            const c = r.change === null ? r.status : format_change(r.change);
            print(`| ${r.group}/${r.name} | ${b} | ${h} | ${c} | ${marker[r.status]} |`);
        }
    } else {
        print("benchmark".padEnd(38), "base".padStart(9), "head".padStart(9), "change".padStart(9));
        for (const r of rows) {
            const b = r.base === null ? "-" : format_ns(r.base);
            const h = r.head === null ? "-" : format_ns(r.head);
            const c = r.change === null ? r.status : format_change(r.change);
            const flag = r.status === "slower" ? "  <-- slower" : r.status === "faster" ? "  faster" : "";
            print((r.group + "/" + r.name).padEnd(38), b.padStart(9), h.padStart(9), c.padStart(9) + flag);
        }
        print("");
        print(summary);
    }
    return opts.fail && n_slower > 0 ? 1 : 0;
}

std.exit(main());
