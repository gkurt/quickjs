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
test_local_receiver();
test_dictionary_mode();
test_class_instances();
test_gc();
test_bytecode_roundtrip();
test_many_sites();
test_object_literal();
