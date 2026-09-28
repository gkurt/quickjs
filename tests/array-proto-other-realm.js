// The fast paths which add an element to an array assume a standard
// Array.prototype: its modification from another realm must be seen too
import { assert } from "./assert.js";

if (typeof $262 !== "undefined") {
    const other = $262.createRealm().global;
    // not an array: its push would run the setters
    const log = { s: "", push(v) { this.s += (this.s ? "," : "") + v; } };

    // a setter defined on Array.prototype by a function of the other realm
    other.eval(`(function (proto, log) {
        Object.defineProperty(proto, 0, {
            set(v) { log.push("set " + v); }, configurable: true
        });
    })`)(Array.prototype, log);
    let a = [];
    a[0] = 1;
    assert(log.s, "set 1");
    assert(a.length, 0);
    a = [];
    a.push(2);
    assert(log.s, "set 1,set 2");
    delete Array.prototype[0];

    // Object.prototype of this realm, modified from the other one
    log.s = "";
    other.eval(`(function (proto, log) {
        Object.defineProperty(proto, 0, {
            set(v) { log.push("oset " + v); }, configurable: true
        });
    })`)(Object.prototype, log);
    a = [];
    a[0] = 3;
    assert(log.s, "oset 3");
    delete Object.prototype[0];

    // the prototype of Array.prototype changed from the other realm
    log.s = "";
    const p = { set 0(v) { log.push("pset " + v); } };
    other.Object.setPrototypeOf(Array.prototype, p);
    a = [];
    a[0] = 4;
    assert(log.s, "pset 4");
    Object.setPrototypeOf(Array.prototype, Object.prototype);

    // an array of the other realm, whose Array.prototype is modified here
    const b = new other.Array();
    log.s = "";
    Object.defineProperty(other.Array.prototype, 0, {
        set(v) { log.push("bset " + v); }, configurable: true
    });
    b[0] = 5;
    assert(log.s, "bset 5");
    other.eval("[]")[0] = 6;
    assert(log.s, "bset 5,bset 6");

    // the Object.prototype of a realm is immutable from any realm
    let e;
    try {
        other.Object.setPrototypeOf(Object.prototype, {});
    } catch (_e) {
        e = _e;
    }
    assert(e instanceof other.TypeError);
    assert(Object.getPrototypeOf(Object.prototype), null);
}
