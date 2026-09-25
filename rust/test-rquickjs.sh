#!/bin/sh
#
# Runs the test suite of rquickjs (https://github.com/DelSkayn/rquickjs), at the
# version rust/rquickjs-sys is taken from, with rust/rquickjs-sys, so with the
# engine of this repository, in place of its own rquickjs-sys.
#
#   rust/test-rquickjs.sh                        # cargo test --features full-async
#   rust/test-rquickjs.sh --features full-async,disable-typescript
#
# Arguments replace the default cargo test arguments. Environment: WORK, the
# work directory (rust/build).

set -eu

# the tag of the rquickjs release rust/rquickjs-sys is taken from; its version
# is the one of rust/rquickjs-sys/Cargo.toml
RQUICKJS_REPOSITORY=https://github.com/DelSkayn/rquickjs.git

here=$(cd "$(dirname "$0")" && pwd)
WORK=${WORK:-$here/build}
version=$(sed -n 's/^version = "\(.*\)"/\1/p' "$here/rquickjs-sys/Cargo.toml" | head -n 1)
upstream=$WORK/rquickjs-$version
# the path cargo reads in their Cargo.toml: Git Bash on Windows hands out
# /d/a/... paths, which cargo would read as D:\d\a\...
sys_path=$here/rquickjs-sys
if command -v cygpath >/dev/null 2>&1; then
    sys_path=$(cygpath -m "$sys_path")
fi

if [ ! -d "$upstream/.git" ]; then
    rm -rf "$upstream"
    mkdir -p "$WORK"
    git clone -q --depth 1 --branch "v$version" "$RQUICKJS_REPOSITORY" "$upstream"
fi
cd "$upstream"
git checkout -q -- Cargo.toml

# their workspace builds sys/ by path, which a [patch] cannot replace: drop it
# from the members and point the dependency at this repository's crate
sed -i.bak \
    -e '/^members = \[/,/^\]/{/^  "sys",$/d;}' \
    -e "s|^rquickjs-sys = { version = \"$version\", path = \"sys\"|rquickjs-sys = { version = \"$version\", path = \"$sys_path\"|" \
    Cargo.toml
rm -f Cargo.toml.bak
grep -q "path = \"$sys_path\"" Cargo.toml || {
    echo "could not point the rquickjs workspace at rust/rquickjs-sys" >&2
    exit 1
}

# trybuild compiles the macro tests in a directory of its own, which keeps a
# previous build of rquickjs-sys otherwise
rm -rf target/tests

if [ $# -eq 0 ]; then
    set -- --features full-async
fi
cargo test --workspace --no-fail-fast "$@"
