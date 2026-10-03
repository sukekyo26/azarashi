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

# Claude Code の公式 LSP プラグインは言語サーバーを同梱せず PATH 上のものを起動するため、
# 作業対象の言語分をここで揃える。go/rustup はイメージ側にあるので前提を足さない。いずれも非 fatal。
npm install -g typescript typescript-language-server pyright || true

# ast-grep: 構造パターンでの検索・置換。Grep の正規表現と LSP の名前検索の隙間
# (形で探す・一括書き換え) を埋める。cocoon plugin に無いので npm。同梱の短縮名 `sg` は
# 非推奨 (警告が出る) かつ Debian の /usr/bin/sg と同名なので、指示側は ast-grep で統一。非 fatal。
npm install -g @ast-grep/cli@0.45.3 || true

# playwright-cli は MCP を使わずブラウザを操作する CLI (Bash 経由なのでツール定義を
# 食わない)。playwright 本体も入れるのは `playwright install` でブラウザを落とすため。
# 2 つは同じ Chromium リビジョンを要求する版に揃えること (ずれると 2 回落とす)。
# ブラウザは cocoon.toml [volumes] の ~/.cache/ms-playwright に永続化され、
# `playwright install` は既にあればスキップする。共有ライブラリは [apt] 側。非 fatal。
npm install -g playwright@1.63.0 @playwright/cli@0.1.19 || true
playwright install chromium || true

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
