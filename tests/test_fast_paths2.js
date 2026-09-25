// Fast paths of the interpreter and the runtime which must keep the
// generic semantics: the computed property store, ...
import { assert, assertThrows } from "./assert.js";

function test_computed_store_order()
{
    let log = [];
    const key = (name, ret) => ({
        toString() { log.push("key " + name); return ret; }
    });
    const val = (v) => { log.push("val"); return v; };

    // object base: the key is converted before the value is evaluated
    let o = {};
    o[key("a", "p")] = val(1);
    assert(log.join(), "key a,val");
    assert(o.p, 1);

    // null and undefined base: the value first, then the key, then the error
    for (const base of [null, undefined]) {
        log = [];
        let b = base;
        assertThrows(TypeError, () => { b[key("b", "p")] = val(2); });
        assert(log.join(), "val,key b");
    }

    // the conversion of the key throws: with an object base the value
    // is not evaluated, with a null base it is
    const bad = { toString() { throw new RangeError("key"); } };
    log = [];
    assertThrows(RangeError, () => { o[bad] = val(3); });
    assert(log.join(), "");
    log = [];
    let n = null;
    assertThrows(RangeError, () => { n[bad] = val(3); });
    assert(log.join(), "val");

    // the conversion of the key modifies the variable stored
    let v = 1;
    const k = { toString() { v = 2; return "q"; } };
    o[k] = v;
    assert(o.q, 2);
    let w = 1;
    const k2 = { toString() { w = 3; return "r"; } };
    (function () { o[k2] = w; })();
    assert(o.r, 3);

    // constant values and literal keys
    const k3 = { toString() { log.push("k3"); return "s"; } };
    log = [];
    o[k3] = 5;
    assert(o.s, 5);
    o[k3] = "str";
    assert(o.s, "str");
    o[k3] = undefined;
    assert(o.s, undefined);
    assert(log.join(), "k3,k3,k3");
    o[0] = val(6);
    o["lit"] = val(7);
    o[1.5] = val(8);
    o[10n] = val(9);
    assert(o[0] + o.lit + o["1.5"] + o["10"], 6 + 7 + 8 + 9);
    const sym = Symbol("s");
    o[sym] = val(10);
    assert(o[sym], 10);

    // the value of the assignment expression and chained assignments
    const a = [];
    let i = 0;
    const r = a[i++] = a[i++] = 4;
    assert(r, 4);
    assert(a.join(), "4,4");
    assert(i, 2);

    // arrays, typed arrays and the key converted once
    let count = 0;
    const kc = { valueOf() { count++; return 1; }, toString: undefined };
    const arr = [1, 2, 3];
    arr[kc] = val(20);
    assert(arr[1], 20);
    assert(count, 1);
    const ta = new Int32Array(4);
    for (let j = 0; j < 4; j++)
        ta[j] = j * 2;
    assert(ta.join(), "0,2,4,6");
}

test_computed_store_order();
