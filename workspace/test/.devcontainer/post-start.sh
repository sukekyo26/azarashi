#!/usr/bin/env bash
# Devcontainer postStartCommand for the azarashi workspace.
#
# Referenced from cocoon.toml's [devcontainer].postStartCommand. To change the
# startup behaviour, edit this file; to change which script runs, edit cocoon.toml
# and regenerate .devcontainer/ with `cocoon gen`.
set -euo pipefail

# The upstream chatgpt.com/codex/install.sh resolves a SHA256SUMS that omits the
# package asset and aborts; the npm package is the reliable path. Always reinstall
# to pick up the latest release; non-fatal so startup still proceeds.
npm install -g @openai/codex || true

# serena / serena-hooks を PATH に置く。hooks は PreToolUse ごとに起動するので uvx の
# 都度解決では遅すぎる。uv は毎回リクワイアメントを解決し直すので、ピンを書き換えれば
# --force 無しで入れ替わる。非 fatal。
uv tool install git+https://github.com/oraios/serena@v1.7.0 || true

# Serena は言語サーバーを同梱せず PATH 上のものを起動するため、作業対象の 4 言語分を
# ここで揃える。gopls だけは未導入だと Serena が RuntimeError で止まる（他は自前で
# 取得を試みる）。go/rustup はイメージ側にあるので前提を足さない。いずれも非 fatal。
npm install -g typescript typescript-language-server pyright || true

# ast-grep: 構造パターンでの検索・置換。Grep の正規表現と serena の名前検索の隙間
# (形で探す・一括書き換え) を埋める。cocoon plugin に無いので npm。同梱の短縮名 `sg` は
# 非推奨 (警告が出る) かつ Debian の /usr/bin/sg と同名なので、指示側は ast-grep で統一。非 fatal。
npm install -g @ast-grep/cli@0.45.3 || true

cd ~/work/azarashi

# Run ./dotfiles, echo its output live, and condense the actions into one line so
# each container start shows at a glance what changed.
log=$(mktemp)
if ./dotfiles --force | tee "$log"; then rc=0; else rc=$?; fi
linked=$(grep -c '^  linked  :' "$log" || true)
merged=$(grep -c '^  merged  :' "$log" || true)
pruned=$(grep -c '^  pruned  :' "$log" || true)
rm -f "$log"
echo "dotfiles: linked ${linked}, merged ${merged}, pruned ${pruned}"
exit "$rc"
