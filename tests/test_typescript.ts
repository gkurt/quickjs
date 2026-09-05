// TypeScript type erasure test. Only "erasable" syntax is used, i.e. the
// subset accepted by Node's --experimental-strip-types and tsc's
// erasableSyntaxOnly: everything here must run after the types are removed.
import { assert, assertThrows, type Whatever } from "./assert.js";
import type { NotReal } from "./this_module_does_not_exist.js";
import { helper, Box, constObj, type Thing } from "./fixture_ts_module.ts";
import defaultHelper from "./fixture_ts_module.ts";

/* ---------------- type-level declarations (erased) ---------------- */

type Pair<A, B> = [A, B];
type Fn = (x: number) => string;
type Cond<T> = T extends string ? "s" : "o";
type Mapped<T> = { readonly [K in keyof T]?: T[K] };
type Tpl = `prefix-${string}`;
type Obj = {
    a: number;
    b?: string,
    c: () => void;
    [key: string]: unknown;
    new (x: number): Obj;
    (y: string): void;
    method<T>(x: T): T;
};
type K = keyof Obj;
type V = Obj["a"];
type TO = typeof constObj;
type Inf<T> = T extends Array<infer U> ? U : never;
type InfC<T> = T extends infer U extends string ? U : never;
type InfT<T> = T extends `${infer U extends string}` ? U : never;
type InfF<T> = T extends () => infer R extends string ? 1 : 0 ? R : never;
type InfN<T> = T extends infer U extends string ? (U extends infer V extends `${number}` ? V : 0) : never;
type U2 = ((x: number) => void) | null;
type Ctor = new (...args: any[]) => object;
type ACtor = abstract new () => object;
type Tuple = [a: number, b?: string, ...rest: boolean[]];
type Ro = readonly number[];
type Nested = Map<string, Map<string, Array<number>>>;
type Q = Pair<1, "x">["length"];
type Neg = -1 | 1n | true | null | undefined | void | never | unknown | any | object | symbol;
type Getters = { get x(): number; set x(v: number) };
type Imported = import("./fixture_ts_module.ts").Thing;

interface Point { x: number; y: number }
interface Point3 extends Point { z: number; move?(dx: number): void; readonly id: string }
interface Callable { (x: number): string; new (x: number): Callable; prop: number }
interface Generic<T extends object = {}> { value: T }

declare const declaredConst: number;
declare let declaredLet: string, declaredLet2: string;
declare function declaredFn(x: number): string;
declare function declaredFn2<T>(x: T): T;
declare class DeclaredClass { foo(): void; bar: number; static s: string }
declare abstract class DeclaredAbstract { abstract m(): void }
declare module "some-module" { export const q: number; }
declare global { interface Window { foo: string } }
declare namespace NS { const x: number; function f(): void; }
declare const sym: unique symbol;
declare enum DeclaredEnum { A, B }

export type { Point };
export type { Thing as ReThing } from "./fixture_ts_module.ts";
export interface Exported { a: number }
export type ExportedAlias = number | string;
export declare const exportedDeclared: number;
export declare function exportedDeclaredFn(): void;
export abstract class ExportedAbstract { abstract m(): void; }

/* ---------------- variables ---------------- */

let n: number = 1;
let definite!: string;
definite = "x";
assert(definite, "x");
const [t0, t1]: [number, string] = [1, "a"];
assert(t0 + t1, "1a");
const { x: px, y: py }: Point = { x: 3, y: 4 };
assert(px * py, 12);
let u: string | undefined;
assert(u, undefined);
let arr: Array<Array<number>> = [[1]];
assert(arr[0][0], 1);
let fnv: (a: number, b?: string) => void = (a, b) => {};
let obj: { a: number } = { a: 1 } satisfies { a: number };
assert(obj.a, 1);
let lit = { k: "v" } as const;
assert(lit.k, "v");
let anyv = 5 as unknown as string;
assert(anyv, 5);
const conf = { a: 1 } satisfies Record<string, number>;
assert(conf.a, 1);
var v1: number, v2: string = "s", v3: boolean;
assert(v2, "s");
const arrN: number[] | null = [1];
assert(arrN![0], 1);
assert(arrN!.length, 1);
assert(arrN!![0]!, 1);
let asi = 1
!asi
assert(asi, 1);

// contextual keywords are still usable as identifiers
const type = 1;
type;
assert(type, 1);
let declare = 2, abstract = 3, namespace = 4, module = 5, readonly = 6, satisfies = 7;
declare++; abstract++; namespace++; module++; readonly++; satisfies++;
assert(declare + abstract + namespace + module + readonly + satisfies, 33);
let as = 8, is = 9, infer = 10, keyof = 11, out = 12, override = 13;
assert(as + is + infer + keyof + out + override, 63);
const o2 = { type: 1, declare: 2, abstract: 3, as: 4, is: 5 };
assert(o2.type + o2.declare + o2.abstract + o2.as + o2.is, 15);
function typeFn(type: number, declare: string): string { return type + declare; }
assert(typeFn(1, "a"), "1a");

/* ---------------- functions ---------------- */

function add(a: number, b: number = 2, ...rest: number[]): number {
    return a + b + rest.length;
}
assert(add(1), 3);
assert(add(1, 1, 5, 6), 4);
function opt(a?: number): number | undefined { return a; }
assert(opt(), undefined);
assert(opt(3), 3);
function withThis(this: Point, dx: number): number { return this.x + dx; }
assert(withThis.call({ x: 1, y: 2 }, 5), 6);
assert(withThis.length, 1);
function withThisOnly(this: Point) { return this.y; }
assert(withThisOnly.call({ x: 1, y: 2 }), 2);
assert(withThisOnly.length, 0);
function overload(x: string): string;
function overload(x: number): number;
function overload(x: any): any { return x; }
assert(overload("s"), "s");
assert(overload(2), 2);
function generic<T extends object, U = T>(x: T, y?: U): T { return x; }
assert(generic({ a: 1 }).a, 1);
assert(generic<{ a: number }>({ a: 2 }).a, 2);
assert(generic<{ a: number }, string>({ a: 3 }, "s").a, 3);
async function af<T>(x: T): Promise<T> { return x; }
function* gen<T>(x: T): Generator<T, void, unknown> { yield x; }
assert([...gen(7)][0], 7);
async function* agen<T>(x: T): AsyncGenerator<T> { yield x; }
function pred(x: unknown): x is string { return typeof x === "string"; }
assert(pred("s"), true);
function asrt(x: unknown): asserts x is string {}
function asrt2(x: unknown): asserts x {}
function constTP<const T>(x: T): T { return x; }
assert(constTP(4), 4);
function destr({ a, b = 2 }: { a: number; b?: number }, [c]: number[]): number {
    return a + b + c;
}
assert(destr({ a: 1 }, [3]), 6);
function destrOpt({ a }: { a: number } = { a: 9 }): number { return a; }
assert(destrOpt(), 9);
function retObj(): { a: number; b: string } { return { a: 1, b: "x" }; }
assert(retObj().b, "x");
function retFn(): (x: number) => number { return x => x + 1; }
assert(retFn()(1), 2);
function retUnion(): string | number { return 1; }
function trailing(a: number, b: string,): void {}
assert(trailing.length, 2);

/* ---------------- arrow functions ---------------- */

const a1 = (x: number): number => x * 2;
assert(a1(2), 4);
const a2 = <T,>(x: T): T => x;
assert(a2("q"), "q");
assert(a2<string>("w"), "w");
const a3 = <T extends unknown>(x: T) => x;
assert(a3(1), 1);
const a4 = async (x: number): Promise<number> => x;
const a5 = async <T>(x: T): Promise<T> => x;
const a6 = ({ a, b }: { a: number; b: number }): number => a + b;
assert(a6({ a: 1, b: 2 }), 3);
const a7 = ([a, b]: [number, number]) => a + b;
assert(a7([1, 2]), 3);
const a8 = (x?: number, ...rest: number[]) => rest.length;
assert(a8(1, 2, 3), 2);
const a9 = (): void => {};
assert(a9(), undefined);
const a10 = (x: number = 5) => x;
assert(a10(), 5);
const a11 = (x: number): { y: number } => ({ y: x });
assert(a11(1).y, 1);
const a12 = (x: number): (y: number) => number => y => x + y;
assert(a12(1)(2), 3);
const a13 = (f: (x: number) => number) => f(1);
assert(a13(x => x + 1), 2);
const a14 = <T, U>(x: T, y: U): [T, U] => [x, y];
assert(a14(1, "a")[1], "a");
const a15 = async <T,>(x: T) => x;
const a16 = (x: number) => (y: number): number => x + y;
assert(a16(1)(2), 3);
async function useAsync(): Promise<void> {
    assert(await af(1), 1);
    assert(await a4(2), 2);
    assert(await a5(3), 3);
    assert(await a15(4), 4);
    for await (const v of agen(5)) assert(v, 5);
}
await useAsync();

// arrows and parenthesized expressions in conditionals
const flag = true;
assert(flag ? (1) : 2, 1);
assert(flag ? (n) : 0, 1);
assert(flag ? (n) : (0), 1);
const tern2 = flag ? (x: number) => x : (y: number) => y + 1;
assert(tern2(1), 1);
const tern3 = flag ? (x: number) => x * 2 : (y: number): number => y;
assert(tern3(2), 4);
// an arrow function with a return type in the true branch is accepted when
// the ':' of the conditional follows its body (TypeScript rule)
const tern4 = flag ? (x: number): number => x * 2 : (y: number): number => y;
assert(tern4(2), 4);
const tern5 = flag ? (x: number): { v: number } => ({ v: x }) : () => ({ v: 0 });
assert(tern5(3).v, 3);
const tern6 = flag ? (x: number): number => x ? 1 : 2 : (y: number) => y;
assert(tern6(0), 2);
const tern7 = flag ? (x: number): string => `${x}:${x}` : () => "";
assert(tern7(1), "1:1");
const tern8 = flag ? (x: number): number => { return x + 1; } : () => 0;
assert(tern8(1), 2);
const tern9 = flag ? (x: number): number => [x, x][1] : () => 0;
assert(tern9(4), 4);
const tern10 = flag ? (x: number): number => f1<number>(x) : () => 0;
assert(tern10(5), 5);
// ... but `a ? (b) : c => d` stays a conditional expression
const bVal = 7;
const tern11 = flag ? (bVal) : (c: number) => c;
assert(tern11, 7);
assert(flag ? ((x: number) => x)(3) : 0, 3);
assert(flag ? (1 + 1) : (2 + 2), 2);
assert(!flag ? (1) : n ? (2) : (3), 2);

/* ---------------- generics vs. comparisons ---------------- */

const m = new Map<string, Array<number>>();
m.set("a", [1]);
assert(m.get("a")![0], 1);
const s = new Set<number>([1, 2]);
assert(s.size, 2);
let nested: Map<string, Map<string, number>> = new Map<string, Map<string, number>>();
assert(nested.size, 0);
let deep: Array<Array<Array<number>>> = [];
let deeper = new Array<Array<Array<Array<number>>>>();
assert(deeper.length, 0);
let cmp1 = 1 < 2, cmp2 = 3 > 2, cmp3 = 1 < 2 && 3 > 2;
assert(cmp1 && cmp2 && cmp3, true);
let i = 0, j = 5;
assert(i < j, true);
assert(i < j && j > i, true);
assert(i < j == true, true);
assert((i < j) === true, true);
assert(j > i > 0, true);
let sh = 8 >> 1;
assert(sh, 4);
let sh2 = 8 >>> 1;
assert(sh2, 4);
sh >>= 1;
assert(sh, 2);
sh2 >>>= 1;
assert(sh2, 2);
assert(1 <= 2 && 2 >= 2, true);
function tag(strings: TemplateStringsArray, ...vals: number[]) {
    return strings.raw.join("|") + vals.join(",");
}
assert(tag<number>`a${1}b`, "a|b1");
assert(tag`c${2}d`, "c|d2");
function f1<T>(x: T) { return x; }
assert(f1<number>(3), 3);
assert(f1<Array<number>>([4])[0], 4);
assert(f1<Map<string, Map<string, number>>>(new Map()).size, 0);
assert(f1<[number, string]>([1, "a"])[1], "a");
assert(f1<{ a: number }>({ a: 5 }).a, 5);
assert(f1<() => void>(() => {})(), undefined);
assert(f1<typeof n>(6), 6);
assert(f1<"lit">("lit"), "lit");
assert(f1<string | number>(7), 7);
assert(f1<number>(3) + 1, 4);
const objm = { f1, n: 1 };
assert(objm.f1<number>(8), 8);
assert(objm.f1<number>(8) < objm.n + 100, true);
class WithGeneric { id<T>(x: T): T { return x; } static sid<T>(x: T): T { return x; } }
assert(new WithGeneric().id<number>(9), 9);
assert(WithGeneric.sid<number>(10), 10);
assert(new Box<number>(1).value, 1);
assert(new Box<Array<number>>([2]).value[0], 2);
assert(new Box<number>(1).map<string>(v => "" + v).value, "1");
// `a < b` where b is followed by `>`, but not a call: comparison
let lt1 = 2, gt1 = 1;
assert(lt1 < gt1, false);
assert((lt1 < gt1) > 0, false);
// instantiation expressions
const boxedCtor = Box<number>;
assert(new boxedCtor(3).value, 3);

/* ---------------- classes ---------------- */

abstract class Shape {
    abstract area(): number;
    protected readonly name: string;
    static count: number = 0;
    declare declared: number;
    private secret?: string;
    public label!: string;
    constructor(name: string) { this.name = name; Shape.count++; }
    describe(): string { return `${this.name}:${this.area()}`; }
    static make(): Shape;
    static make(kind: string): Shape;
    static make(kind?: string): Shape { return new Square(kind === "big" ? 4 : 1); }
    get n(): string { return this.name; }
    set n(v: string) {}
    [key: string]: unknown;
    static [key: number]: string;
    optionalMethod?(): void;
    optionalField?: number;
    generic<T>(x: T): T { return x; }
    [Symbol.iterator]?(): Iterator<number>;
    ["computed" + "Sig"]?(): void;
    abstract abstractWithArgs(a: number, b?: string): void;
    protected abstract get abstractGetter(): number;
    readonly ro: number = 1;
    static readonly sro: number = 2;
    private static ps: number = 3;
    static getPs(): number { return Shape.ps; }
    #priv: number = 1;
    getPriv(): number { return this.#priv; }
    static #sp: number = 2;
    static getSp(): number { return Shape.#sp; }
    async am<T>(x: T): Promise<T> { return x; }
    *gm<T>(x: T): Generator<T> { yield x; }
    static async sam(): Promise<number> { return 1; }
}

class Square extends Shape implements Point, Point3 {
    x = 0; y = 0; z = 0; id = "sq";
    side: number;
    constructor(public_side: number, private_flag: boolean = false) {
        super("square");
        this.side = public_side;
    }
    override area(): number { return this.side ** 2; }
    abstractWithArgs(a: number, b?: string): void {}
    protected get abstractGetter(): number { return 1; }
    static override make(): Shape { return new Square(2); }
    public override describe(): string { return "sq " + super.describe(); }
    static {
        Square.count = 100;
    }
}

const sq = new Square(3);
assert(sq.area(), 9);
assert(sq.describe(), "sq square:9");
assert(sq.n, "square");
assert(Shape.count, 1);
// signatures without a body are dropped without evaluating their computed key
let keyEvals = 0;
class ComputedSig {
    [(keyEvals++, "sig")]?(): void;
    [(keyEvals++, "field")]?: number;
    [(keyEvals++, "m")](): number { return 1; }
}
assert(keyEvals, 2);
assert(new ComputedSig().m(), 1);
assert("field" in new ComputedSig(), true);
assert("sig" in new ComputedSig(), false);
assert(Square.count, 100);
assert(Shape.make().area(), 1);
assert(Shape.make("big").area(), 16);
assert(Square.make().area(), 4);
assert(sq.getPriv(), 1);
assert(Shape.getSp(), 2);
assert(Shape.getPs(), 3);
assert(sq.ro, 1);
assert(Shape.sro, 2);
assert(sq.generic<string>("g"), "g");
assert("declared" in sq, false);
assert("optionalMethod" in sq, false);
// optional / definite fields are kept (only the marker is erased)
assert("optionalField" in sq, true);
assert(Symbol.iterator in sq, false);
assert("computedSig" in sq, false);
assert("secret" in sq, true);
assert("label" in sq, true);
assert([...sq.gm(1)][0], 1);
assert(await sq.am(2), 2);
assert(await Shape.sam(), 1);
assert(Object.getOwnPropertyNames(Shape.prototype).sort().join(),
       "am,constructor,describe,generic,getPriv,gm,n");
assert(Object.getOwnPropertyNames(Square.prototype).sort().join(),
       "abstractGetter,abstractWithArgs,area,constructor,describe");

class GBox<T extends object = {}> extends Array<T> implements Iterable<T> {
    value?: T;
    static from2<U extends object>(x: U): GBox<U> { const b = new GBox<U>(); b.value = x; return b; }
}
assert(GBox.from2({ q: 1 }).value!.q, 1);
class Base<T> { v: T; constructor(v: T) { this.v = v; } }
class Derived extends Base<number> { }
assert(new Derived(5).v, 5);
class DerivedExpr extends (Base as new (v: number) => Base<number>)<number> { }
assert(new DerivedExpr(6).v, 6);
const ClassExpr = class<T> implements Point { x = 1; y = 2; v?: T; };
assert(new ClassExpr<number>().x, 1);
const AnonAbstract = class { m(): void {} };
assert(typeof new AnonAbstract().m, "function");
class Overloads {
    constructor();
    constructor(x: number);
    constructor(x?: number) { this.x = x ?? -1; }
    x: number;
    m(): void;
    m(x: number): void;
    m(x?: number): void {}
    static s(): void;
    static s(x?: number): void {}
    static after = 1;
    afterField = 2;
    ["comp" + "uted"](): number;
    ["comp" + "uted"](x?: number): number { return 3; }
    static ["static" + "Comp"](): number;
    static ["static" + "Comp"](x?: number): number { return 4; }
    async am(): Promise<void>;
    async am(x?: number): Promise<void> {}
    *g(): Generator<number>;
    *g(x?: number): Generator<number> {}
}
const ov = new Overloads(7);
assert(ov.x, 7);
assert(new Overloads().x, -1);
assert(ov.computed(), 3);
assert(Overloads.staticComp(), 4);
assert(Overloads.after, 1);
assert(ov.afterField, 2);
assert(Object.getOwnPropertyNames(Overloads.prototype).sort().join(),
       "am,computed,constructor,g,m");
class Accessors {
    private _v: number = 1;
    get v(): number { return this._v; }
    set v(x: number) { this._v = x; }
    static get sv(): string { return "s"; }
    declare readonly d: number;
    protected static override_?: string;
    public static readonly PSR = 5;
    private readonly pr: string = "pr";
    getPr() { return this.pr; }
    "quoted"?: number;
    "quotedM"?(): void;
    42?: number;
    43?(): void;
    async?: number;
    get?: number;
    set?: number;
    static?: number;
    readonly?: number;
    declare?: number;
    type?: number;
    static static: number = 1;
    static readonly readonly = 2;
    declare!: number;
}
const acc = new Accessors();
acc.v = 5;
assert(acc.v, 5);
assert(Accessors.sv, "s");
assert(Accessors.PSR, 5);
assert(acc.getPr(), "pr");
assert(Accessors.static, 1);
assert(Accessors.readonly, 2);
assert("quoted" in acc, true);
assert("quotedM" in acc, false);
assert("42" in acc, true);
assert("43" in acc, false);
assert("async" in acc, true);
assert("get" in acc, true);
assert("type" in acc, true);
assert("declare" in acc, true);
assert("d" in acc, false);
class FieldsKeepInit {
    a?: number = 1;
    b!: number;
    static c?: string = "c";
    d: number | undefined = undefined;
}
const fk = new FieldsKeepInit();
assert(fk.a, 1);
assert("b" in fk, true);
assert(FieldsKeepInit.c, "c");
assert("d" in fk, true);

/* ---------------- object literals ---------------- */

const olit = {
    m<T>(x: T): T { return x; },
    n(): number { return 1; },
    get g(): number { return 2; },
    set g(v: number) {},
    async am<T>(x: T): Promise<T> { return x; },
    *gm<T>(x: T): Generator<T> { yield x; },
    async *agm<T>(x: T): AsyncGenerator<T> { yield x; },
    a: 1 as number,
    b: 2 as number,
    c: (x: number): number => x,
    ["comp" + "uted"]<T>(x: T): T { return x; },
    type: 1,
    declare: 2,
    as: 3,
};
assert(olit.m<string>("m"), "m");
assert(olit.n(), 1);
assert(olit.g, 2);
assert(await olit.am(3), 3);
assert([...olit.gm(4)][0], 4);
assert(olit.a + olit.b, 3);
assert(olit.c(5), 5);
assert(olit.computed<number>(6), 6);
assert(olit.type + olit.declare + olit.as, 6);

/* ---------------- statements ---------------- */

try {
    throw 1;
} catch (e: unknown) {
    assert(e, 1);
}
try {
    throw { message: "m" };
} catch ({ message }: any) {
    assert(message, "m");
}
try {
    throw 2;
} catch (e) {
    assert(e, 2);
}
for (let k: number = 0; k < 2; k++) {}
for (const [a, b] of [[1, 2]] as [number, number][]) assert(a + b, 3);
outer: for (let k = 0; k < 2; k++) { for (;;) { break outer; } }
label: {
    break label;
}
{
    type Inner = number;
    interface InnerI { a: Inner }
    const inner: Inner = 1;
    assert(inner, 1);
}
if (flag) {
    type Branch = string;
}
switch (n) {
    case 1: {
        type Case = number;
        break;
    }
}
function scoped(): number {
    type Local<T> = T;
    interface LocalI {}
    declare const local: Local<number>;
    let x: Local<number> = 1;
    return x;
}
assert(scoped(), 1);
let expr: number = (n as number) + (n as unknown as number) + n!;
assert(expr, 3);
let chain = { a: { b: [1] } };
assert(chain!.a!.b![0]!, 1);
assert(chain?.a?.b?.[0]!, 1);
assert((chain as { a: { b: number[] } }).a.b.length, 1);
assert((chain satisfies object) === chain, true);
assert(typeof (n as unknown), "number");
let notAs = 1;
let asVal = notAs
as = 2;
assert(asVal, 1);
assert(as, 2);
assert([1, 2].map((x: number): number => x * 2)[1], 4);
assert([1, 2].map<number>(x => x * 2)[1], 4);
assert([1, 2].reduce<number>((acc, x) => acc + x, 0), 3);
assert(((x: number) => x)(1), 1);
assert((<T,>(x: T) => x)(1), 1);
assert((function <T>(x: T): T { return x; })(1), 1);
assert((async <T>(x: T) => x) instanceof Function, true);
const fnExpr = function named<T>(x: T): T { return x; };
assert(fnExpr(1), 1);
const genExpr = function* <T>(x: T) { yield x; };
assert([...genExpr(1)][0], 1);
// `!` at the start of a statement after an expression is a new statement
let negTarget = 0
!negTarget
assert(negTarget, 0);
// yield / await with type assertions
function* yg(): Generator<number> { const r = (yield 1) as number; return r; }
const ygi = yg();
ygi.next();
assert(ygi.next(5).value, 5);
// unary operators combine with assertions
assert(-(1 as number), -1);
assert(!(false as boolean), true);
assert(typeof (1 as number), "number");
assert(void (1 as number), undefined);
// `in` inside type args in for-init
for (let z = f1<{ a: number }>({ a: 1 }).a; z < 2; z++) {}
// comma expression with generics
assert((f1<number>(1), f1<number>(2)), 2);
// new with type args and no parens
const noParens = new Map<string, number>;
assert(noParens.size, 0);
// generics on tagged member call
assert(objm.f1<string>`x`.raw[0], "x");

/* ---------------- imports ---------------- */

assert(helper(1), 2);
assert(defaultHelper(2), 3);
assert(constObj.B, 1);

/* ---------------- non-erasable syntax is rejected ---------------- */

async function expectSyntaxError(path: string, needle: string): Promise<void> {
    let err: unknown = null;
    try {
        await import(path);
    } catch (e) {
        err = e;
    }
    assert(err instanceof SyntaxError, true, path);
    assert((err as Error).message.includes(needle), true, path + ": " + (err as Error).message);
}
// (the needles also match Node's messages, so this file can run under Node)
await expectSyntaxError("./fixture_ts_enum.ts", "enum");
await expectSyntaxError("./fixture_ts_namespace.ts", "namespace");
await expectSyntaxError("./fixture_ts_param_props.ts", "parameter propert");
await expectSyntaxError("./fixture_ts_import_alias.ts", "import");
await expectSyntaxError("./fixture_ts_export_assign.ts", "export");

/* ---------------- exports ---------------- */

export const exportedValue: number = 42;
export let exportedLet: string;
export function exportedFn<T>(x: T): T { return x; }
export function exportedOverload(x: string): string;
export function exportedOverload(x: any): any { return x; }
export class ExportedClass<T> implements Point { x = 1; y = 2; v?: T; }
export { n as exportedN, type Point as PointAgain, type Point3 };
export default function DefaultClass(x: string): string;
export default async function DefaultClass(): Promise<void>;
export default class DefaultClass<T> { v?: T }
