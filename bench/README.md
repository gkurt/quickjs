# Benchmarks

Scripts to measure the engine. They run under `qjs` itself, so nothing but a
Release build is needed.

| Script | Measures |
|---|---|
| `runtime.js` | micro benchmarks of the runtime hot paths: interpreter, objects, arrays, strings, Map/Set, JSON, regular expressions |
| `compare.js` | compares two sets of `runtime.js` results, or summarizes repeated runs |
| `ts_parse_bench.js` | compile-time cost of TypeScript type erasure on a corpus |
| `ts_parse_depth.js` | parser behaviour on deeply nested TypeScript |

## Running the runtime benchmarks

```sh
make bench                              # all benchmarks
make bench BENCH_ARGS="map json"        # only names or groups matching a filter
build/qjs bench/runtime.js --list       # list benchmarks
build/qjs bench/runtime.js --json out.json
```

Each benchmark is a function that performs `n` iterations of one operation.
The iteration count is calibrated so that a round lasts at least `--min-ms`
(100 ms by default), then `--rounds` rounds (5) are timed and the best one is
reported as nanoseconds per operation. The minimum is used on purpose:
interference from the rest of the machine only ever adds time, so the best
round is the closest to the cost of the code itself.

## Comparing two builds

Build the baseline and the change into different directories, run each
several times and hand the result files to `compare.js`. Alternating the two
binaries spreads the noise of the machine evenly over both sides.

```sh
make BUILD_DIR=build-base                   # e.g. from a git worktree of the base
make BUILD_DIR=build-head
for i in 1 2 3; do
    build-base/qjs bench/runtime.js --json base-$i.json
    build-head/qjs bench/runtime.js --json head-$i.json
done
build/qjs bench/compare.js base-1.json,base-2.json,base-3.json head-1.json,head-2.json,head-3.json
```

`compare.js` keeps the best time per benchmark from each comma separated
list, prints one row per benchmark with the relative change (positive means
slower) and a summary with the geometric mean of the change. `--markdown`
prints a GitHub table, `--threshold` sets the percentage below which a change
counts as noise (5 by default) and `--fail-on-regression` makes it exit
non-zero if anything got slower than that, for use in scripts.

## Continuous integration

`.github/workflows/bench.yml` runs the comparison above for every pull
request that touches C sources, the build files or the benchmarks. It builds
the PR head and its merge base, benchmarks both in alternation three times and
posts the table as a comment on the pull request, updated in place on later
pushes, and to the job summary. The result files are kept as a workflow
artifact. On pushes to the default branch only the head is measured and the
results are archived, so a history is available.

Hosted runners are shared machines: single-digit changes are usually noise.
A real change shows up consistently across related benchmarks, or as a
large shift in one of them. Re-run the job when in doubt, and reproduce
locally before drawing conclusions.

## Adding a benchmark

Add a `bench(group, name, fn)` call to `runtime.js`. `fn(n)` must perform
`n` iterations of the operation being measured and should return something
that depends on the work done, so the interpreter cannot skip it. Keep the
setup inside the function cheap compared to the loop, or amortize it over
the iterations as the array and JSON benchmarks do. Benchmarks that guard a
specific optimization should exercise the path that was slow before it, so
a regression is visible: `map_int_keys` uses sequential integer keys,
`case_ascii` pure ASCII strings and `parse_ints` an array of integers.
