---
sidebar_position: 6
---

# TypeScript

QuickJS-ng can run TypeScript source directly by erasing the type syntax
while parsing. No type checking and no code transformation is performed:
the bytecode is the one of the equivalent JavaScript program, and line and
column numbers in stack traces refer to the original `.ts` source.

## Usage

Files with a `.ts`, `.mts` or `.cts` extension are parsed as TypeScript by
`qjs`, `qjsc`, `std.loadScript()` and the module loader used for `import`
statements and `import()` expressions, so a TypeScript module can import
JavaScript modules and vice versa:

```
$ qjs main.ts
$ qjs --ts -e 'const n: number = 1; console.log(n)'
$ qjsc -o main.c main.ts
```

`.mts` files are always modules; `.ts` files are modules when they contain
`import` or `export` statements, like `.js` files.

From C, pass `JS_EVAL_FLAG_TYPESCRIPT` to `JS_Eval()` and use
`JS_DetectModule2()` to autodetect modules in TypeScript source.

## Supported syntax

Only *erasable* TypeScript is supported, the same subset as Node's type
stripping and the `erasableSyntaxOnly` option of `tsc`. Everything that
has no runtime meaning is removed:

- type annotations on variables, parameters, return values, class fields
  and `catch` bindings
- optional (`?`) and definite assignment (`!`) markers
- type parameters and type arguments (`f<T>(x)`, `new Map<K, V>()`,
  `class C<T>`, `<T,>(x: T) => x`)
- `as`, `satisfies`, non-null assertions (`x!`) and angle bracket
  assertions (`<T>x`)
- `type` aliases, `interface` declarations, `declare` ambient declarations,
  namespaces that contain only types
- `abstract` classes and members, overload signatures, index signatures,
  `implements` clauses, `this` parameters, `public`/`private`/`protected`/
  `readonly`/`override` modifiers
- `import type`, `export type`, inline `type` specifiers and
  `export as namespace`

TypeScript-only constructs that generate code are rejected with a
`SyntaxError`, as `tsc --erasableSyntaxOnly` does:

- `enum` declarations (`declare enum` is fine)
- `namespace` and `module` blocks containing runtime code (`declare
  namespace` and type-only namespaces are fine)
- parameter properties (`constructor(private x: number)`)
- `import x = require(...)`, `export =` and `export import`

Decorators and JSX (`.tsx`) are not supported yet.

## Performance

Types are erased in the same single pass that produces the bytecode, so
there is no transpile step and nothing to re-parse. On real-world code a
TypeScript file compiles 25-30% slower than the same code with the types
blanked out, and the flag costs about 2% on code without types
(ambiguous syntax such as `<` and `(` needs a look-ahead).

### Compared with transpilers

The alternative to built-in erasure is to transpile to JavaScript first
and compile the output. `bench/ts_transpile_bench.mjs` measures both on a
corpus of TypeScript files: the time each transpiler takes in Node, the
time `qjs` then takes to compile its output, and the time `qjs` takes to
compile the TypeScript directly. All transpilers are configured to only
erase types (no import elision, no downleveling), and every measurement is
the best of a few rounds of repeated in-process calls, so the Node tools
are timed after JIT warm-up.

```
$ make            # a release build of qjs
$ cd bench && npm install && cd ..
$ node bench/ts_corpus.mjs           # downloads the corpus from npm
$ node bench/ts_transpile_bench.mjs  # or: make ts-bench
```

The corpus is the TypeScript source of a few libraries that ship it on
npm (rxjs, zod, effect, mobx, Redux Toolkit, redux, immer, TanStack
query-core), 167 files of 1 KB to 380 KB. Any directory of `.ts` files can
be passed instead. Totals over the 167 files (2.2 MB) of the corpus, in
milliseconds, Node 22 on Linux x86-64, one run on one machine. The first
rows are QuickJS alone: the TypeScript, then the JavaScript a transpiler
would hand it, compiled without and with the flag:

| tool                    | version | transpile | qjs compile |  total | vs `qjs --ts` |
|-------------------------|---------|----------:|------------:|-------:|--------------:|
| `qjs --ts`, TypeScript  | 0.16.2  |         - |        41.3 |   41.3 |         1.00x |
| `qjs`, blanked JS       | 0.16.2  |         - |        32.2 |   32.2 |         0.78x |
| `qjs --ts`, blanked JS  | 0.16.2  |         - |        32.8 |   32.8 |         0.79x |
| `qjs`, oxc JS           | 0.16.2  |         - |        27.4 |   27.4 |         0.66x |
| oxc                     | 0.148.0 |      36.0 |        27.4 |   63.4 |         1.54x |
| swc                     | 1.16.2  |      80.9 |        28.3 |  109.2 |         2.65x |
| amaro                   | 1.1.11  |      96.2 |        31.8 |  127.9 |         3.10x |
| sucrase                 | 3.35.1  |     156.6 |        27.9 |  184.5 |         4.85x |
| ts-blank-space          | 0.9.0   |     197.7 |        32.2 |  229.9 |         5.57x |
| esbuild                 | 0.28.2  |     324.6 |        26.7 |  351.3 |         8.51x |
| tsc                     | 5.9.3   |     891.3 |        29.0 |  920.3 |        22.29x |
| babel                   | 7.29.7  |    1162.1 |        28.0 | 1190.2 |        28.83x |

`qjs compile` is parsing plus bytecode generation of the JavaScript each
tool produced, the same program in every case. "Blanked JS" is the
ts-blank-space output, in which every type is replaced by blanks, so it is
as long as the source: the difference to the TypeScript row, about 28%,
is the cost of erasing the types, and the difference between the two
blanked rows, about 2%, is the cost of the flag on code without types.
"oxc JS" is a compact transpiler output; the TypeScript compiles about
50% slower than it, which is still well below the cost of running any
transpiler first. The native transpilers come closest: oxc and swc
through N-API, amaro (swc compiled to wasm), and esbuild, whose
asynchronous API includes a round trip to its service process. sucrase,
ts-blank-space, `tsc`'s `transpileModule` and babel run in JavaScript.
`--per-file` prints the same table for every file and `--json` saves all
measurements.

### Compared with Node and Bun

Node and Bun also run TypeScript by erasing types, Node with a stripping
pass (amaro, swc compiled to wasm) before V8 compiles the output, Bun in
its own transpiler, which every file goes through before JavaScriptCore
compiles it. `bench/ts_runtimes_bench.mjs` measures, for each of the
three, the time to get the TypeScript of the corpus ready to run against
the time for the same code with the types blanked out. V8 and
JavaScriptCore compile lazily and QuickJS compiles everything, so only
the overheads are comparable, not the columns. Milliseconds, totals over
the corpus, same machine as above:

| runtime                              | TypeScript | blanked JS | overhead | of which erasing types                   |
|--------------------------------------|-----------:|-----------:|---------:|------------------------------------------|
| `qjs --ts` 0.16.2, compile           |       40.6 |       33.0 |     +23% | 7.7 ms in the parser                     |
| node 22.22, strip + compile          |      179.0 |       47.3 |    +278% | 131.8 ms in `stripTypeScriptTypes`       |
| bun 1.4.2, transpile + compile       |       48.6 |       46.2 |      +5% | 2.3 ms more in the transpiler (35.3 vs 33.0) |

Bun's transpiler parses TypeScript natively, like QuickJS, and erasing
costs it almost nothing; the stripping pass Node runs first costs more
than V8's compile of the whole corpus. Bun's compile step is approximated
with `new Function` on the transpiler output with its import and export
statements removed, since module code cannot be compiled without being
run.

### Other benchmarks

`bench/ts_parse_bench.js` measures, inside `qjs`, the compile time of each
corpus file as TypeScript against its type-blanked JavaScript twin (the
cost of erasure) and the twin with the TypeScript flag on (the cost of the
flag on code without types). `bench/ts_corpus_check.js` checks that every
corpus file compiles to the same bytecode as its twin, debug information
included, like `tests/test_ts_bytecode.js` does for the test file. `bench/ts_parse_depth.js` checks that nested
ambiguous constructs such as `a < b < c < ...` do not blow up the parse
time: speculative parses are memoized and do not build error objects.
