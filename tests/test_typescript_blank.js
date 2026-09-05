// TypeScript type erasure test. Only "erasable" syntax is used, i.e. the
// subset accepted by Node's --experimental-strip-types and tsc's
// erasableSyntaxOnly: everything here must run after the types are removed.
import { assert, assertThrows,               } from "./assert.js";
                                                               
import { helper, Box, constObj,            } from "./fixture_ts_module.ts";
import defaultHelper from "./fixture_ts_module.ts";

/* ---------------- type-level declarations (erased) ---------------- */

                         
                                
                                            
                                                    
                              
            
              
               
                  
                           
                         
                      
                       
  
                   
                  
                          
                                                   
                                                            
                                                                 
                                                                          
                                                                                                          
                                       
                                           
                                       
                                                         
                            
                                                      
                                
                                                                                              
                                                     
                                                       

                                        
                                                                                          
                                                                                   
                                                     

                                    
                                                      
                                               
                                         
                                                                          
                                                              
                                                        
                                                   
                                                             
                                 
                                  

                      
                                                               
                                       
                                            
                                              
                                                   
export          class ExportedAbstract {                     }

/* ---------------- variables ---------------- */

let n         = 1;
let definite         ;
definite = "x";
assert(definite, "x");
const [t0, t1]                   = [1, "a"];
assert(t0 + t1, "1a");
const { x: px, y: py }        = { x: 3, y: 4 };
assert(px * py, 12);
let u                    ;
assert(u, undefined);
let arr                       = [[1]];
assert(arr[0][0], 1);
let fnv                                  = (a, b) => {};
let obj                = { a: 1 }                        ;
assert(obj.a, 1);
let lit = { k: "v" }         ;
assert(lit.k, "v");
let anyv = 5                     ;
assert(anyv, 5);
const conf = { a: 1 }                                 ;
assert(conf.a, 1);
var v1        , v2         = "s", v3         ;
assert(v2, "s");
const arrN                  = [1];
assert(arrN [0], 1);
assert(arrN .length, 1);
assert(arrN  [0] , 1);
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
function typeFn(type        , declare        )         { return type + declare; }
assert(typeFn(1, "a"), "1a");

/* ---------------- functions ---------------- */

function add(a        , b         = 2, ...rest          )         {
    return a + b + rest.length;
}
assert(add(1), 3);
assert(add(1, 1, 5, 6), 4);
function opt(a         )                     { return a; }
assert(opt(), undefined);
assert(opt(3), 3);
function withThis(             dx        )         { return this.x + dx; }
assert(withThis.call({ x: 1, y: 2 }, 5), 6);
assert(withThis.length, 1);
function withThisOnly(           ) { return this.y; }
assert(withThisOnly.call({ x: 1, y: 2 }), 2);
assert(withThisOnly.length, 0);
                                     
                                     
function overload(x     )      { return x; }
assert(overload("s"), "s");
assert(overload(2), 2);
// type parameters spanning lines: the function starts where the '<' was,
// as in the equivalent JavaScript (checked by the bytecode oracle)
const multiLineGeneric = (
      
  x   )    => x;
assert(multiLineGeneric(7), 7);
class MultiLineGeneric {
    id(
          
      x   )    { return x; }
    static make(
          
      x   )    { return x; }
}
assert(new MultiLineGeneric().id("m"), "m");
assert(MultiLineGeneric.make(8), 8);
function generic                         (x   , y    )    { return x; }
assert(generic({ a: 1 }).a, 1);
assert(generic               ({ a: 2 }).a, 2);
assert(generic                       ({ a: 3 }, "s").a, 3);
async function af   (x   )             { return x; }
function* gen   (x   )                              { yield x; }
assert([...gen(7)][0], 7);
async function* agen   (x   )                    { yield x; }
function pred(x         )              { return typeof x === "string"; }
assert(pred("s"), true);
function asrt(x         )                      {}
function asrt2(x         )            {}
function constTP         (x   )    { return x; }
assert(constTP(4), 4);
function destr({ a, b = 2 }                           , [c]          )         {
    return a + b + c;
}
assert(destr({ a: 1 }, [3]), 6);
function destrOpt({ a }                = { a: 9 })         { return a; }
assert(destrOpt(), 9);
function retObj()                           { return { a: 1, b: "x" }; }
assert(retObj().b, "x");
function retFn()                        { return x => x + 1; }
assert(retFn()(1), 2);
function retUnion()                  { return 1; }
function trailing(a        , b        ,)       {}
assert(trailing.length, 2);

/* ---------------- arrow functions ---------------- */

const a1 = (x        )         => x * 2;
assert(a1(2), 4);
const a2 =     (x   )    => x;
assert(a2("q"), "q");
assert(a2        ("w"), "w");
const a3 =                    (x   ) => x;
assert(a3(1), 1);
const a4 = async (x        )                  => x;
const a5 = async    (x   )             => x;
const a6 = ({ a, b }                          )         => a + b;
assert(a6({ a: 1, b: 2 }), 3);
const a7 = ([a, b]                  ) => a + b;
assert(a7([1, 2]), 3);
const a8 = (x         , ...rest          ) => rest.length;
assert(a8(1, 2, 3), 2);
const a9 = ()       => {};
assert(a9(), undefined);
const a10 = (x         = 5) => x;
assert(a10(), 5);
const a11 = (x        )                => ({ y: x });
assert(a11(1).y, 1);
const a12 = (x        )                        => y => x + y;
assert(a12(1)(2), 3);
const a13 = (f                       ) => f(1);
assert(a13(x => x + 1), 2);
const a14 =       (x   , y   )         => [x, y];
assert(a14(1, "a")[1], "a");
const a15 = async     (x   ) => x;
const a16 = (x        ) => (y        )         => x + y;
assert(a16(1)(2), 3);
async function useAsync()                {
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
const tern2 = flag ? (x        ) => x : (y        ) => y + 1;
assert(tern2(1), 1);
const tern3 = flag ? (x        ) => x * 2 : (y        )         => y;
assert(tern3(2), 4);
// an arrow function with a return type in the true branch is accepted when
// the ':' of the conditional follows its body (TypeScript rule)
const tern4 = flag ? (x        )         => x * 2 : (y        )         => y;
assert(tern4(2), 4);
const tern5 = flag ? (x        )                => ({ v: x }) : () => ({ v: 0 });
assert(tern5(3).v, 3);
const tern6 = flag ? (x        )         => x ? 1 : 2 : (y        ) => y;
assert(tern6(0), 2);
const tern7 = flag ? (x        )         => `${x}:${x}` : () => "";
assert(tern7(1), "1:1");
const tern8 = flag ? (x        )         => { return x + 1; } : () => 0;
assert(tern8(1), 2);
const tern9 = flag ? (x        )         => [x, x][1] : () => 0;
assert(tern9(4), 4);
const tern10 = flag ? (x        )         => f1        (x) : () => 0;
assert(tern10(5), 5);
// ... but `a ? (b) : c => d` stays a conditional expression
const bVal = 7;
const tern11 = flag ? (bVal) : (c        ) => c;
assert(tern11, 7);
assert(flag ? ((x        ) => x)(3) : 0, 3);
assert(flag ? (1 + 1) : (2 + 2), 2);
assert(!flag ? (1) : n ? (2) : (3), 2);

/* ---------------- generics vs. comparisons ---------------- */

const m = new Map                       ();
m.set("a", [1]);
assert(m.get("a") [0], 1);
const s = new Set        ([1, 2]);
assert(s.size, 2);
let nested                                   = new Map                             ();
assert(nested.size, 0);
let deep                              = [];
let deeper = new Array                             ();
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
function tag(strings                      , ...vals          ) {
    return strings.raw.join("|") + vals.join(",");
}
assert(tag        `a${1}b`, "a|b1");
assert(tag`c${2}d`, "c|d2");
function f1   (x   ) { return x; }
assert(f1        (3), 3);
assert(f1               ([4])[0], 4);
assert(f1                                  (new Map()).size, 0);
assert(f1                  ([1, "a"])[1], "a");
assert(f1               ({ a: 5 }).a, 5);
assert(f1            (() => {})(), undefined);
assert(f1          (6), 6);
assert(f1       ("lit"), "lit");
assert(f1                 (7), 7);
assert(f1        (3) + 1, 4);
const objm = { f1, n: 1 };
assert(objm.f1        (8), 8);
assert(objm.f1        (8) < objm.n + 100, true);
class WithGeneric { id   (x   )    { return x; } static sid   (x   )    { return x; } }
assert(new WithGeneric().id        (9), 9);
assert(WithGeneric.sid        (10), 10);
assert(new Box        (1).value, 1);
assert(new Box               ([2]).value[0], 2);
assert(new Box        (1).map        (v => "" + v).value, "1");
// `a < b` where b is followed by `>`, but not a call: comparison
let lt1 = 2, gt1 = 1;
assert(lt1 < gt1, false);
assert((lt1 < gt1) > 0, false);
// instantiation expressions
const boxedCtor = Box        ;
assert(new boxedCtor(3).value, 3);

/* ---------------- classes ---------------- */

         class Shape {
                            
                       name        ;
    static count         = 0;
                             
            secret         ;
           label         ;
    constructor(name        ) { this.name = name; Shape.count++; }
    describe()         { return `${this.name}:${this.area()}`; }
                         
                                     
    static make(kind         )        { return new Square(kind === "big" ? 4 : 1); }
    get n()         { return this.name; }
    set n(v        ) {}
                           
                                 
                            
    optionalField         ;
    generic   (x   )    { return x; }
                                           
                                  
                                                           
                                                    
             ro         = 1;
    static          sro         = 2;
            static ps         = 3;
    static getPs()         { return Shape.ps; }
    #priv         = 1;
    getPriv()         { return this.#priv; }
    static #sp         = 2;
    static getSp()         { return Shape.#sp; }
    async am   (x   )             { return x; }
    *gm   (x   )               { yield x; }
    static async sam()                  { return 1; }
}

class Square extends Shape                          {
    x = 0; y = 0; z = 0; id = "sq";
    side        ;
    constructor(public_side        , private_flag          = false) {
        super("square");
        this.side = public_side;
    }
             area()         { return this.side ** 2; }
    abstractWithArgs(a        , b         )       {}
              get abstractGetter()         { return 1; }
    static          make()        { return new Square(2); }
                    describe()         { return "sq " + super.describe(); }
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
                                   
    [(keyEvals++, "field")]         ;
    [(keyEvals++, "m")]()         { return 1; }
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
assert(sq.generic        ("g"), "g");
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

class GBox                        extends Array                           {
    value    ;
    static from2                  (x   )          { const b = new GBox   (); b.value = x; return b; }
}
assert(GBox.from2({ q: 1 }).value .q, 1);
class Base    { v   ; constructor(v   ) { this.v = v; } }
class Derived extends Base         { }
assert(new Derived(5).v, 5);
class DerivedExpr extends (Base                                   )         { }
assert(new DerivedExpr(6).v, 6);
const ClassExpr = class                     { x = 1; y = 2; v    ; };
assert(new ClassExpr        ().x, 1);
const AnonAbstract = class { m()       {} };
assert(typeof new AnonAbstract().m, "function");
class Overloads {
                  
                           
    constructor(x         ) { this.x = x ?? -1; }
    x        ;
              
                       
    m(x         )       {}
                     
    static s(x         )       {}
    static after = 1;
    afterField = 2;
                                
    ["comp" + "uted"](x         )         { return 3; }
                                         
    static ["static" + "Comp"](x         )         { return 4; }
                              
    async am(x         )                {}
                            
    *g(x         )                    {}
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
            _v         = 1;
    get v()         { return this._v; }
    set v(x        ) { this._v = x; }
    static get sv()         { return "s"; }
    ;                          
              static override_         ;
           static          PSR = 5;
                     pr         = "pr";
    getPr() { return this.pr; }
    "quoted"         ;
                       
    42         ;
                
    async         ;
    get         ;
    set         ;
    static         ;
    readonly         ;
    declare         ;
    type         ;
    static static         = 1;
    static          readonly = 2;
    declare         ;
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
    a          = 1;
    b         ;
    static c          = "c";
    d                     = undefined;
}
const fk = new FieldsKeepInit();
assert(fk.a, 1);
assert("b" in fk, true);
assert(FieldsKeepInit.c, "c");
assert("d" in fk, true);

/* ---------------- object literals ---------------- */

const olit = {
    m   (x   )    { return x; },
    n()         { return 1; },
    get g()         { return 2; },
    set g(v        ) {},
    async am   (x   )             { return x; },
    *gm   (x   )               { yield x; },
    async *agm   (x   )                    { yield x; },
    a: 1          ,
    b: 2          ,
    c: (x        )         => x,
    ["comp" + "uted"]   (x   )    { return x; },
    type: 1,
    declare: 2,
    as: 3,
};
assert(olit.m        ("m"), "m");
assert(olit.n(), 1);
assert(olit.g, 2);
assert(await olit.am(3), 3);
assert([...olit.gm(4)][0], 4);
assert(olit.a + olit.b, 3);
assert(olit.c(5), 5);
assert(olit.computed        (6), 6);
assert(olit.type + olit.declare + olit.as, 6);

/* ---------------- statements ---------------- */

try {
    throw 1;
} catch (e         ) {
    assert(e, 1);
}
try {
    throw { message: "m" };
} catch ({ message }     ) {
    assert(message, "m");
}
try {
    throw 2;
} catch (e) {
    assert(e, 2);
}
for (let k         = 0; k < 2; k++) {}
for (const [a, b] of [[1, 2]]                      ) assert(a + b, 3);
outer: for (let k = 0; k < 2; k++) { for (;;) { break outer; } }
label: {
    break label;
}
{
    ;                   
    ;                            
    const inner        = 1;
    assert(inner, 1);
}
if (flag) {
    ;                    
}
switch (n) {
    case 1: {
        ;                  
        break;
    }
}
function scoped()         {
                      
                       
                                       
    let x                = 1;
    return x;
}
assert(scoped(), 1);
let expr         = (n          ) + (n                     ) + n ;
assert(expr, 3);
let chain = { a: { b: [1] } };
assert(chain .a .b [0] , 1);
assert(chain?.a?.b?.[0] , 1);
assert((chain                          ).a.b.length, 1);
assert((chain                 ) === chain, true);
assert(typeof (n           ), "number");
let notAs = 1;
let asVal = notAs
as = 2;
assert(asVal, 1);
assert(as, 2);
assert([1, 2].map((x        )         => x * 2)[1], 4);
assert([1, 2].map        (x => x * 2)[1], 4);
assert([1, 2].reduce        ((acc, x) => acc + x, 0), 3);
assert(((x        ) => x)(1), 1);
assert((    (x   ) => x)(1), 1);
assert((function    (x   )    { return x; })(1), 1);
assert((async    (x   ) => x) instanceof Function, true);
const fnExpr = function named   (x   )    { return x; };
assert(fnExpr(1), 1);
const genExpr = function*    (x   ) { yield x; };
assert([...genExpr(1)][0], 1);
// `!` at the start of a statement after an expression is a new statement
let negTarget = 0
!negTarget
assert(negTarget, 0);
// yield / await with type assertions
function* yg()                    { const r = (yield 1)          ; return r; }
const ygi = yg();
ygi.next();
assert(ygi.next(5).value, 5);
// unary operators combine with assertions
assert(-(1          ), -1);
assert(!(false           ), true);
assert(typeof (1          ), "number");
assert(void (1          ), undefined);
// `in` inside type args in for-init
for (let z = f1               ({ a: 1 }).a; z < 2; z++) {}
// comma expression with generics
assert((f1        (1), f1        (2)), 2);
// new with type args and no parens
const noParens = new Map                ;
assert(noParens.size, 0);
// generics on tagged member call
assert(objm.f1        `x`.raw[0], "x");

/* ---------------- imports ---------------- */

assert(helper(1), 2);
assert(defaultHelper(2), 3);
assert(constObj.B, 1);

/* ---------------- non-erasable syntax is rejected ---------------- */

async function expectSyntaxError(path        , needle        )                {
    let err          = null;
    try {
        await import(path);
    } catch (e) {
        err = e;
    }
    assert(err instanceof SyntaxError, true, path);
    assert((err         ).message.includes(needle), true, path + ": " + (err         ).message);
}
// (the needles also match Node's messages, so this file can run under Node)
await expectSyntaxError("./fixture_ts_enum.ts", "enum");
await expectSyntaxError("./fixture_ts_namespace.ts", "namespace");
await expectSyntaxError("./fixture_ts_param_props.ts", "parameter propert");
await expectSyntaxError("./fixture_ts_import_alias.ts", "import");
await expectSyntaxError("./fixture_ts_export_assign.ts", "export");

/* ---------------- exports ---------------- */

export const exportedValue         = 42;
export let exportedLet        ;
export function exportedFn   (x   )    { return x; }
                                                    
export function exportedOverload(x     )      { return x; }
export class ExportedClass                     { x = 1; y = 2; v    ; }
export { n as exportedN,                                       };
                                                        
                                                            
export default class DefaultClass    { v     }
