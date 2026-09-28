import { assert } from "./assert.js";

function makeAsyncIter(log) {
    let i = 0;
    return { [Symbol.asyncIterator]() { return {
        next() {
            return Promise.resolve(i < 2 ? { value: i++, done: false }
                                          : { value: undefined, done: true });
        },
        return() { log.returned++; return Promise.resolve({ done: true }); },
    }; } };
}

/* normal completion must NOT call return() */
{
    const log = { returned: 0 };
    for await (const x of makeAsyncIter(log)) {}
    assert(log.returned, 0);
}

/* break is an abrupt completion and must call return() */
{
    const log = { returned: 0 };
    for await (const x of makeAsyncIter(log)) break;
    assert(log.returned, 1);
}

/* throw is an abrupt completion and must call return() */
{
    const log = { returned: 0 };
    try {
        for await (const x of makeAsyncIter(log)) throw new Error("stop");
    } catch (e) {}
    assert(log.returned, 1);
}

/* leaving the loop via break must await the result of return() */
{
    const order = [];
    const it = { [Symbol.asyncIterator]() { let i = 0; return {
        next() { return Promise.resolve({ value: i++, done: false }); },
        return() {
            order.push("return");
            return Promise.resolve().then(() => { order.push("resolved"); return { done: true }; });
        },
    }; } };
    for await (const x of it) break;
    order.push("after");
    assert(order.join(","), "return,resolved,after");
}

/* an error of next(), of the promise it returns or of its result is not
   an abrupt completion of the loop body: return() is not called */
{
    const nexts = [
        () => { throw new Error("next"); },
        () => Promise.reject(new Error("rejected")),
        () => Promise.resolve(1),
        () => Promise.resolve({ get done() { throw new Error("done"); } }),
        () => Promise.resolve({ done: false, get value() { throw new Error("value"); } }),
    ];
    for (const next of nexts) {
        const log = { returned: 0 };
        const it = { [Symbol.asyncIterator]() {
            return { next, return() { log.returned++; return {}; } };
        } };
        let caught = false;
        try {
            for await (const x of it) {}
        } catch (e) {
            caught = true;
        }
        assert(caught, true);
        assert(log.returned, 0);
    }
}

/* the values of a sync iterator: a rejected promise closes the iterator */
{
    const log = { returned: 0 };
    const it = { [Symbol.iterator]() { return {
        next() { return { value: Promise.reject(new Error("value")), done: false }; },
        return() { log.returned++; return {}; },
    }; } };
    let caught = false;
    try {
        for await (const x of it) {}
    } catch (e) {
        caught = e.message == "value";
    }
    assert(caught, true);
    assert(log.returned, 1);
}
