#!/bin/sh
# artifacts.mjs を、bun があれば bun で、なければ node で動かす。bun は起動が約 20 ms 速い。
# サーバーは起動した側の process.execPath で立つので、同じランタイムで動く
dir=$(dirname "$0")
if command -v bun >/dev/null 2>&1; then
  exec bun "$dir/artifacts.mjs" "$@"
fi
exec node "$dir/artifacts.mjs" "$@"
