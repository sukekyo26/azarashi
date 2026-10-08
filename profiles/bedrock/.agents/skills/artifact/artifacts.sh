#!/bin/sh
# app/artifacts.mjs を、bun があれば bun で、なければ node で動かす。bun は起動が約 20 ms 速い。
# サーバーは起動した側の process.execPath で立つので、同じランタイムで動く
dir=$(dirname "$0")
for runtime in bun node; do
  command -v "$runtime" >/dev/null 2>&1 && exec "$runtime" "$dir/app/artifacts.mjs" "$@"
done
echo 'artifacts.sh: neither bun nor node is installed; install one of them (bun starts faster) and run again' >&2
exit 127
