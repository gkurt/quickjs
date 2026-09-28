# @gkurt/quickjs-wasi

[quickjs-wasi](https://github.com/vercel-labs/quickjs-wasi) built with the
[gkurt/quickjs](https://github.com/gkurt/quickjs) engine: a performance fork of
QuickJS-NG compiled to WebAssembly, for the browser, Node.js and Bun.

The JavaScript API, extensions and documentation are those of quickjs-wasi,
whose version is in `build["quickjs-wasi"]` in `package.json`, with the
additions below. Compared with `quickjs-wasi` itself:

- about 2x faster on the fork's micro benchmarks (geomean 1.9x at the same
  optimization level), and built with `-O2` rather than `-Oz`, about 1.2x
  more, for a larger binary (about 400 KB gzipped rather than about 290 KB)
- TypeScript type erasure: `EvalFlags.TYPESCRIPT`, and imported `.ts`,
  `.mts` and `.cts` modules
- several VMs in one WASM instance (`QuickJSInstance`), sharing its memory
- synchronous creation: `QuickJS.createSync()`, `QuickJSInstance.createSync()`
- `vm.getPromiseResult()`: the outcome of a settled promise, synchronously
- the handle a host function returns is consumed, instead of leaking
- a 2 MiB stack: `maxStackSize` up to 1 MiB (`MAX_STACK_SIZE`)
- `vm.versions.engineCommit` and `engineSourceHash`: the engine inside

These changes are a patch series on quickjs-wasi, in
[`patches/`](https://github.com/gkurt/quickjs/tree/next/npm/quickjs-wasi/patches).

## Install

```sh
npm install @gkurt/quickjs-wasi
# or: bun add @gkurt/quickjs-wasi
```

## Usage

The package does no I/O of its own: load `quickjs.wasm` (and any extension)
the way your environment prefers, compile it once and create VMs from it.

Node.js and Bun:

```js
import { readFile } from 'node:fs/promises';
import { QuickJS } from '@gkurt/quickjs-wasi';

const wasm = await WebAssembly.compile(
  await readFile(new URL(import.meta.resolve('@gkurt/quickjs-wasi/quickjs.wasm'))),
);

const vm = await QuickJS.create({ wasm });
console.log(vm.evalCode('[1, 2, 3].map(x => x * 2).join()').consume(h => h.toString())); // 2,4,6
vm.dispose();
```

Browser, with a bundler that supports `?url` imports (Vite):

```js
import { QuickJS } from '@gkurt/quickjs-wasi';
import wasmUrl from '@gkurt/quickjs-wasi/quickjs.wasm?url';

const wasm = await WebAssembly.compileStreaming(fetch(wasmUrl));
const vm = await QuickJS.create({ wasm });
```

### Synchronous creation

`QuickJS.create()` awaits the instantiation of the module. Where that is not
possible (a VM opened during a synchronous paint, a synchronous plugin API),
`QuickJS.createSync()` takes the same options and instantiates with
`new WebAssembly.Instance()`:

```js
// once, ahead of time
const wasm = await WebAssembly.compileStreaming(fetch(wasmUrl));
const encoding = await WebAssembly.compileStreaming(fetch(encodingUrl));

// later, synchronously
const vm = QuickJS.createSync({ wasm, extensions: [{ name: 'encoding', wasm: encoding }] });
```

Pass compiled `WebAssembly.Module`s, for the engine and for the extensions.
Bytes are accepted too, and compiled with `new WebAssembly.Module()`, but
browsers refuse synchronous compilation of large modules on the main thread
(Chrome: over 8 MB). `QuickJSInstance.createSync()` is the same for an
instance of several VMs. The WASI shim, and the memory handed to `wasi`
overrides, have the instance's memory from its first call on.

### Several VMs in one instance

Each `QuickJS.create()` instantiates the WASM module, with a linear memory
of its own that only grows. To run many VMs (one per plugin, say), create
them in one `QuickJSInstance` instead:

```js
import { QuickJSInstance } from '@gkurt/quickjs-wasi';

const inst = await QuickJSInstance.create({ wasm, extensions }); // or createSync()
const a = inst.newVm({ memoryLimit: 16 << 20, interruptHandler: () => Date.now() > deadline });
const b = inst.newVm({ moduleLoader: { load: (name) => sources[name] } });
// a and b have the API of QuickJS.create()'s VMs
b.dispose();   // frees b's runtime; the next newVm() reuses its memory
inst.dispose(); // disposes a, and releases the instance
```

`newVm(options)` takes the options of `QuickJS.create()` except `wasm`,
`wasi` and `extensions`, which belong to the instance.

- **Per VM:** a runtime of its own, so its own heap, `memoryLimit` (one VM
  running out of memory does not affect another), `interruptHandler`,
  `moduleLoader`, `onUnhandledRejection`, `timezoneOffset`, `intrinsics`,
  `maxStackSize`, host functions and garbage collection. Values and handles
  belong to their VM and cannot be passed to another.
- **Shared:** the linear memory, the WASI imports, the extensions (loaded
  once, initialized in every VM) and the stack.
- **Calls between VMs:** a host function of one VM may call into another VM,
  and that one's host functions back into the first; exceptions cross as
  usual (a `JSException` of the inner VM, which the host function rethrows
  or handles). The instance restores the calling VM when a call returns.
- **Disposing:** `vm.dispose()` frees the VM's runtime, including values
  whose handles were never disposed, and throws if the VM is running (from
  one of its own host functions or handlers). Another VM's host function
  may dispose it.
- **Snapshots** capture the whole memory of the instance: `vm.snapshot()`
  throws while the instance holds other VMs. A snapshot restores, with
  `QuickJS.restore()`, into an instance of its own.
- **Stack:** the VMs share one stack; a VM running from another VM's host
  function has the room the other left (see [Stack](#stack)).

### Running untrusted code

Give each script a memory limit and a deadline, and pass data in and out as
JSON. With one instance for all the scripts, a VM costs a runtime, not a new
WASM instance:

```js
import { QuickJSInstance, EvalFlags } from '@gkurt/quickjs-wasi';

const inst = await QuickJSInstance.create({ wasm });

export function runSandboxed(code, input, { timeoutMs = 100, memoryLimit = 16 << 20, typescript = false } = {}) {
  let deadline = 0;
  const vm = inst.newVm({ memoryLimit, interruptHandler: () => Date.now() > deadline });
  try {
    vm.setProp(vm.global, 'input', vm.newString(JSON.stringify(input)));
    deadline = Date.now() + timeoutMs;
    const r = vm.evalCode(
      `JSON.stringify((() => { const input_ = JSON.parse(input); ${code} })())`,
      typescript ? 'script.ts' : 'script.js',
      typescript ? EvalFlags.TYPESCRIPT : 0,
    );
    return JSON.parse(r.consume(h => h.toString()) ?? 'null');
  } catch (e) {
    // 'interrupted', 'out of memory', 'Maximum call stack size exceeded', or the script's error
    return { error: e?.message ?? String(e) };
  } finally {
    vm.dispose(); // frees the runtime for the next VM
  }
}
```

The engine polls the interrupt handler on backward jumps (loops), so it is
cheap; straight line code between two polls always runs to completion. Deep
recursion stops at `maxStackSize` with a `RangeError` (see [Stack](#stack)).
A script cannot reach another VM of the instance: they share memory at the
WASM level only, not values. They are not isolated from each other the way
separate instances are, though: a memory-safety bug in the engine that one
script could exploit would reach the memory of the other VMs of its
instance. Give scripts that must not affect each other instances of their
own (`QuickJS.create()`).

### TypeScript

```js
import { EvalFlags } from '@gkurt/quickjs-wasi';

vm.evalCode('const n: number = 40; n + 2', 'input.ts', EvalFlags.TYPESCRIPT); // 42
```

Types are erased, not checked. Only erasable syntax is supported: enums,
namespaces, parameter properties and `import x = require()` are rejected with
a `SyntaxError`, as with Node's `--experimental-strip-types`. The flag works
with `evalCode()` and `compile()`, for scripts and modules.

Modules loaded by the module loader whose name ends in `.ts`, `.mts` or
`.cts` are TypeScript. `load` may return `{ source, typescript }` to decide
otherwise:

```js
const vm = await QuickJS.create({
  wasm,
  moduleLoader: {
    load: (name) => name.startsWith('virtual:')
      ? { source: sources[name], typescript: true }
      : readFileSync(name, 'utf8'), // .ts by its name
  },
});
```

A package built without TypeScript (`TYPESCRIPT=0` in `build.sh`) rejects
the flag, and TypeScript modules, with `SyntaxError: TypeScript is not
supported in this build`.

### Host functions

The `this` and argument handles a host function receives are borrowed: they
are valid during the call (`dup()` one to keep it). The handle it returns is
consumed: the call's result takes it over, and the handle reads as disposed
afterwards, so a host function can return a new handle without disposing it:

```js
vm.newFunction('add', (a, b) => vm.newNumber(a.toNumber() + b.toNumber()));
```

To return a handle the host keeps using, return `handle.dup()`. The cached
singletons (`vm.undefined`, `vm.null`, `vm.true`, `vm.false`, `vm.global`),
the borrowed arguments and ephemeral functions are duplicated, not consumed.
Returning nothing returns `undefined`. Returning a disposed handle (a cached
one returned a second time) throws into the guest.

### Promise results

`vm.getPromiseResult(promise)` returns the fulfillment value or rejection
reason of a settled promise, synchronously, as a new handle
(`promise.promiseState` is 1 when fulfilled, 2 when rejected; the getter
`promise.promiseResult` is the same). It throws for a pending promise. For
example, the namespace of a module:

```js
const p = vm.evalCode('export const x = 42;', 'm.js', EvalFlags.TYPE_MODULE);
vm.executePendingJobs();
const ns = vm.getPromiseResult(p); // the module's exports
```

### Stack

`maxStackSize` limits the stack a VM's recursion may use, up to
`MAX_STACK_SIZE` (1 MiB of the binary's 2 MiB stack), and defaults to
`DEFAULT_STACK_SIZE` (512 KiB). Past it, the guest gets `RangeError: Maximum
call stack size exceeded`, which it can catch, and the VM stays usable.

The host engine runs the WASM code on its own native stack too, which
recursion fills a little faster than the WASM stack. 1 MiB needs about 2 MiB
of native stack or more, as on JavaScriptCore or in a Node.js worker (4 MiB
by default); on a 1 MiB native stack (Node.js's main thread) the host's
stack overflows first, which throws the host's `RangeError` out of the call
and leaves the VM unusable. The default fits a 1 MiB native stack.

The VMs of an instance share its stack: a VM running from the host function
of another VM starts where the other one is, and has only the rest. The
limit is measured from where the VM was created, and kept 64 KiB above the
bottom of the stack for a VM created deep in it.

### Extensions

`url.so`, `encoding.so`, `headers.so`, `crypto.so` and `structured-clone.so`
are subpath exports, as in quickjs-wasi, for example
`@gkurt/quickjs-wasi/encoding.so`. Use the ones from this package: the
extensions of `quickjs-wasi` are built against its own engine. In a
`QuickJSInstance`, the extensions are loaded once and initialized in every
VM.

## Compatibility

- **Snapshots** restore only into the `quickjs.wasm` that took them, that is
  the same version of this package. Nothing checks it: restoring a snapshot of
  another build (of this package or of `quickjs-wasi`) corrupts the VM. Store
  the package version with each snapshot and compare it on restore. Snapshots
  of 0.1.0 do not restore into 0.2.0.
- **Bytecode** from `quickjs-wasi` or upstream QuickJS-NG is rejected (the
  bytecode version differs); compile it again with this package.
- **Host functions** that returned a handle and kept using it (a cached
  handle) must return `handle.dup()` since 0.2.0.

## Versions

This package has its own version. `package.json` records what it was built
from in `build`: the quickjs-wasi version, commit and patches, the engine
commit and source hash, the optimization level and whether TypeScript is
included. `vm.versions` reports the engine too:

```js
vm.versions;
// { 'quickjs-wasi': '3.6.2', quickjs: '0.17.0',
//   engineCommit: '<commit of gkurt/quickjs>', engineSourceHash: '<16 hex digits>' }
```

`engineSourceHash` identifies the engine's sources whatever the commit, and
the Rust crate of the same engine, `rquickjs-sys` in
[`rust/rquickjs-sys`](https://github.com/gkurt/quickjs/tree/next/rust/rquickjs-sys),
exposes the same hash as `rquickjs_sys::ENGINE_SOURCE_HASH`. An application
that embeds both (native code with rquickjs, plugins in WASM with this
package) can check that they contain the same engine:

```rust
// Rust side: hand the hash to the WebView, or compare it with the one the
// package records in its package.json (build.engine.sourceHash)
let native_engine = rquickjs_sys::ENGINE_SOURCE_HASH;
```

```js
// JavaScript side
if (vm.versions.engineSourceHash !== nativeEngineSourceHash) {
  console.warn('the WASM and the native engines differ');
}
```

The hash is `node scripts/engine-source-hash.mjs` in the repository (a
64-bit FNV-1a of the engine's C sources), which `build.sh` runs.

It is built by `npm/quickjs-wasi/build.sh` in
[gkurt/quickjs](https://github.com/gkurt/quickjs), which applies the patches
and runs the quickjs-wasi test suite, with the patches' tests, on the result.
To release, bump `version` in `npm/quickjs-wasi/package.json` and push to
`next`: CI publishes it.

## License

MIT. See `LICENSE` for the notices of quickjs-wasi and of the engine.
