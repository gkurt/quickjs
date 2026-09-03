// Angle-bracket type assertions (`<T>expr`) and type-only namespaces. They
// are valid TypeScript but Node's type stripping rejects them, so they are
// kept out of test_typescript.ts, which is also run under Node. The bytecode of this
// file must match test_typescript_angle_blank.js (see test_ts_bytecode.js).
import { assert } from "./assert.js";

let n: number = 1;
let asserted = <number><unknown>"7";
assert(asserted, "7");
const olit = { b: <number>2 };
assert(olit.b, 2);
let expr: number = (n as number) + <number>n + n!;
assert(expr, 3);
let chain = { a: { b: [1] } };
assert((<{ a: { b: number[] } }>chain).a.b.length, 1);
<number>n;
assert(-<number>n, -1);
assert(<number>n + <number>n, 2);
const arr = <Array<number>>[1, 2];
assert(arr.length, 2);
const fn = <(x: number) => number>((x: number) => x + 1);
assert(fn(1), 2);

// namespaces containing only types are erased
namespace TypeOnly {
    export type A = number;
    export interface B { a: A }
    type C = A;
    interface D {}
    export declare const x: number;
    declare function f(): void;
    export namespace Inner { export type E = string; }
    namespace Inner2 {}
    ;
}
module TypeOnlyModule { export type F = 1; }
namespace Dotted.Name.Space { export type G = 2; }
export namespace ExportedNs { export type H = 3; }
