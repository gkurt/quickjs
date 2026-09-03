// Compile-time cost of TypeScript type erasure on real code.
//
//   qjs bench/ts_parse_bench.js <corpus>
//
// <corpus>/ts/NAME.ts are TypeScript sources and <corpus>/js/NAME.js their
// twins with every type replaced by blanks (e.g. the output of
// ts-blank-space). Each file is compiled (not run) as a module three ways:
// the twin as plain JavaScript, the twin with the TypeScript flag on (the
// cost of the flag on code without types) and the TypeScript source
// (the cost of erasing the types). Use a release build.
import * as std from "qjs:std";
import * as os from "qjs:os";

const corpus = scriptArgs[1];
if (!corpus) {
    console.log("usage: qjs bench/ts_parse_bench.js <corpus>");
    std.exit(1);
}
// milliseconds; os.now() counts microseconds
const now = os.now ? () => os.now() / 1000 : () => Date.now();

function compile(src, filename, typescript) {
    std.evalScript(src, { compile_only: true, compile_module: true, typescript, filename });
}

// microseconds per call: the best of `rounds` rounds of at least `min_ms`
// milliseconds each, to keep clock frequency changes and other noise out
function measure(fn, rounds = 5, min_ms = 100) {
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

const pct = (a, b) => ((a / b - 1) * 100).toFixed(1).padStart(6) + "%";
const [names, err] = os.readdir(`${corpus}/ts`);
if (err) {
    console.log(`cannot read ${corpus}/ts: ${std.strerror(err)}`);
    std.exit(1);
}
const rows = [];
let sum_js = 0, sum_flag = 0, sum_ts = 0, sum_bytes = 0;
for (const f of names.filter(n => n.endsWith(".ts")).sort()) {
    const name = f.slice(0, -3);
    const ts = std.loadFile(`${corpus}/ts/${f}`), js = std.loadFile(`${corpus}/js/${name}.js`);
    if (typeof js !== "string") {
        console.log(`${name}: no twin`);
        continue;
    }
    try {
        compile(ts, f, true);
        compile(js, f, false);
    } catch (e) {
        console.log(`${name}: ${e}`);
        continue;
    }
    const t_js = measure(() => compile(js, f, false));
    const t_flag = measure(() => compile(js, f, true));
    const t_ts = measure(() => compile(ts, f, true));
    sum_js += t_js; sum_flag += t_flag; sum_ts += t_ts; sum_bytes += ts.length;
    rows.push([name, ts.length, t_js, t_flag, t_ts]);
}
console.log("file                              KB   JS us  +flag       TS us  erasure    MB/s");
for (const [name, bytes, t_js, t_flag, t_ts] of rows) {
    console.log(name.padEnd(30), (bytes / 1024).toFixed(0).padStart(5),
                t_js.toFixed(0).padStart(7), pct(t_flag, t_js),
                t_ts.toFixed(0).padStart(11), pct(t_ts, t_js),
                (bytes / t_ts).toFixed(0).padStart(7));
}
console.log("total".padEnd(30), (sum_bytes / 1024).toFixed(0).padStart(5),
            sum_js.toFixed(0).padStart(7), pct(sum_flag, sum_js),
            sum_ts.toFixed(0).padStart(11), pct(sum_ts, sum_js),
            (sum_bytes / sum_ts).toFixed(0).padStart(7));
