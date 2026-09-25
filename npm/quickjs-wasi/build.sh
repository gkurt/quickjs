#!/bin/sh
#
# Builds the npm package in this directory: the TypeScript wrapper and the
# extensions of quickjs-wasi (https://github.com/vercel-labs/quickjs-wasi) at
# a pinned commit, with the engine of this repository in place of the
# quickjs-ng release quickjs-wasi ships with.
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
if [ "$(git -C "$upstream" rev-parse HEAD 2>/dev/null)" != "$QUICKJS_WASI_SHA" ]; then
    rm -rf "$upstream"
    git init -q "$upstream"
    git -C "$upstream" fetch -q --depth 1 "$QUICKJS_WASI_REPOSITORY" "$QUICKJS_WASI_SHA"
    git -C "$upstream" checkout -q FETCH_HEAD
fi

cd "$upstream"
corepack enable >/dev/null 2>&1 || true
corepack pnpm install --frozen-lockfile

# the Makefile has no hook for extra defines, so they ride on CC; clean first
# because a change of OPT or TYPESCRIPT is invisible to make
cc="$WASI_SDK/bin/clang"
if [ "$TYPESCRIPT" = 0 ]; then
    cc="$cc -DQJS_DISABLE_TYPESCRIPT"
fi
make clean >/dev/null
jobs=$(getconf _NPROCESSORS_ONLN 2>/dev/null || echo 4)
make -j "$jobs" WASI_SDK="$WASI_SDK" QJS_DIR="$root" OPT="$OPT" CC="$cc"
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

engine_sha=$(git -C "$root" rev-parse HEAD 2>/dev/null || echo unknown)
OVERLAY="$here/package.json" UPSTREAM="$upstream/package.json" OUT="$pkg/package.json" \
ENGINE_SHA="$engine_sha" WRAPPER_SHA="$QUICKJS_WASI_SHA" OPT="$OPT" TYPESCRIPT="$TYPESCRIPT" \
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
    "quickjs-wasi": { version: up.version, commit: e.WRAPPER_SHA },
    engine: { repository: "https://github.com/gkurt/quickjs", commit: e.ENGINE_SHA },
    opt: e.OPT,
    typescript: e.TYPESCRIPT !== "0",
};
fs.writeFileSync(e.OUT, JSON.stringify(out, null, 2) + "\n");
'

echo "staged $(node -p "require('$pkg/package.json').name")@$(node -p "require('$pkg/package.json').version") in $pkg"
