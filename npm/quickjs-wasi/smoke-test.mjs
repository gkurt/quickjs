// Checks the package as a consumer sees it: installed from the packed tarball,
// resolved by name through its exports. Run by smoke-test.sh under Node.js
// and Bun.
import { readFile } from 'node:fs/promises';
import assert from 'node:assert/strict';

const name = process.env.PKG_NAME;
const { QuickJS, QuickJSInstance, EvalFlags, MAX_STACK_SIZE } = await import(name);
const load = (subpath) => readFile(new URL(import.meta.resolve(`${name}/${subpath}`)));

const wasm = await WebAssembly.compile(await load('quickjs.wasm'));
const expectTypeScript = process.env.EXPECT_TYPESCRIPT !== '0';
const pkg = JSON.parse(await load('package.json'));

{
    const vm = await QuickJS.create({ wasm });
    assert.equal(vm.evalCode('[1, 2, 3].map(x => x * 2).join()').consume(h => h.toString()), '2,4,6');
    assert.match(vm.versions.quickjs, /^\d+\.\d+\.\d+/);
    // the engine the package says it was built from
    assert.equal(vm.versions.engineSourceHash, pkg.build.engine.sourceHash);
    assert.equal(vm.versions.engineCommit, pkg.build.engine.commit);
    assert.equal(MAX_STACK_SIZE, 1024 * 1024);

    if (expectTypeScript) {
        const r = vm.evalCode('const n: number = 40; n + 2', 'x.ts', EvalFlags.TYPESCRIPT);
        assert.equal(r.consume(h => h.toNumber()), 42);
    } else {
        assert.throws(() => vm.evalCode('1', 'x.ts', EvalFlags.TYPESCRIPT), /TypeScript is not supported/);
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
    // synchronous creation, a .ts module, and its namespace read synchronously
    const vm = QuickJS.createSync({
        wasm,
        moduleLoader: { load: () => 'export const twice = (n: number): number => n * 2;' },
    });
    const main = 'import { twice } from "util.ts"; export const out = twice(21);';
    if (expectTypeScript) {
        const p = vm.evalCode(main, 'main.js', EvalFlags.TYPE_MODULE);
        vm.executePendingJobs();
        assert.equal(p.promiseState, 1);
        assert.equal(vm.getPromiseResult(p).consume(ns => ns.getProp('out').consume(h => h.toNumber())), 42);
        p.dispose();
    } else {
        // the import is compiled with the module graph, before evaluation
        assert.throws(() => vm.evalCode(main, 'main.js', EvalFlags.TYPE_MODULE), /TypeScript is not supported/);
    }
    vm.dispose();
}

{
    // several VMs in one instance: a host function of one calls into the
    // other, whose memory limit is its own; disposing one leaves the other
    const inst = await QuickJSInstance.create({ wasm });
    const a = inst.newVm();
    const b = inst.newVm({ memoryLimit: 4 << 20 });
    b.evalCode('globalThis.square = n => n * n').dispose();
    a.newFunction('square', (n) => b.evalCode(`square(${n.toNumber()})`).consume(h => a.newNumber(h.toNumber())))
        .consume(f => a.setProp(a.global, 'square', f));
    assert.equal(a.evalCode('let s = 0; for (let i = 0; i < 1000; i++) s += square(i); s').consume(h => h.toNumber()), 332833500);
    assert.throws(() => b.evalCode('const k = []; for (;;) k.push(new Uint8Array(1 << 16))'), /out of memory/);
    assert.equal(a.evalCode('square(12)').consume(h => h.toNumber()), 144);
    b.dispose();
    assert.equal(inst.vmCount, 1);
    assert.equal(a.evalCode('"still " + "here"').consume(h => h.toString()), 'still here');
    inst.dispose();
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
