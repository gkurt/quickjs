#!/bin/sh
#
# Builds the npm package in this directory: the TypeScript wrapper and the
# extensions of quickjs-wasi (https://github.com/vercel-labs/quickjs-wasi) at
# a pinned commit, with the engine of this repository in place of the
# quickjs-ng release quickjs-wasi ships with.
#
# The patches in patches/ are applied to that commit with `git am`, in order:
# the changes this package makes to the wrapper and the C interface layer,
# with their tests. A change of the patches (or of the pinned commit) checks
# the commit out again and reapplies them. To change the series, commit on
# top of the patched checkout in $WORK/quickjs-wasi (a detached HEAD), then
# replace the patch files with
#
#   rm npm/quickjs-wasi/patches/*.patch
#   git -C npm/quickjs-wasi/build/quickjs-wasi format-patch --no-signature \
#       --zero-commit -o "$PWD/npm/quickjs-wasi/patches" <QUICKJS_WASI_SHA>
#
# The package is staged in $WORK/pkg, ready for `npm pack` or `npm publish`.
# Used by .github/workflows/quickjs-wasi.yml and npm-publish.yml; it runs the
# same locally:
#
#   npm/quickjs-wasi/build.sh               # build and stage
#   RUN_TESTS=1 npm/quickjs-wasi/build.sh   # also run the quickjs-wasi tests
#
# Environment:
#   OPT         optimization level of the engine (-O2)
#   TYPESCRIPT  0 to build without TypeScript type erasure (1)
#   RUN_TESTS   1 to run the quickjs-wasi test suite on the build (0)
#   WASI_SDK    wasi-sdk installation, downloaded into $WORK if unset
#   WORK        work directory (npm/quickjs-wasi/build)
#
# Needs git, curl, node and corepack (for the pnpm version quickjs-wasi pins).

set -eu

# bump both together: the wasi-sdk version is the one quickjs-wasi's
# Makefile requires (WASI_SDK_VERSION_REQUIRED)
QUICKJS_WASI_REPOSITORY=https://github.com/vercel-labs/quickjs-wasi.git
QUICKJS_WASI_SHA=5a7a0eeda87c99542f8cf3095b6d61ecfa755977 # v3.6.2
WASI_SDK_VERSION=32

OPT=${OPT:--O2}
TYPESCRIPT=${TYPESCRIPT:-1}
RUN_TESTS=${RUN_TESTS:-0}

here=$(cd "$(dirname "$0")" && pwd)
root=$(cd "$here/../.." && pwd)
WORK=${WORK:-$here/build}
upstream=$WORK/quickjs-wasi
pkg=$WORK/pkg
mkdir -p "$WORK"

if [ -z "${WASI_SDK:-}" ]; then
    WASI_SDK=$WORK/wasi-sdk-$WASI_SDK_VERSION
    if [ ! -f "$WASI_SDK/VERSION" ]; then
        case "$(uname -s)-$(uname -m)" in
            Linux-x86_64) platform=x86_64-linux ;;
            Linux-aarch64) platform=arm64-linux ;;
            Darwin-arm64) platform=arm64-macos ;;
            Darwin-x86_64) platform=x86_64-macos ;;
            *) echo "unsupported platform: $(uname -s)-$(uname -m)" >&2; exit 1 ;;
        esac
        echo "downloading wasi-sdk $WASI_SDK_VERSION"
        rm -rf "$WASI_SDK"
        mkdir -p "$WASI_SDK"
        curl -fsSL "https://github.com/WebAssembly/wasi-sdk/releases/download/wasi-sdk-$WASI_SDK_VERSION/wasi-sdk-$WASI_SDK_VERSION.0-$platform.tar.gz" |
            tar xz -C "$WASI_SDK" --strip-components=1
    fi
fi

# fetch only the pinned commit; its quickjs-ng submodule is not needed (the
# engine comes from this repository, the extensions' dependencies are vendored)
if ! git -C "$upstream" cat-file -e "$QUICKJS_WASI_SHA^{commit}" 2>/dev/null; then
    rm -rf "$upstream"
    git init -q "$upstream"
    git -C "$upstream" fetch -q --depth 1 "$QUICKJS_WASI_REPOSITORY" "$QUICKJS_WASI_SHA"
fi

# apply the patches, unless the checkout has this series applied already
# (the stamp records the commit and a hash of the patches)
patches=$(ls "$here"/patches/*.patch 2>/dev/null || true)
# shellcheck disable=SC2086 # one word per patch file
series="$QUICKJS_WASI_SHA $(cat /dev/null $patches | git hash-object --stdin)"
stamp=$upstream/.git/quickjs-wasi-patches
if [ "$(cat "$stamp" 2>/dev/null || true)" != "$series" ]; then
    rm -f "$stamp"
    git -C "$upstream" am --abort >/dev/null 2>&1 || true # a failed earlier run
    git -C "$upstream" checkout -q -f --detach "$QUICKJS_WASI_SHA"
    git -C "$upstream" clean -q -fd
    if [ -n "$patches" ]; then
        # shellcheck disable=SC2086
        git -C "$upstream" -c user.name=build -c user.email=build@localhost \
            am -q --committer-date-is-author-date $patches
    fi
    echo "$series" > "$stamp"
fi

cd "$upstream"
corepack enable >/dev/null 2>&1 || true
corepack pnpm install --frozen-lockfile

# what the engine is, for vm.versions and package.json: the commit of this
# repository, and the hash of the engine's sources, which rust/rquickjs-sys
# computes too (rquickjs_sys::ENGINE_SOURCE_HASH)
engine_sha=$(git -C "$root" rev-parse HEAD 2>/dev/null || echo unknown)
engine_hash=$(node "$root/scripts/engine-source-hash.mjs" "$root")

# the Makefile has no hook for extra defines of the engine, so they ride on
# CC; the interface layer takes the engine's identity in INTERFACE_CFLAGS
# (added by the patches). Clean first because a change of OPT, TYPESCRIPT or
# the engine's identity is invisible to make
#
# NDEBUG makes this a release build. Without it the engine enables its
# debugging dumps (ENABLE_DUMPS), and the interpreter then tests
# rt->dump_flags before it executes every opcode: a loop of global variable
# accesses took 1.2-1.3x as long in Chromium as with the same engine built
# with NDEBUG, which is as fast as quickjs-emscripten
cc="$WASI_SDK/bin/clang -DNDEBUG"
if [ "$TYPESCRIPT" = 0 ]; then
    cc="$cc -DQJS_DISABLE_TYPESCRIPT"
fi
make clean >/dev/null
jobs=$(getconf _NPROCESSORS_ONLN 2>/dev/null || echo 4)
make -j "$jobs" WASI_SDK="$WASI_SDK" QJS_DIR="$root" OPT="$OPT" CC="$cc" \
    INTERFACE_CFLAGS="-DQJS_ENGINE_COMMIT=\\\"$engine_sha\\\" -DQJS_ENGINE_SOURCE_HASH=\\\"$engine_hash\\\""
corepack pnpm run build:ts

if [ "$RUN_TESTS" = 1 ]; then
    corepack pnpm exec vitest run
fi

# stage the package: upstream's published files under our name and version
rm -rf "$pkg"
mkdir -p "$pkg"
cp -R dist quickjs.wasm "$pkg/"
for so in extensions/*/*.so; do
    mkdir -p "$pkg/$(dirname "$so")"
    cp "$so" "$pkg/$so"
done
cp "$here/README.md" "$pkg/"
{
    echo "The TypeScript wrapper, the C interface layer and the extensions come"
    echo "from quickjs-wasi, $QUICKJS_WASI_REPOSITORY"
    echo "(commit $QUICKJS_WASI_SHA):"
    echo
    cat LICENSE
    echo
    echo "---------------------------------------------------------------------"
    echo
    echo "The JavaScript engine comes from gkurt/quickjs, a fork of QuickJS-NG:"
    echo
    cat "$root/LICENSE"
} > "$pkg/LICENSE"

OVERLAY="$here/package.json" UPSTREAM="$upstream/package.json" OUT="$pkg/package.json" \
ENGINE_SHA="$engine_sha" ENGINE_HASH="$engine_hash" WRAPPER_SHA="$QUICKJS_WASI_SHA" \
PATCHES="$(for p in $patches; do basename "$p"; done)" OPT="$OPT" TYPESCRIPT="$TYPESCRIPT" \
node -e '
const fs = require("fs");
const e = process.env;
const up = JSON.parse(fs.readFileSync(e.UPSTREAM, "utf8"));
const ours = JSON.parse(fs.readFileSync(e.OVERLAY, "utf8"));
const pick = ["type", "main", "types", "exports", "files", "engines", "sideEffects"];
const out = { ...ours };
for (const k of pick) if (k in up) out[k] = up[k];
// what the package was built from, for bug reports and snapshot compatibility
out.build = {
    "quickjs-wasi": {
        version: up.version,
        commit: e.WRAPPER_SHA,
        patches: e.PATCHES.split("\n").filter(Boolean),
    },
    engine: {
        repository: "https://github.com/gkurt/quickjs",
        commit: e.ENGINE_SHA,
        sourceHash: e.ENGINE_HASH,
    },
    opt: e.OPT,
    typescript: e.TYPESCRIPT !== "0",
};
fs.writeFileSync(e.OUT, JSON.stringify(out, null, 2) + "\n");
'

echo "staged $(node -p "require('$pkg/package.json').name")@$(node -p "require('$pkg/package.json').version") in $pkg"
