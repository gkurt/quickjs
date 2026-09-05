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
TypeScript file compiles 20-25% slower than the same code with the types
blanked out, and the flag costs 1-2% on code without types
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
milliseconds, Node 22 on Linux x86-64, one run on one machine:

| tool           | version | transpile | qjs compile | total | vs `qjs --ts` |
|----------------|---------|----------:|------------:|------:|--------------:|
| `qjs --ts`     | 0.16.2  |         - |        25.9 |  25.9 |         1.00x |
| oxc            | 0.148.0 |      25.2 |        18.0 |  43.1 |         1.67x |
| swc            | 1.16.2  |      49.7 |        18.5 |  68.3 |         2.64x |
| amaro          | 1.1.11  |      58.3 |        21.9 |  80.1 |         3.10x |
| sucrase        | 3.35.1  |      64.8 |        17.3 |  82.1 |         3.45x |
| ts-blank-space | 0.9.0   |     109.0 |        21.7 | 130.7 |         5.06x |
| esbuild        | 0.28.2  |     206.7 |        17.5 | 224.2 |         8.67x |
| tsc            | 5.9.3   |     509.1 |        19.0 | 528.1 |        20.43x |
| babel          | 7.29.7  |     579.2 |        19.5 | 598.7 |        23.16x |

`qjs compile` is parsing plus bytecode generation of the JavaScript each
tool produced, the same program in every case. Compiling the TypeScript
directly costs 20-25% more than compiling it with the types blanked out
(the ts-blank-space row, whose output is as long as the source) and about
45% more than compiling a transpiler's compact output, which is
still well below the cost of running any transpiler first. The native
transpilers come closest: oxc and swc through N-API, amaro (swc compiled
to wasm), and esbuild, whose asynchronous API includes a round trip to
its service process. sucrase, ts-blank-space, `tsc`'s `transpileModule`
and babel run in JavaScript. `--per-file` prints the same table for every
file and `--json` saves all measurements.

### Other benchmarks

`bench/ts_parse_bench.js` measures, inside `qjs`, the compile time of each
corpus file as TypeScript against its type-blanked JavaScript twin (the
cost of erasure) and the twin with the TypeScript flag on (the cost of the
flag on code without types). `bench/ts_parse_depth.js` checks that nested
ambiguous constructs such as `a < b < c < ...` do not blow up the parse
time: speculative parses are memoized and do not build error objects.
