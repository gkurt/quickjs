// Compiling a module, even with compile_only, resolves its static imports
// through the module loader. To compile files of a corpus in isolation
// the benchmarks register an empty module for every specifier a file
// imports, under the name the import resolves to, before compiling it:
// resolution then finds the stub and the dependencies are not loaded,
// parsed or measured.
import * as std from "qjs:std";

// what QuickJS's default module name normalization (see
// js_default_module_normalize_name in quickjs.c) turns `name`, imported
// from `base`, into
export function normalizeModuleName(base, name) {
    if (name[0] !== ".")
        return name;
    const i = base.lastIndexOf("/");
    let filename = i >= 0 ? base.slice(0, i) : "", r = name;
    for (;;) {
        if (r.startsWith("./")) {
            r = r.slice(2);
        } else if (r.startsWith("../")) {
            if (filename === "")
                break;
            const p = filename.lastIndexOf("/");
            const last = p < 0 ? filename : filename.slice(p + 1);
            if (last === "." || last === "..")
                break;
            filename = p < 0 ? "" : filename.slice(0, p);
            r = r.slice(3);
        } else {
            break;
        }
    }
    return (filename !== "" ? filename + "/" : "") + r;
}

// the stubs, kept alive so that they stay registered
const stubs = new Map();

// registers an empty module for every static import of `source`, a module
// compiled under `filename`. Type-only imports, strings and comments that
// look like imports get a harmless extra stub.
export function stubImports(filename, source) {
    const re = /\b(?:import|export)\b[^'";]*?\bfrom\s*["']([^"']+)["']|\bimport\s*["']([^"']+)["']/g;
    for (const m of source.matchAll(re)) {
        const name = normalizeModuleName(filename, m[1] ?? m[2]);
        if (!stubs.has(name))
            stubs.set(name, std.evalScript("", { compile_only: true, compile_module: true, filename: name }));
    }
}
