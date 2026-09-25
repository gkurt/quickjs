#!/bin/sh
#
# Packs the package staged by build.sh, installs the tarball in an empty
# project and runs smoke-test.mjs there under Node.js, and Bun if installed.
#
#   npm/quickjs-wasi/smoke-test.sh
#
# Environment: WORK as for build.sh, TYPESCRIPT=0 when the build has no
# TypeScript.

set -eu

here=$(cd "$(dirname "$0")" && pwd)
WORK=${WORK:-$here/build}
pkg=$WORK/pkg
app=$WORK/smoke

tarball=$(cd "$pkg" && npm pack --silent --pack-destination "$WORK" | tail -n 1)
rm -rf "$app"
mkdir -p "$app"
cp "$here/smoke-test.mjs" "$app/"
cd "$app"
echo '{ "private": true, "type": "module" }' > package.json
npm install --silent --no-audit --no-fund "$WORK/$tarball"

export PKG_NAME=$(node -p "require('$pkg/package.json').name")
export EXPECT_TYPESCRIPT=${TYPESCRIPT:-1}
node smoke-test.mjs
if command -v bun >/dev/null 2>&1; then
    bun smoke-test.mjs
fi
