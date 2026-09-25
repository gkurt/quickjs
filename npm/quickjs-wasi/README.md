# @gkurt/quickjs-wasi

[quickjs-wasi](https://github.com/vercel-labs/quickjs-wasi) built with the
[gkurt/quickjs](https://github.com/gkurt/quickjs) engine: a performance fork of
QuickJS-NG compiled to WebAssembly, for the browser, Node.js and Bun.

The JavaScript API, extensions and documentation are those of quickjs-wasi,
whose version is in `build["quickjs-wasi"]` in `package.json`; only the engine
inside `quickjs.wasm` differs. Compared with `quickjs-wasi` itself:

- about 2x faster on the fork's micro benchmarks (geomean 1.9x at the same
  optimization level), and built with `-O2` rather than `-Oz`, about 1.2x
  more, for a larger binary (about 400 KB gzipped rather than about 290 KB)
- TypeScript type erasure: evaluate with the `JS_EVAL_FLAG_TYPESCRIPT` flag
  (`1 << 8`)

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

### Running untrusted code

Give each script a memory limit and a deadline, and pass data in and out as
JSON:

```js
export async function runSandboxed(code, input, { timeoutMs = 100, memoryLimit = 16 << 20 } = {}) {
  let deadline = 0;
  const vm = await QuickJS.create({ wasm, memoryLimit, interruptHandler: () => Date.now() > deadline });
  try {
    vm.setProp(vm.global, 'input', vm.newString(JSON.stringify(input)));
    deadline = Date.now() + timeoutMs;
    const r = vm.evalCode(`JSON.stringify((() => { const input_ = JSON.parse(input); ${code} })())`);
    return JSON.parse(r.consume(h => h.toString()) ?? 'null');
  } catch (e) {
    return { error: e?.message ?? String(e) }; // 'interrupted', 'out of memory', or the script's error
  } finally {
    vm.dispose();
  }
}
```

The engine polls the interrupt handler on backward jumps (loops), so it is
cheap; straight line code between two polls always runs to completion.

### TypeScript

```js
const JS_EVAL_FLAG_TYPESCRIPT = 1 << 8;
vm.evalCode('const n: number = 40; n + 2', 'input.ts', JS_EVAL_FLAG_TYPESCRIPT); // 42
```

Types are erased, not checked.

### Extensions

`url.so`, `encoding.so`, `headers.so`, `crypto.so` and `structured-clone.so`
are subpath exports, as in quickjs-wasi, for example
`@gkurt/quickjs-wasi/encoding.so`. Use the ones from this package: the
extensions of `quickjs-wasi` are built against its own engine.

## Compatibility

- **Snapshots** restore only into the `quickjs.wasm` that took them, that is
  the same version of this package. Nothing checks it: restoring a snapshot of
  another build (of this package or of `quickjs-wasi`) corrupts the VM. Store
  the package version with each snapshot and compare it on restore.
- **Bytecode** from `quickjs-wasi` or upstream QuickJS-NG is rejected (the
  bytecode version differs); compile it again with this package.

## Versions

This package has its own version. `package.json` records what it was built
from in `build`: the quickjs-wasi version and commit, the engine commit, the
optimization level and whether TypeScript is included.

It is built by `npm/quickjs-wasi/build.sh` in
[gkurt/quickjs](https://github.com/gkurt/quickjs), which also runs the
quickjs-wasi test suite on the result.

## License

MIT. See `LICENSE` for the notices of quickjs-wasi and of the engine.
