// Worst-case inputs for the TypeScript erasure parser.
//
//   qjs bench/ts_parse_depth.js [max depth]
//
// The parser is single pass and speculates on ambiguous syntax (`<` may
// start type arguments, `(` an arrow function, ...) by scanning ahead and
// backtracking. Nested ambiguous constructs can therefore cost more than
// linear time. For each pattern below the compile time is measured at
// doubling depths; "x2" is the ratio to the previous depth: about 2 means
// linear, about 4 quadratic. Where the pattern is also valid JavaScript
// it is compiled as plain JavaScript too, for comparison.
import * as std from "qjs:std";
import * as os from "qjs:os";

const max_depth = +(scriptArgs[1] || 1024);
// milliseconds; os.now() counts microseconds
const now = os.now ? () => os.now() / 1000 : () => Date.now();

const rep = (s, n) => s.repeat(n);
const nest = (n, open, close, inner = "a") => rep(open, n) + inner + rep(close, n);

// name, TypeScript source for depth n, whether it is also plain JavaScript
const patterns = [
    ["a < a < a ...           (type args trial at each <)",
     n => `x = ${rep("a < ", n)}a;`, true],
    ["a < (a < (a ...         (trial then arrow params scan)",
     n => `x = ${rep("a < (", n)}a${rep(")", n)};`, true],
    ["((((a))))               (arrow params scan at each paren)",
     n => `x = ${nest(n, "(", ")")};`, true],
    ["c ? (a): T => ... : z   (arrow with return type in ?: branch)",
     n => `x = ${rep("c ? (a): T => ", n)}z${rep(" : z", n)};`, false],
    ["(a): T => (a): T => ... (nested arrows with return types)",
     n => `x = ${rep("(a): T => ", n)}a;`, false],
    ["<T>(a) => <T>(a) => ... (nested generic arrows)",
     n => `x = ${rep("<T>(a) => ", n)}a;`, false],
    ["f<T>(f<T>(f<T>(...)))   (nested calls with type args)",
     n => `x = ${rep("f<T>(", n)}a${rep(")", n)};`, false],
    ["let v: A<A<A<...>>>     (nested generic type)",
     n => `let v: ${rep("A<", n)}A${rep(">", n)};`, false],
    ["a as any as any ...     (assertion chain)",
     n => `x = a${rep(" as any", n)};`, false],
    ["(a: (a: (a: ...) => T) => T) => T (nested function types)",
     n => `let v: ${rep("(a: ", n)}T${rep(") => T", n)};`, false],
];

function time(src, typescript) {
    let n = 0, t0 = now(), t;
    try {
        do {
            std.evalScript(src, { compile_only: true, typescript });
            n++;
            t = now();
        } while (t - t0 < 100);
    } catch (e) {
        return String(e).replace(/^SyntaxError: /, "").slice(0, 40);
    }
    return (t - t0) / n; // ms
}

const fmt = t => typeof t === "number" ? t.toFixed(3).padStart(9) : t.padStart(9);
let worst = 0;
for (const [name, make, is_js] of patterns) {
    console.log(`\n${name}`);
    console.log("   depth     TS ms   x2" + (is_js ? "     JS ms   x2" : ""));
    let prev_ts, prev_js;
    for (let n = 16; n <= max_depth; n *= 2) {
        const src = make(n);
        const t_ts = time(src, true);
        const t_js = is_js ? time(src, false) : undefined;
        const ratio = (t, p) => typeof t === "number" && typeof p === "number" ? (t / p).toFixed(1).padStart(5) : "     ";
        if (typeof t_ts === "number" && typeof prev_ts === "number")
            worst = Math.max(worst, t_ts / prev_ts);
        console.log(String(n).padStart(8), fmt(t_ts), ratio(t_ts, prev_ts),
                    is_js ? fmt(t_js) + " " + ratio(t_js, prev_js) : "");
        prev_ts = t_ts; prev_js = t_js;
        if (typeof t_ts !== "number")
            break;
    }
}
console.log(`\nworst growth factor per doubling (TypeScript): ${worst.toFixed(1)}`);
