// Checks the package as a consumer sees it: installed from the packed tarball,
// resolved by name through its exports. Run by smoke-test.sh under Node.js
// and Bun.
import { readFile } from 'node:fs/promises';
import assert from 'node:assert/strict';

const name = process.env.PKG_NAME;
const { QuickJS } = await import(name);
const load = (subpath) => readFile(new URL(import.meta.resolve(`${name}/${subpath}`)));

const wasm = await WebAssembly.compile(await load('quickjs.wasm'));
const expectTypeScript = process.env.EXPECT_TYPESCRIPT !== '0';
const JS_EVAL_FLAG_TYPESCRIPT = 1 << 8;

{
    const vm = await QuickJS.create({ wasm });
    assert.equal(vm.evalCode('[1, 2, 3].map(x => x * 2).join()').consume(h => h.toString()), '2,4,6');
    assert.match(vm.versions.quickjs, /^\d+\.\d+\.\d+/);

    if (expectTypeScript) {
        const r = vm.evalCode('const n: number = 40; n + 2', 'x.ts', JS_EVAL_FLAG_TYPESCRIPT);
        assert.equal(r.consume(h => h.toNumber()), 42);
    } else {
        assert.throws(() => vm.evalCode('1', 'x.ts', JS_EVAL_FLAG_TYPESCRIPT), /TypeScript is not supported/);
    }
    vm.dispose();
}

{
    // timeout through the interrupt handler, then the VM is still usable
    let deadline = Date.now() + 50;
    const vm = await QuickJS.create({ wasm, interruptHandler: () => Date.now() > deadline });
    assert.throws(() => vm.evalCode('while (true) {}'), /interrupted/);
    deadline = Infinity;
    assert.equal(vm.evalCode('1 + 2').consume(h => h.toNumber()), 3);
    vm.dispose();
}

{
    const vm = await QuickJS.create({ wasm, memoryLimit: 8 << 20 });
    assert.throws(() => vm.evalCode('const a = []; for (;;) a.push("x".repeat(1e4));'), /out of memory/);
    vm.dispose();
}

{
    // an extension from the same build, kept across a snapshot
    const encoding = await load('encoding.so');
    const extensions = [{ name: 'encoding', wasm: encoding }];
    const vm = await QuickJS.create({ wasm, extensions });
    vm.evalCode('globalThis.bytes = new TextEncoder().encode("héllo")').dispose();
    const snapshot = vm.snapshot();
    vm.dispose();
    const vm2 = await QuickJS.restore(snapshot, { wasm, extensions });
    assert.equal(vm2.evalCode('new TextDecoder().decode(bytes)').consume(h => h.toString()), 'héllo');
    vm2.dispose();
}

console.log(`${name}: ok (${typeof Bun !== 'undefined' ? `bun ${Bun.version}` : `node ${process.version}`})`);
