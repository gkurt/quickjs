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
one. Add `rev = "..."` to pin a commit. Cargo does not fetch the test262
submodule of the repository.

## TypeScript

TypeScript type erasure is included. rquickjs has no option for it, so
evaluate through the raw API with `JS_EVAL_FLAG_TYPESCRIPT`:

```rust
use rquickjs::qjs;

let src = c"const n: number = 40; n + 2";
let v = unsafe {
    qjs::JS_Eval(ctx.as_raw().as_ptr(), src.as_ptr(), src.count_bytes() as _, c"input.ts".as_ptr(),
                 (qjs::JS_EVAL_TYPE_GLOBAL | qjs::JS_EVAL_FLAG_TYPESCRIPT) as i32)
};
```

To leave it out, enable the `disable-typescript` feature:

```toml
[dependencies]
rquickjs-sys = { version = "0.14", features = ["disable-typescript"] }
```

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
