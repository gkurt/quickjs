import * as std from "qjs:std";
import * as bjson from "qjs:bjson";
import { assert, assertThrows } from "./assert.js";

/* Property access sites cache (shape, slot) pairs. Every test below runs
   an access site until it is cached, changes the object graph in a way
   that must invalidate the cache, and checks the site again. */

function warm(f, n = 8) {
    let r;
    for (let i = 0; i < n; i++)
        r = f();
    return r;
}

function test_own_property_add_delete()
{
    const read = o => o.x;
    const o = { x: 1 };
    assert(warm(() => read(o)), 1);
    o.y = 2;
    assert(read(o), 1);
    delete o.x;
    assert(read(o), undefined);
    o.x = 3;
    assert(read(o), 3);

    /* the property moves to a different slot in the new shape */
    const p = { a: 1, x: 2 };
    delete p.a;
    assert(read(p), 2);
    p.a = 5;
    assert(read(p), 2);

    /* delete on a shared shape must not affect other objects */
    const q1 = { x: 10, z: 1 }, q2 = { x: 20, z: 1 };
    warm(() => read(q1) + read(q2));
    delete q1.x;
    assert(read(q1), undefined);
    assert(read(q2), 20);
}

function test_prototype_chain()
{
    const read = o => o.p;
    const l3 = { p: "l3" };
    const l2 = Object.create(l3);
    const l1 = Object.create(l2);
    const o = Object.create(l1);
    assert(warm(() => read(o)), "l3");
    /* shadow at every level, then unshadow */
    l1.p = "l1";
    assert(read(o), "l1");
    l2.p = "l2";
    assert(read(o), "l1");
    delete l1.p;
    assert(read(o), "l2");
    delete l2.p;
    assert(read(o), "l3");
    o.p = "own";
    assert(read(o), "own");
    delete o.p;
    assert(read(o), "l3");
    delete l3.p;
    assert(read(o), undefined);
    l3.p = "back";
    assert(read(o), "back");

    /* holder beyond the cached depth */
    const l4 = { q: 4 };
    const c3 = Object.create(l4), c2 = Object.create(c3),
          c1 = Object.create(c2), c0 = Object.create(c1);
    const readq = o => o.q;
    assert(warm(() => readq(c0)), 4);
    c2.q = 2;
    assert(readq(c0), 2);
    delete c2.q;
    l4.q = 44;
    assert(readq(c0), 44);
}

function test_prototype_replacement()
{
    const read = o => o.v;
    const protoA = { v: "A" }, protoB = { v: "B" };
    const o = Object.create(protoA);
    assert(warm(() => read(o)), "A");
    Object.setPrototypeOf(o, protoB);
    assert(read(o), "B");
    o.__proto__ = protoA;
    assert(read(o), "A");
    Object.setPrototypeOf(o, null);
    assert(read(o), undefined);

    /* replace the prototype of an intermediate object */
    const top1 = { w: 1 }, top2 = { w: 2 };
    const mid = Object.create(top1);
    const leaf = Object.create(mid);
    const readw = o => o.w;
    assert(warm(() => readw(leaf)), 1);
    Object.setPrototypeOf(mid, top2);
    assert(readw(leaf), 2);

    /* the intermediate object gains a new property (shape change without
       affecting the holder) */
    mid.unrelated = 1;
    assert(readw(leaf), 2);
    mid.w = 3;
    assert(readw(leaf), 3);
}

function test_accessors()
{
    const read = o => o.g;
    const o = { g: 1 };
    assert(warm(() => read(o)), 1);
    let count = 0;
    Object.defineProperty(o, "g", { get() { count++; return 42; }, configurable: true });
    assert(read(o), 42);
    assert(read(o), 42);
    assert(count, 2);
    Object.defineProperty(o, "g", { value: 7, writable: true, configurable: true });
    assert(read(o), 7);

    /* getter on the prototype, data property shadows it later */
    const proto = { get h() { return "getter"; } };
    const p = Object.create(proto);
    const readh = o => o.h;
    assert(warm(() => readh(p)), "getter");
    Object.defineProperty(p, "h", { value: "data", configurable: true });
    assert(readh(p), "data");

    /* data property on the prototype, then the receiver gets a getter */
    const proto2 = { k: "proto" };
    const p2 = Object.create(proto2);
    const readk = o => o.k;
    assert(warm(() => readk(p2)), "proto");
    Object.defineProperty(p2, "k", { get() { return "own getter"; } });
    assert(readk(p2), "own getter");
}

function test_put_field()
{
    /* sloppy mode writer: failed writes are silently ignored */
    const write = Function("o", "v", "o.x = v;");
    const o = { x: 0 };
    warm(() => write(o, 1));
    assert(o.x, 1);

    /* non writable */
    Object.defineProperty(o, "x", { writable: false });
    write(o, 2);
    assert(o.x, 1);
    assertThrows(TypeError, () => { "use strict"; o.x = 3; });

    /* frozen and sealed */
    const f = { x: 0 };
    warm(() => write(f, 5));
    Object.freeze(f);
    write(f, 6);
    assert(f.x, 5);
    const s = { x: 0 };
    warm(() => write(s, 5));
    Object.seal(s);
    write(s, 6);
    assert(s.x, 6);

    /* setter appears on the prototype after the own property is deleted */
    let set_value;
    const proto = { set x(v) { set_value = v; } };
    const p = Object.create(proto);
    // own data property shadowing the setter
    Object.defineProperty(p, "x", { value: 1, writable: true, configurable: true });
    warm(() => write(p, 2));
    assert(p.x, 2);
    delete p.x;
    write(p, 3);
    assert(set_value, 3);
    assert(Object.hasOwn(p, "x"), false);

    /* own property becomes an accessor */
    const a = { x: 1 };
    warm(() => write(a, 2));
    let acc;
    Object.defineProperty(a, "x", { set(v) { acc = v; }, configurable: true });
    write(a, 9);
    assert(acc, 9);

    /* write to a shape shared with another object */
    const s1 = { x: 1, y: 1 }, s2 = { x: 2, y: 2 };
    warm(() => { write(s1, 10); write(s2, 20); });
    assert(s1.x, 10);
    assert(s2.x, 20);
    Object.defineProperty(s2, "x", { writable: false });
    write(s1, 11);
    write(s2, 21);
    assert(s1.x, 11);
    assert(s2.x, 20);

    /* adding a property must not be cached as an existing slot */
    const add = o => { o.n = 1; };
    for (let i = 0; i < 8; i++) {
        const fresh = { m: i };
        add(fresh);
        assert(fresh.n, 1);
        assert(fresh.m, i);
    }
}

/* A write site adding a property caches the shape transition: the
   receiver gets the new shape and the value without a lookup. The
   add depends on the prototype chain, which is checked by shape.
   Deleting a property leaves a hole in the shape, which is never
   cached: each part below uses its own prototype object */
function test_property_add()
{
    const strict_add = (o, v) => { o.x = v; };
    const sloppy_add = Function("o", "v", "o.x = v;");
    const make = (proto, v) => { const o = Object.create(proto); strict_add(o, v); return o; };
    let proto = {}, o;
    for (let i = 0; i < 8; i++) {
        o = make(proto, i);
        assert(Object.hasOwn(o, "x"), true);
        assert(o.x, i);
        assert(JSON.stringify(Object.getOwnPropertyDescriptor(o, "x")),
               '{"value":' + i + ',"writable":true,"enumerable":true,"configurable":true}');
    }
    /* the objects made at a cached site are independent */
    const o1 = make(proto, 1), o2 = make(proto, 2);
    o1.x = 10;
    assert(o2.x, 2);
    o1.y = 1;
    assert(Object.hasOwn(o2, "y"), false);
    assert(Object.keys(o2).join(), "x");

    /* a setter appears on the prototype after the site is warm */
    let set_value, set_count = 0;
    Object.defineProperty(proto, "x",
                          { set(v) { set_value = v; set_count++; }, configurable: true });
    o = make(proto, 5);
    assert(set_value, 5);
    assert(set_count, 1);
    assert(Object.hasOwn(o, "x"), false);
    /* the setter defines the property itself: it must run every time */
    Object.defineProperty(proto, "x", {
        set(v) {
            set_count++;
            Object.defineProperty(this, "x", { value: v, writable: true,
                                               enumerable: true, configurable: true });
        },
        configurable: true });
    for (let i = 0; i < 8; i++) {
        o = make(proto, i);
        assert(o.x, i);
    }
    assert(set_count, 9);
    /* read only data property on the prototype */
    Object.defineProperty(proto, "x", { value: 42, writable: false, configurable: true });
    assertThrows(TypeError, () => make(proto, 1));
    o = Object.create(proto);
    sloppy_add(o, 1);
    assert(Object.hasOwn(o, "x"), false);
    assert(o.x, 42);
    /* writable data property on the prototype: shadowed by the add */
    Object.defineProperty(proto, "x", { value: 42, writable: true, configurable: true });
    for (let i = 0; i < 8; i++)
        assert(make(proto, i).x, i);
    delete proto.x;
    for (let i = 0; i < 8; i++)
        assert(make(proto, i).x, i);
    /* the site is warm with the shadowed writable property, which
       then becomes read only, then an accessor */
    proto = { x: 0 };
    for (let i = 0; i < 8; i++) {
        o = make(proto, i);
        assert(Object.hasOwn(o, "x"), true);
        assert(o.x, i);
    }
    assert(proto.x, 0);
    Object.defineProperty(proto, "x", { writable: false });
    assertThrows(TypeError, () => make(proto, 1));
    o = Object.create(proto);
    sloppy_add(o, 1);
    assert(Object.hasOwn(o, "x"), false);
    Object.defineProperty(proto, "x", { writable: true });
    for (let i = 0; i < 8; i++)
        assert(make(proto, i).x, i);
    set_count = 0;
    Object.defineProperty(proto, "x", { set(v) { set_count++; }, configurable: true });
    o = make(proto, 3);
    assert(set_count, 1);
    assert(Object.hasOwn(o, "x"), false);
    /* shadowed two levels up, and a read only property above it
       which does not matter */
    const shadow_top = {};
    Object.defineProperty(shadow_top, "x", { value: 1, writable: false });
    proto = Object.create(Object.create(shadow_top, { x: { value: 2, writable: true } }));
    for (let i = 0; i < 8; i++)
        assert(make(proto, i).x, i);
    Object.defineProperty(Object.getPrototypeOf(proto), "x", { writable: false });
    assertThrows(TypeError, () => make(proto, 1));
    /* the prototype of the prototype gets the setter */
    proto = Object.create({});
    for (let i = 0; i < 8; i++)
        assert(make(proto, i).x, i);
    Object.defineProperty(Object.getPrototypeOf(proto), "x",
                          { set(v) { set_value = v; }, configurable: true });
    o = make(proto, 77);
    assert(set_value, 77);
    assert(Object.hasOwn(o, "x"), false);

    /* non extensible receiver with the cached shape */
    proto = {};
    for (let i = 0; i < 8; i++)
        make(proto, i);
    for (let i = 0; i < 8; i++) {
        o = Object.preventExtensions(Object.create(proto));
        assertThrows(TypeError, () => strict_add(o, 1));
        sloppy_add(o, 1);
        assert(Object.hasOwn(o, "x"), false);
        o = Object.freeze(Object.create(proto));
        sloppy_add(o, 1);
        assert(Object.hasOwn(o, "x"), false);
    }

    /* the property storage grows during a cached add */
    const build = () => {
        const o = {};
        o.p0 = 0; o.p1 = 1; o.p2 = 2; o.p3 = 3; o.p4 = 4; o.p5 = 5;
        o.p6 = 6; o.p7 = 7; o.p8 = 8; o.p9 = 9; o.p10 = 10; o.p11 = 11;
        o.p12 = 12; o.p13 = 13; o.p14 = 14; o.p15 = 15; o.p16 = 16;
        return o;
    };
    for (let i = 0; i < 8; i++) {
        o = build();
        for (let j = 0; j <= 16; j++)
            assert(o["p" + j], j);
        assert(Object.keys(o).length, 17);
    }

    /* the setter adds another property */
    proto = { set x(v) { this.y = v; } };
    for (let i = 0; i < 8; i++) {
        o = make(proto, 7);
        assert(Object.hasOwn(o, "x"), false);
        assert(o.y, 7);
    }
    /* __proto__ is a setter which changes the shape without adding */
    const setproto = (o, p) => { o.__proto__ = p; };
    for (let i = 0; i < 8; i++) {
        o = {};
        setproto(o, proto);
        assert(Object.getPrototypeOf(o), proto);
        assert(Object.hasOwn(o, "__proto__"), false);
    }

    /* prototype chain deeper than the cache: a setter far up the chain */
    let deep_value;
    const top = {};
    const chain = [top];
    for (let i = 0; i < 6; i++)
        chain.push(Object.create(chain[i]));
    const bottom = chain[6];
    for (let i = 0; i < 8; i++)
        assert(make(bottom, i).x, i);
    Object.defineProperty(top, "x", { set(v) { deep_value = v; }, configurable: true });
    o = make(bottom, 99);
    assert(deep_value, 99);
    assert(Object.hasOwn(o, "x"), false);
    Object.defineProperty(chain[3], "x", { value: 0, writable: false, configurable: true });
    assertThrows(TypeError, () => make(bottom, 1));

    /* a Proxy in the prototype chain sees every add */
    let trap_count = 0;
    const px = new Proxy({}, { set(t, k, v, r) { trap_count++; return Reflect.set(t, k, v, r); } });
    for (let i = 0; i < 8; i++) {
        o = make(px, i);
        assert(o.x, i);
        assert(Object.hasOwn(o, "x"), true);
    }
    assert(trap_count, 8);
    /* a Proxy shares the shape of the objects without prototype */
    for (let i = 0; i < 8; i++)
        assert(make(null, i).x, i);
    const target = {};
    const px2 = new Proxy(target, { set(t, k, v, r) { trap_count++; return Reflect.set(t, k, v); } });
    strict_add(px2, 3);
    assert(trap_count, 9);
    assert(target.x, 3);
    assert(Object.hasOwn(px2, "x"), true);
    assert(Reflect.ownKeys(px2).join(), "x");

    /* exotic receiver sharing the shape of the ordinary objects which
       warmed the site */
    for (let i = 0; i < 8; i++)
        assert(make(Uint8Array.prototype, i).x, i);
    const ta = new Uint8Array(4);
    strict_add(ta, 5);
    assert(ta.x, 5);
    assert(Object.hasOwn(ta, "x"), true);
    assert(ta.length, 4);
    for (let i = 0; i < 8; i++)
        assert(make(String.prototype, i).x, i);
    const st = new String("ab");
    strict_add(st, 6);
    assert(st.x, 6);
    assert(st.length, 2);
    assert(Object.getOwnPropertyNames(st).join(), "0,1,length,x");

    /* class instances: the prototype of 'this' differs in a subclass */
    class A { constructor(v) { this.a = v; this.b = v + 1; } }
    class B extends A { constructor(v) { super(v); this.c = v + 2; } }
    for (let i = 0; i < 8; i++) {
        const a = new A(i), b = new B(i);
        assert(Object.keys(a).join(), "a,b");
        assert(Object.keys(b).join(), "a,b,c");
        assert(a.b, i + 1);
        assert(b.c, i + 2);
        assert(Object.getPrototypeOf(b), B.prototype);
    }
    let b_set;
    Object.defineProperty(B.prototype, "b", { set(v) { b_set = v; }, configurable: true });
    const b = new B(10);
    assert(b_set, 11);
    assert(Object.hasOwn(b, "b"), false);
    assert(Object.keys(new A(10)).join(), "a,b");

    /* the cached shapes survive a GC */
    proto = {};
    for (let i = 0; i < 8; i++)
        make(proto, i);
    std.gc();
    for (let i = 0; i < 8; i++) {
        o = make(proto, i);
        assert(o.x, i);
        assert(Object.keys(o).join(), "x");
    }
}

/* Object literals define their properties through the same transition
   cache, without consulting the prototype chain */
function test_object_literal()
{
    const lit = (a, b) => ({ x: a, y: b });
    for (let i = 0; i < 8; i++) {
        const o = lit(i, -i);
        assert(o.x, i);
        assert(o.y, -i);
        assert(Object.keys(o).join(), "x,y");
    }
    /* a setter on Object.prototype does not affect a literal */
    let set_count = 0;
    Object.defineProperty(Object.prototype, "x", { set(v) { set_count++; }, configurable: true });
    Object.defineProperty(Object.prototype, "y", { value: 0, writable: false, configurable: true });
    for (let i = 0; i < 8; i++) {
        const o = lit(i, -i);
        assert(Object.hasOwn(o, "x"), true);
        assert(o.x, i);
        assert(o.y, -i);
    }
    assert(set_count, 0);
    delete Object.prototype.x;
    delete Object.prototype.y;

    /* duplicate keys: the last one wins, the order is kept */
    const dup = (a, b, c) => ({ x: a, y: b, x: c });
    for (let i = 0; i < 8; i++) {
        const o = dup(1, 2, 3);
        assert(o.x, 3);
        assert(o.y, 2);
        assert(Object.keys(o).join(), "x,y");
    }

    /* literals with the same keys and computed or spread parts */
    const spread = (a, src) => ({ x: a, ...src, z: 1 });
    for (let i = 0; i < 8; i++) {
        const o = spread(i, { y: i });
        assert(Object.keys(o).join(), "x,y,z");
        assert(o.y, i);
        const o2 = spread(i, { x: 100, w: 2 });
        assert(Object.keys(o2).join(), "x,w,z");
        assert(o2.x, 100);
    }
    const computed = (k, v) => ({ x: 1, [k]: v, y: 2 });
    for (let i = 0; i < 8; i++) {
        assert(Object.keys(computed("k" + i, i)).join(), "x,k" + i + ",y");
        assert(Object.keys(computed("x", i)).join(), "x,y");
        assert(computed("x", i).x, i);
    }

    /* the shape of an empty literal grows in many different ways */
    const many = i => {
        const o = {};
        o["p" + (i % 4)] = i;
        o.q = i;
        return o;
    };
    for (let i = 0; i < 16; i++) {
        const o = many(i);
        assert(Object.keys(o).join(), "p" + (i % 4) + ",q");
        assert(o.q, i);
    }

    /* literal in a function loaded from bytecode */
    const src = ";(function f(a) { const o = { u: a, v: a + 1 }; o.w = a + 2; return o; })";
    let obj = std.evalScript(src, { compile_only: true });
    let buf = bjson.write(obj, bjson.WRITE_OBJ_BYTECODE);
    obj = bjson.read(buf, 0, buf.byteLength, bjson.READ_OBJ_BYTECODE);
    const f = std.evalScript(obj, { eval_function: true });
    for (let i = 0; i < 8; i++) {
        const o = f(i);
        assert(Object.keys(o).join(), "u,v,w");
        assert(o.u + o.v + o.w, 3 * i + 3);
    }
}

function test_arrays()
{
    const readpush = a => a.push;
    const a = [1, 2, 3];
    assert(warm(() => readpush(a)), Array.prototype.push);
    a.push = "own";
    assert(readpush(a), "own");
    delete a.push;
    assert(readpush(a), Array.prototype.push);
    const saved = Array.prototype.push;
    Array.prototype.push = function() { return "patched"; };
    assert(readpush(a), Array.prototype.push);
    assert(a.push(), "patched");
    delete Array.prototype.push;
    assert(readpush(a), undefined);
    Array.prototype.push = saved;
    assert(readpush(a), saved);

    /* array with named own properties, converted to slow array */
    const readlen = a => a.length;
    const readfoo = a => a.foo;
    const b = [1, 2];
    b.foo = "bar";
    assert(warm(() => readfoo(b)), "bar");
    assert(warm(() => readlen(b)), 2);
    b[100] = 1; // still fast?  either way the reads must work
    assert(readlen(b), 101);
    b[1e6] = 1;
    assert(readlen(b), 1e6 + 1);
    assert(readfoo(b), "bar");
    delete b.foo;
    assert(readfoo(b), undefined);

    /* typed arrays have canonical numeric string keys that must not be
       resolved through the prototype chain */
    const ta = new Float64Array(2);
    const readInf = o => o.Infinity;
    Object.prototype.Infinity = "proto";
    assert(warm(() => readInf(ta)), undefined);
    assert(readInf({}), "proto");
    delete Object.prototype.Infinity;
    assert(readInf(ta), undefined);
    const readlen2 = o => o.length;
    assert(warm(() => readlen2(ta)), 2);
    assert(readlen2([1, 2, 3]), 3);
    assert(readlen2("abcd"), 4);
    assert(readlen2({ length: 9 }), 9);
}

function test_shape_aliasing()
{
    /* an exotic object created with the same prototype and own
       properties as an ordinary object shares its shape: the cache
       filled by the ordinary object must not be used for the exotic one */
    const read = o => o.Infinity;
    Uint8Array.prototype.Infinity = "proto";
    try {
        const plain = Object.create(Uint8Array.prototype);
        assert(warm(() => read(plain)), "proto");
        const ta = new Uint8Array(4);
        assert(read(ta), undefined);
        assert(read(plain), "proto");
        assert(read(ta), undefined);

        /* exotic object as the prototype of an ordinary one */
        const child = Object.create(ta);
        assert(read(child), undefined);
        const plain_child = Object.create(plain);
        assert(warm(() => read(plain_child)), "proto");
        assert(read(child), undefined);
    } finally {
        delete Uint8Array.prototype.Infinity;
    }

    /* integer keyed destructuring uses a property access site with an
       integer key: the character of a String object is not looked up on
       the prototype */
    const read0 = o => { const { 0: v } = o; return v; };
    Object.defineProperty(String.prototype, "0", { value: "proto0", configurable: true });
    try {
        const plain = Object.create(String.prototype);
        Object.defineProperty(plain, "length", { value: 2 });
        assert(warm(() => read0(plain)), "proto0");
        const str = new String("ab");
        assert(read0(str), "a");
        assert(read0(plain), "proto0");
    } finally {
        delete String.prototype[0];
    }

    /* arrays share no shape with ordinary objects, and their named
       properties are ordinary */
    const readx = o => o.x;
    Array.prototype.x = "array proto";
    try {
        const a = [1, 2];
        assert(warm(() => readx(a)), "array proto");
        const o = Object.create(Array.prototype);
        assert(readx(o), "array proto");
        a[5] = 1;
        a[1e6] = 1; // slow array
        assert(readx(a), "array proto");
        a.x = "own";
        assert(readx(a), "own");
    } finally {
        delete Array.prototype.x;
    }
}

function test_proxy()
{
    const read = o => o.x;
    const target = { x: 1 };
    assert(warm(() => read(target)), 1);
    let traps = 0;
    const proxy = new Proxy(target, { get(t, k, r) { traps++; return "trap:" + k; } });
    assert(read(proxy), "trap:x");
    assert(read(target), 1);
    assert(read(proxy), "trap:x");
    assert(traps, 2);

    /* proxy in the prototype chain */
    const child = Object.create(proxy);
    assert(read(child), "trap:x");
    const plain = Object.create({ x: "plain" });
    assert(warm(() => read(plain)), "plain");
    Object.setPrototypeOf(plain, proxy);
    assert(read(plain), "trap:x");

    /* writes through a proxy */
    let sets = 0;
    const wtarget = { x: 0 };
    const write = (o, v) => { o.x = v; };
    warm(() => write(wtarget, 1));
    const wproxy = new Proxy(wtarget, { set(t, k, v) { sets++; t[k] = v * 2; return true; } });
    write(wproxy, 5);
    assert(sets, 1);
    assert(wtarget.x, 10);
}

function test_polymorphic()
{
    const read = o => o.k;
    const objs = [
        { k: 1 }, { a: 0, k: 2 }, { a: 0, b: 0, k: 3 }, Object.create({ k: 4 }),
        { get k() { return 5; } }, [ ], new Proxy({}, { get: () => 7 }), "str",
    ];
    objs[5].k = 6;
    const expected = [1, 2, 3, 4, 5, 6, 7, undefined];
    for (let round = 0; round < 4; round++) {
        for (let i = 0; i < objs.length; i++)
            assert(read(objs[i]), expected[i]);
        for (let i = objs.length - 1; i >= 0; i--)
            assert(read(objs[i]), expected[i]);
    }
    String.prototype.k = "S";
    assert(read("str"), "S");
    delete String.prototype.k;
    assert(read("str"), undefined);
    assert(read(5), undefined);
    assert(read(true), undefined);
    assert(read(Symbol()), undefined);
    assert(read(1n), undefined);
    assertThrows(TypeError, () => read(null));
    assertThrows(TypeError, () => read(undefined));

    /* megamorphic: many distinct shapes through one site */
    const shapes = [];
    for (let i = 0; i < 100; i++) {
        const o = {};
        for (let j = 0; j <= i; j++)
            o["p" + j] = j;
        o.k = i;
        shapes.push(o);
    }
    for (let round = 0; round < 3; round++)
        for (let i = 0; i < shapes.length; i++)
            assert(read(shapes[i]), i);
}

function test_two_shapes()
{
    /* a site remembers two receiver shapes: both must be invalidated
       independently */
    const read = o => o.k;
    const a = { k: 1, a: 0 }, b = { b: 0, k: 2 };
    for (let i = 0; i < 8; i++) {
        assert(read(a), 1);
        assert(read(b), 2);
    }
    delete b.k;
    assert(read(a), 1);
    assert(read(b), undefined);
    b.k = 3;
    assert(read(b), 3);
    delete a.k;
    assert(read(a), undefined);
    assert(read(b), 3);
    Object.defineProperty(a, "k", { get() { return 4; } });
    assert(read(a), 4);
    assert(read(b), 3);

    /* the second shape finds the property on a prototype */
    const proto1 = { k: "p1" }, proto2 = { k: "p2" };
    const c = Object.create(proto1), d = Object.create(proto2);
    c.c = 0;
    d.d = 0;
    d.e = 0;
    for (let i = 0; i < 8; i++) {
        assert(read(c), "p1");
        assert(read(d), "p2");
    }
    proto2.k = "p2b";
    assert(read(c), "p1");
    assert(read(d), "p2b");
    d.k = "own";
    assert(read(d), "own");
    assert(read(c), "p1");
    Object.setPrototypeOf(c, { k: "p3" });
    assert(read(c), "p3");
    delete proto1.k;
    assert(read(Object.create(proto1)), undefined);

    /* two shapes at a write site */
    const write = Function("o", "v", "o.x = v;");
    const w1 = { x: 0, a: 0 }, w2 = { a: 0, x: 0 };
    for (let i = 0; i < 8; i++) {
        write(w1, i);
        write(w2, -i);
    }
    assert(w1.x, 7);
    assert(w2.x, -7);
    Object.defineProperty(w2, "x", { writable: false });
    write(w1, 8);
    write(w2, 9);
    assert(w1.x, 8);
    assert(w2.x, -7);
    Object.freeze(w1);
    write(w1, 10);
    assert(w1.x, 8);
    let seen;
    const w3 = { a: 0, set x(v) { seen = v; } };
    write(w3, 11);
    assert(seen, 11);
    assert(Object.hasOwn(w3, "x"), true);

    /* the site both adds the property to some objects and writes the
       existing one of others */
    function add_or_set(o, v) { o.y = v; }
    const objs = [];
    for (let i = 0; i < 8; i++) {
        const fresh = { a: i };
        add_or_set(fresh, i);
        objs.push(fresh);
        add_or_set(objs[0], -i);
    }
    for (let i = 1; i < 8; i++)
        assert(objs[i].y, i);
    assert(objs[0].y, -7);
    Object.preventExtensions({ a: 0 });
    const ne = Object.preventExtensions({ a: 100 });
    assertThrows(TypeError, () => add_or_set(ne, 1));
    assert(Object.hasOwn(ne, "y"), false);
    Object.defineProperty(Object.prototype, "y", { set(v) { seen = v; }, configurable: true });
    add_or_set({ a: 200 }, 12);
    assert(seen, 12);
    delete Object.prototype.y;
    const after = { a: 300 };
    add_or_set(after, 13);
    assert(after.y, 13);

    /* three and more shapes keep working once the site stops caching */
    const many = [{ k: 0, a: 0 }, { a: 0, k: 1 }, { a: 0, b: 0, k: 2 }, { a: 0, b: 0, c: 0, k: 3 }];
    for (let round = 0; round < 10; round++)
        for (let i = 0; i < many.length; i++)
            assert(read(many[i]), i);
    for (let i = 0; i < many.length; i++) {
        many[i].k = "m" + i;
        assert(read(many[i]), "m" + i);
        delete many[i].k;
        assert(read(many[i]), undefined);
    }
    assert(read({ k: "new" }), "new");

    /* method calls on instances of two classes */
    class Shape { area() { return 0; } }
    class Circle extends Shape { constructor(r) { super(); this.r = r; } area() { return 3 * this.r * this.r; } }
    class Square extends Shape { constructor(s) { super(); this.s = s; } area() { return this.s * this.s; } }
    const total = list => { let t = 0; for (const x of list) t += x.area(); return t; };
    const list = [new Circle(1), new Square(2), new Circle(2), new Square(3)];
    for (let i = 0; i < 8; i++)
        assert(total(list), 3 + 4 + 12 + 9);
    Square.prototype.area = function() { return -1; };
    assert(total(list), 3 + 12 - 2);
    list[0].area = () => 100;
    assert(total(list), 100 + 12 - 2);
    Object.setPrototypeOf(Circle.prototype, { area() { return 7; } });
    delete Circle.prototype.area;
    assert(total(list), 100 + 7 - 2);

    /* both entries hold shapes of collected prototypes */
    function two(o1, o2) { return o1.z + o2.z; }
    for (let i = 0; i < 20; i++) {
        const p1 = Object.create({ z: 1 }), p2 = Object.create({ z: 2 });
        p1["a" + (i & 1)] = 0;
        p2["b" + (i & 1)] = 0;
        p2.c = 0;
        for (let j = 0; j < 4; j++)
            assert(two(p1, p2), 3);
        std.gc();
    }
}

function test_primitive_receiver()
{
    /* a method call on a string, a number... looks the property up
       through the prototype of the primitive and caches it there */
    const code = s => s.charCodeAt(0);
    assert(warm(() => code("a")), 97);
    const orig = String.prototype.charCodeAt;
    String.prototype.charCodeAt = function(i) { return -orig.call(this, i); };
    assert(code("a"), -97);
    String.prototype.charCodeAt = orig;
    assert(code("b"), 98);
    delete String.prototype.charCodeAt;
    assertThrows(TypeError, () => code("a"));
    String.prototype.charCodeAt = orig;
    assert(code("c"), 99);

    /* string kinds: a rope from a concatenation, a slice, a wide string */
    let rope = "";
    for (let i = 0; i < 200; i++)
        rope += "xy";
    assert(code(rope), 120);
    assert(code(rope.slice(1, 100)), 121);
    assert(code("\u{1F600}z"), 0xd83d);
    assert(code(String(12)), 49);

    /* the property is found further up the chain, then shadowed */
    const own = s => s.hasOwnProperty("length");
    assert(warm(() => own("abc")), true);
    String.prototype.hasOwnProperty = () => "shadow";
    assert(own("abc"), "shadow");
    delete String.prototype.hasOwnProperty;
    assert(own("abc"), true);
    Object.prototype.extra = function() { return this + "!"; };
    const extra = s => s.extra();
    assert(warm(() => extra("hi")), "hi!");
    delete Object.prototype.extra;
    assertThrows(TypeError, () => extra("hi"));

    /* an accessor on the prototype is not cached */
    Object.defineProperty(String.prototype, "acc", {
        get() { return () => this.length; }, configurable: true });
    const acc = s => s.acc();
    for (let i = 0; i < 8; i++)
        assert(acc("four"), 4);
    delete String.prototype.acc;
    assertThrows(TypeError, () => acc("four"));

    /* the own properties of the string are never read through the
       prototype, even with a shadowing method on it */
    const len = s => s.length();
    const idx = s => s[0]();
    for (let i = 0; i < 4; i++) {
        assertThrows(TypeError, () => len("abc"));
        assertThrows(TypeError, () => idx("abc"));
    }
    String.prototype[0] = () => "proto0";
    assertThrows(TypeError, () => idx("abc"));
    assert(idx(""), "proto0");
    delete String.prototype[0];
    assertThrows(TypeError, () => idx(""));

    /* numbers, booleans, symbols and bigints */
    const fixed = n => n.toFixed(1);
    const orig_fixed = Number.prototype.toFixed;
    assert(warm(() => fixed(1.25)), "1.3");
    assert(fixed(2), "2.0");
    Number.prototype.toFixed = function() { return "n" + this; };
    assert(fixed(3), "n3");
    delete Number.prototype.toFixed;
    assertThrows(TypeError, () => fixed(3));
    Number.prototype.toFixed = orig_fixed;
    assert(fixed(4), "4.0");
    const str = v => v.toString();
    assert(warm(() => str(true)), "true");
    assert(str(false), "false");
    assert(str(10n), "10");
    assert(str(Symbol("s")), "Symbol(s)");
    assert(str(1.5), "1.5");
    assert(str("s"), "s");
    assert(str({}), "[object Object]");
    const orig_bool = Boolean.prototype.toString;
    Boolean.prototype.toString = () => "bool";
    assert(str(true), "bool");
    delete Boolean.prototype.toString;
    assert(str(true), "[object Boolean]");
    Boolean.prototype.toString = orig_bool;
    assert(str(true), "true");

    /* the same site sees objects and primitives */
    const mixed = v => v.valueOf();
    const o = { valueOf() { return "o"; } };
    for (let i = 0; i < 8; i++) {
        assert(mixed(o), "o");
        assert(mixed(5), 5);
        assert(mixed("s"), "s");
    }
    o.valueOf = () => "o2";
    assert(mixed(o), "o2");
    assert(mixed(5), 5);

    /* null and undefined receivers */
    assertThrows(TypeError, () => str(null));
    assertThrows(TypeError, () => str(undefined));
    assertThrows(TypeError, () => code(null));

    /* the prototype chain of a primitive can be changed */
    const string_proto_proto = Object.getPrototypeOf(String.prototype);
    Object.setPrototypeOf(String.prototype, { hasOwnProperty() { return "other"; } });
    assert(own("abc"), "other");
    Object.setPrototypeOf(String.prototype, null);
    assertThrows(TypeError, () => own("abc"));
    Object.setPrototypeOf(String.prototype, string_proto_proto);
    assert(own("abc"), true);
    assert(code("d"), 100);
}

function test_local_receiver()
{
    /* reads of a local variable's property fuse into one instruction:
       the getter may reassign the local while the read is in progress */
    function getter_mutates_local() {
        let o = { get x() { o = null; return "first"; } };
        const r = o.x;
        assert(r, "first");
        assert(o, null);
    }
    getter_mutates_local();

    function getter_replaces_local() {
        let o = { get x() { o = { x: "second" }; return "first"; } };
        const r1 = o.x;
        const r2 = o.x;
        assert(r1, "first");
        assert(r2, "second");
    }
    getter_replaces_local();

    function local_reassigned_in_loop() {
        let o = { x: 1 };
        let sum = 0;
        for (let i = 0; i < 20; i++) {
            sum += o.x ?? 0;
            if (i == 5) o = { y: 0, x: 100 };
            if (i == 10) o = Object.create({ x: 1000 });
            if (i == 15) o = "str";
        }
        assert(sum, 6 + 5 * 100 + 5 * 1000 + 0);
    }
    local_reassigned_in_loop();

    function local_undefined() {
        let o;
        assertThrows(TypeError, () => o.x);
        o = null;
        assertThrows(TypeError, () => o.x);
        o = 42;
        assert(o.x, undefined);
        Number.prototype.x = "num";
        assert(o.x, "num");
        delete Number.prototype.x;
        o = { x: "obj" };
        assert(o.x, "obj");
    }
    local_undefined();

    function local_length() {
        let a = [1, 2, 3];
        let s = "hello";
        let o = { length: 7 };
        assert(a.length + s.length + o.length, 15);
    }
    local_length();

    function arg_receiver(o) {
        return o.x;
    }
    assert(warm(() => arg_receiver({ x: 3 })), 3);
    assert(arg_receiver({ y: 0, x: 4 }), 4);
    assert(arg_receiver(Object.create({ x: 5 })), 5);

    function this_receiver() {
        return this.x;
    }
    assert(warm(() => this_receiver.call({ x: 6 })), 6);
    assert(this_receiver.call({ y: 0, x: 7 }), 7);
    assertThrows(TypeError, () => { "use strict"; return this_receiver.call(undefined); });

    /* getter observes and modifies the object it is defined on */
    function getter_deletes_self() {
        let o = {
            get x() { delete o.x; o.x = "data"; return "getter"; },
            y: 1,
        };
        assert(o.x, "getter");
        assert(o.x, "data");
    }
    getter_deletes_self();
}

function test_dictionary_mode()
{
    const read = o => o.k;
    const o = { k: 1 };
    assert(warm(() => read(o)), 1);
    for (let i = 0; i < 2000; i++)
        o["p" + i] = i;
    assert(read(o), 1);
    for (let i = 0; i < 2000; i += 2)
        delete o["p" + i];
    assert(read(o), 1);
    o.k = 2;
    assert(read(o), 2);
    delete o.k;
    assert(read(o), undefined);
    Object.setPrototypeOf(o, { k: 3 });
    assert(read(o), 3);

    /* keyed adds to a large object which a site reads: the object
       becomes a dictionary and stays correct */
    const d = {};
    for (let i = 0; i < 200; i++)
        d["q" + i] = i;
    const read_q5 = o => o.q5;
    const read_k = o => o.k;
    for (let i = 200; i < 3000; i++) {
        d["q" + i] = i;
        assert(read_q5(d), 5);
        assert(read_k(d), undefined);
    }
    d.k = 7;
    assert(read_k(d), 7);
    delete d.q5;
    assert(read_q5(d), undefined);
    d.q5 = 55;
    assert(read_q5(d), 55);
    Object.defineProperty(d, "q5", { get() { return "getter"; } });
    assert(read_q5(d), "getter");
    for (let i = 0; i < 3000; i++)
        assert(d["q" + i], i == 5 ? "getter" : i);
    assert(Object.keys(d).length, 3001);
}

function test_large_objects()
{
    /* an object with more properties than a small cache limit, built
       by a constructor, and its large prototype */
    const n = 300;
    const src = [];
    for (let i = 0; i < n; i++)
        src.push("this.f" + i + " = " + i + ";");
    const C = Function(src.join("\n"));
    for (let i = 0; i < n; i++)
        C.prototype["m" + i] = Function("return this.f" + i + ";");
    const read = Function("o", "return o.f250 + o.m10() + o.f0;");
    let o;
    for (let i = 0; i < 8; i++) {
        o = new C();
        assert(read(o), 250 + 10 + 0);
    }
    const o2 = new C();
    assert(read(o2), 260);
    o.f250 = 1;
    assert(read(o), 1 + 10);
    assert(read(o2), 260);
    delete o.f0;
    assert(read(o), NaN);
    o2.m10 = function() { return 1000; };
    assert(read(o2), 250 + 1000);
    C.prototype.m10 = function() { return 20; };
    assert(read(new C()), 250 + 20);
    Object.defineProperty(o2, "f250", { get() { return 2; } });
    assert(read(o2), 2 + 1000);
    assert(Object.keys(new C()).length, n);

    /* object literals larger than the cache limit */
    const props = [];
    for (let i = 0; i < 1500; i++)
        props.push("p" + i + ": " + i);
    const make = Function("return {" + props.join(",") + "};");
    for (let k = 0; k < 3; k++) {
        const lit = make();
        assert(Object.keys(lit).length, 1500);
        assert(lit.p0 + lit.p1023 + lit.p1024 + lit.p1499, 0 + 1023 + 1024 + 1499);
    }
}

function test_class_instances()
{
    class Base {
        constructor() { this.a = 1; }
        get computed() { return this.a * 10; }
        method() { return "base"; }
    }
    class Derived extends Base {
        constructor() { super(); this.b = 2; }
        method() { return "derived"; }
    }
    const call = o => o.method();
    const comp = o => o.computed;
    const b = new Base(), d = new Derived();
    for (let i = 0; i < 10; i++) {
        assert(call(b), "base");
        assert(call(d), "derived");
        assert(comp(b), 10);
        assert(comp(d), 10);
    }
    Base.prototype.method = function() { return "patched"; };
    assert(call(b), "patched");
    assert(call(d), "derived");
    delete Derived.prototype.method;
    assert(call(d), "patched");
    d.a = 5;
    assert(comp(d), 50);
    Object.defineProperty(Base.prototype, "computed", { value: "const", configurable: true });
    assert(comp(b), "const");
    assert(comp(d), "const");
}

function test_gc()
{
    /* cached shapes keep prototypes reachable only through the cache;
       collecting must neither crash nor invalidate wrongly */
    const read = o => o.z;
    function make() {
        const proto = { z: "proto" };
        for (let i = 0; i < 5; i++) {
            const o = Object.create(proto);
            o["f" + i] = i;
            assert(read(o), "proto");
        }
    }
    for (let i = 0; i < 20; i++) {
        make();
        std.gc();
    }
    assert(read(Object.create({ z: "after" })), "after");

    /* cycle: function -> cache -> shape -> proto -> function */
    function cycle() {
        const proto = {};
        proto.fn = function f(o) { return o.q; };
        const o = Object.create(proto);
        o.q = 1;
        for (let i = 0; i < 5; i++)
            assert(proto.fn(o), 1);
    }
    for (let i = 0; i < 20; i++)
        cycle();
    std.gc();
}

function test_bytecode_roundtrip()
{
    const src = ";(function f(o, p) { \"use strict\"; let q = o; q.w = o.x + p.y; return q.w + o.x + p.y; })";
    let obj = std.evalScript(src, { compile_only: true });
    let buf = bjson.write(obj, bjson.WRITE_OBJ_BYTECODE);
    obj = bjson.read(buf, 0, buf.byteLength, bjson.READ_OBJ_BYTECODE);
    const f = std.evalScript(obj, { eval_function: true });
    const o = { x: 1 }, p = { y: 2 };
    for (let i = 0; i < 10; i++)
        assert(f(o, p), 6);
    assert(o.w, 3);
    assert(f({ a: 0, x: 10 }, Object.create({ y: 20 })), 60);
    Object.defineProperty(o, "w", { writable: false });
    assertThrows(TypeError, () => f(o, p));

    /* a second round trip of the already loaded function keeps working */
    buf = bjson.write(std.evalScript(src, { compile_only: true }), bjson.WRITE_OBJ_BYTECODE);
    const buf2 = bjson.write(bjson.read(buf, 0, buf.byteLength, bjson.READ_OBJ_BYTECODE),
                             bjson.WRITE_OBJ_BYTECODE);
    assert(buf2.byteLength, buf.byteLength);
}

function test_many_sites()
{
    /* more property access sites than cache slots: the extra sites share
       a slot that is never filled and must still behave */
    const n = 70000;
    const parts = ["(function(o) { let s = 0;"];
    for (let i = 0; i < n; i++)
        parts.push(`s += o.p${i & 7};`);
    parts.push("o.p0 = s; return s; })");
    const f = (0, eval)(parts.join("\n"));
    const o = {};
    for (let i = 0; i < 8; i++)
        o["p" + i] = i;
    assert(f(o), (n / 8) * 28);
    assert(o.p0, (n / 8) * 28);
    o.p0 = 0;
    const p = Object.create(o);
    p.p7 = 100;
    assert(f(p), (n / 8) * (21 + 100));
    assert(Object.hasOwn(p, "p0"), true);

    let buf = bjson.write(std.evalScript(";" + parts.join("\n"), { compile_only: true }),
                          bjson.WRITE_OBJ_BYTECODE);
    const g = std.evalScript(bjson.read(buf, 0, buf.byteLength, bjson.READ_OBJ_BYTECODE),
                             { eval_function: true });
    o.p0 = 0;
    assert(g(o), (n / 8) * 28);
}

test_own_property_add_delete();
test_prototype_chain();
test_prototype_replacement();
test_accessors();
test_put_field();
test_property_add();
test_arrays();
test_shape_aliasing();
test_proxy();
test_polymorphic();
test_two_shapes();
test_primitive_receiver();
test_local_receiver();
test_dictionary_mode();
test_large_objects();
test_class_instances();
test_gc();
test_bytecode_roundtrip();
test_many_sites();
test_object_literal();
