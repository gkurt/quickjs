# Benchmarks

Scripts to measure the engine. They run under `qjs` itself, so nothing but a
Release build is needed.

| Script | Measures |
|---|---|
| `runtime.js` | micro benchmarks of the runtime hot paths: interpreter, objects, arrays, strings, Map/Set, JSON, regular expressions |
| `instructions.js` | instructions executed per operation by the `runtime.js` benchmarks, counted with cachegrind |
| `compare.js` | compares two sets of `runtime.js` and `instructions.js` results, or summarizes repeated runs |
| `octane.js` | runs the [Octane 2.0](https://github.com/chromium/octane) suite, with the peak memory of each suite |
| `upstream.js` | compares two sets of `octane.js` and `tests/microbench.js` results |
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

## Counting instructions

Times move by tens of percent between runs of the same binary on a busy
machine. The number of instructions a benchmark executes does not: it is
the same on every run to a few parts per million, so it tells a change of
the code apart from noise. It does not see what the time does see, a
changed memory access pattern or branch behaviour, so the two complement
each other.

`instructions.js` runs every benchmark under [cachegrind](https://valgrind.org/)
twice, once with its iteration count and once with none; both runs start
the engine and warm the benchmark up the same way, so the difference is the
cost of the iterations alone. It needs `valgrind` in the path and takes a
few seconds per benchmark; `--jobs N` runs N processes at a time, which
does not affect the counts.

```sh
build/qjs bench/instructions.js build-head/qjs                 # calibrates ~20 ms per benchmark
build/qjs bench/instructions.js --json base-instr.json build-base/qjs
build/qjs bench/instructions.js --iterations-from base-instr.json --json head-instr.json build-head/qjs
build/qjs bench/compare.js base-1.json,base-instr.json head-1.json,head-instr.json
```

`--iterations-from` takes the iteration counts from a result file of
`runtime.js` or `instructions.js` so that two builds do exactly the same
work: the count per operation depends a little on the iteration count and
on the heap layout for the benchmarks that allocate, so only runs with the
same counts and the same arguments are comparable, which is how the script
runs them. `compare.js` picks the
instruction counts up from any file in the lists and adds them to the
table, with their own threshold (`--instructions-threshold`, 1% by default:
the count is deterministic, so a small change is meaningful). Rows are
ordered by the instruction change when it is available and by the time
change otherwise.

## Continuous integration

`.github/workflows/bench.yml` runs the comparison above for every pull
request that touches C sources, the build files or the benchmarks. It builds
the PR head and its merge base, benchmarks both in alternation three times,
counts the instructions of both once and posts the table as a comment on the
pull request, updated in place on later pushes, and to the job summary. The
result files are kept as a workflow artifact. On pushes to the default
branch only the head is measured and the results are archived, so a history
is available.

Hosted runners are shared machines: single-digit changes of the times are
usually noise. A real change shows up in the instruction count, consistently
across related benchmarks, or as a large shift in one of them. A changed
time with an unchanged instruction count is noise or a code placement
effect. Re-run the job when in doubt, and reproduce locally before drawing
conclusions.

## Comparing against upstream

`.github/workflows/bench-upstream.yml` measures this fork against upstream
quickjs-ng: weekly, on pushes to the default branch, and on demand from the
Actions tab, where the upstream repository, the ref (`master` by default) and
the number of runs can be chosen. It builds both, runs three suites on both
in alternation and writes one report to the job summary, with the result
files in a workflow artifact:

- `runtime.js`, whose script the upstream binary runs as well, and the
  instruction counts of `instructions.js`, compared by `compare.js`;
- `tests/microbench.js` of upstream, the benchmarks upstream measures itself
  with, so a suite this repository did not write;
- Octane, larger programs whose score reflects real applications better than
  any micro benchmark, together with the peak resident memory of each suite.

The last two are compared by `upstream.js`, which takes the median of the
runs rather than the best one: `tests/microbench.js` calibrates its
iteration count on every run and some of its benchmarks cost more per
operation with more iterations, so a single run can land far off in either
direction. The same comparison can be run locally:

```sh
git fetch https://github.com/quickjs-ng/quickjs master
git worktree add ../upstream FETCH_HEAD
git clone https://github.com/chromium/octane ../octane
make -C ../upstream && make BUILD_DIR=build-fork
top=$PWD upstream=$PWD/../upstream/build/qjs fork=$PWD/build-fork/qjs
for side in upstream fork; do
    ${!side} bench/octane.js --json $side-octane.json ../octane
    (cd $(mktemp -d) && ${!side} $top/../upstream/tests/microbench.js &&
     mv microbench-new.txt $top/$side-microbench.json)
done
build-fork/qjs bench/upstream.js --octane upstream-octane.json fork-octane.json \
    --microbench upstream-microbench.json fork-microbench.json
```

`octane.js` runs every suite in a separate process started with the same
binary, which is how it reports the peak memory of each (from
`/proc/self/status`, so on Linux only) and keeps a suite that crashes from
taking the others down. `--list` prints the suites and naming some of them
runs only those.

## Adding a benchmark

Add a `bench(group, name, fn)` call to `runtime.js`. `fn(n)` must perform
`n` iterations of the operation being measured and should return something
that depends on the work done, so the interpreter cannot skip it. Keep the
setup inside the function cheap compared to the loop, or amortize it over
the iterations as the array and JSON benchmarks do. Benchmarks that guard a
specific optimization should exercise the path that was slow before it, so
a regression is visible: `map_int_keys` uses sequential integer keys,
`case_ascii` pure ASCII strings and `parse_ints` an array of integers.
