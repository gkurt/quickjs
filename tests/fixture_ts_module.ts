// TypeScript module fixture imported by test_typescript.ts
export interface Thing { n: number }
export type Id = string;
export function helper(x: number): number { return x + 1; }
export class Box<T> {
    value: T;
    constructor(v: T) { this.value = v; }
    map<U>(f: (v: T) => U): Box<U> { return new Box<U>(f(this.value)); }
}
export const constObj = { A: 0, B: 1 } as const;
export default helper;
