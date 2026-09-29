# rquickjs-sys (gkurt/quickjs)

[rquickjs-sys](https://github.com/DelSkayn/rquickjs/tree/master/sys) with the
[gkurt/quickjs](https://github.com/gkurt/quickjs) engine in place of
QuickJS-NG, for [rquickjs](https://crates.io/crates/rquickjs).

Keep using rquickjs from crates.io and replace its `-sys` crate with this one:

```toml
[dependencies]
rquickjs = "0.14"

[patch.crates-io]
rquickjs-sys = { git = "https://github.com/gkurt/quickjs" }
```

Every crate of your build that uses rquickjs, directly or not, then runs on
this engine: about 1.8x faster on the fork's micro benchmarks. The rquickjs
test suite passes with it (CI runs it on Linux, macOS and Windows).

Cargo takes the default branch of the repository, `next`, and records the
commit in `Cargo.lock`: `cargo update -p rquickjs-sys` moves to the latest
one. To stay on a release of the engine instead, add its tag, for example
`tag = "v0.17.0-gkurt.1"` (the releases are the `v<version>-gkurt.<n>` tags
of the repository), or `rev = "..."` to pin a commit. Cargo does not fetch
the test262 submodule of the repository.

## TypeScript

TypeScript type erasure is included. rquickjs has no option for it, but the
engine can take it from the file name: after
`JS_SetTypeScriptByFilename(rt, true)`, every source whose name ends in `.ts`,
`.mts` or `.cts` is parsed as TypeScript, including modules declared or loaded
through rquickjs, whose name is the module name:

```rust
use rquickjs::{context::EvalOptions, qjs, Context, Module, Runtime};

let rt = Runtime::new()?;
let context = Context::full(&rt)?;
// once per runtime
unsafe { qjs::JS_SetTypeScriptByFilename(context.get_runtime_ptr(), true) };
context.with(|ctx| {
    let n: i32 = ctx.eval_with_options(
        "const n: number = 40; n + 2",
        EvalOptions { filename: Some("input.ts".into()), ..Default::default() },
    )?;
    Module::declare(ctx.clone(), "plugin.ts", "export const n: number = 42;")?;
    Ok::<_, rquickjs::Error>(())
})?;
```

Module loaders (`Loader`s) get the same: return the source of `foo.ts` from
`load` and it is compiled as TypeScript. Other names stay JavaScript; to parse
one as TypeScript, evaluate it through the raw API with
`JS_EVAL_FLAG_TYPESCRIPT`:

```rust
let src = c"const n: number = 40; n + 2";
let v = unsafe {
    qjs::JS_Eval(ctx.as_raw().as_ptr(), src.as_ptr(), src.count_bytes() as _, c"input".as_ptr(),
                 (qjs::JS_EVAL_TYPE_GLOBAL | qjs::JS_EVAL_FLAG_TYPESCRIPT) as i32)
};
```

To leave it out, enable the `disable-typescript` feature (TypeScript sources
then fail with a SyntaxError):

```toml
[dependencies]
rquickjs-sys = { version = "0.14", features = ["disable-typescript"] }
```

## Engine version

`rquickjs_sys::ENGINE_SOURCE_HASH` is a hash of the engine sources the crate
was built from, and `rquickjs_sys::ENGINE_COMMIT` their commit (`None` when
the sources were not a git checkout). The npm package
[@gkurt/quickjs-wasi](https://www.npmjs.com/package/@gkurt/quickjs-wasi)
records the same two in `build.engine` of its `package.json` and in the
`versions` of its VMs (`engineSourceHash`, `engineCommit`): an app shipping
both can check that its native and its wasm plugins run the same engine by
comparing the hashes, which only differ when the engine sources do (commits
can differ while the engine is identical). The hash is computed by
`scripts/engine-source-hash.mjs`, and the same way by `build.rs`.

## Differences from rquickjs-sys

- The engine is the repository this crate lives in (`../..`), not a
  submodule, and a change of it rebuilds the crate (upstream keeps the
  previous build).
- The bundled bindings are generated from this engine's headers.
  rquickjs-sys bakes the engine's internal atom numbers into them, so the
  bindings of upstream rquickjs-sys do not work with this engine.
- `disable-typescript` feature.
- No `wasm32-unknown-unknown`: use `wasm32-wasip1`, or
  [@gkurt/quickjs-wasi](https://www.npmjs.com/package/@gkurt/quickjs-wasi) in
  the browser.

Its version is the rquickjs-sys release it is taken from, so that it matches
rquickjs. Bindings are bundled for the targets of upstream rquickjs-sys; build
others with the `bindgen` feature.

## Maintenance

- `rust/test-rquickjs.sh` runs the rquickjs test suite with this crate.
- When `quickjs.h` or `quickjs-atom.h` change, regenerate the bindings of
  your target with `cargo build --features bindgen,update-bindings` in this
  directory. The `rust` workflow checks the bindings on each native runner
  and uploads the regenerated file when they are out of date.
- To follow a new rquickjs release, take its `sys/` directory (except
  `quickjs/` and `vendor/`) and carry over the changes above: they are
  marked in `build.rs`.

## License

MIT, as rquickjs; see `LICENSE`. The engine is under the MIT license of
QuickJS, see `../../LICENSE`.
