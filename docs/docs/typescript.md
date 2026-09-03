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
TypeScript file compiles about 25% slower than the equivalent JavaScript,
and the flag costs a few percent on code without types (ambiguous syntax
such as `<` and `(` needs a look-ahead). `bench/ts_parse_bench.js`
measures this on a corpus of files and `bench/ts_parse_depth.js` checks
that nested ambiguous constructs do not blow up the parse time.
