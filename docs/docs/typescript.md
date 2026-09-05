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
TypeScript file compiles a few percent slower than the equivalent
JavaScript, and the flag costs a few percent on code without types
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
be passed instead.

In the table it prints, `qjs compile` is parsing plus bytecode generation of the JavaScript each
tool produced, which is about the same for all of them since the outputs
are the same program; QuickJS does it directly from the TypeScript for a
few percent more. The native transpilers (oxc, swc, and esbuild, whose
asynchronous API includes a round trip to its service process) come
closest; sucrase, ts-blank-space, babel and `tsc`'s `transpileModule` run
in JavaScript. `--per-file` prints the same table for every file and
`--json` saves all measurements.

### Other benchmarks

`bench/ts_parse_bench.js` measures, inside `qjs`, the compile time of each
corpus file as TypeScript against its type-blanked JavaScript twin (the
cost of erasure) and the twin with the TypeScript flag on (the cost of the
flag on code without types). `bench/ts_parse_depth.js` checks that nested
ambiguous constructs such as `a < b < c < ...` do not blow up the parse
time: speculative parses are memoized and do not build error objects.
