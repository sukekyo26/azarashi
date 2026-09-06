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

# Serena は言語サーバーを同梱せず PATH 上のものを起動するため、作業対象の 4 言語分を
# ここで揃える。gopls だけは未導入だと Serena が RuntimeError で止まる（他は自前で
# 取得を試みる）。go/rustup はイメージ側にあるので前提を足さない。いずれも非 fatal。
npm install -g typescript typescript-language-server pyright || true
command -v gopls >/dev/null 2>&1 || go install golang.org/x/tools/gopls@latest || true
rustup component add rust-analyzer >/dev/null 2>&1 || true

cd ~/work/azarashi

# Run install.sh, echo its output live, and condense the actions into one line so
# each container start shows at a glance what changed.
log=$(mktemp)
if ./install.sh | tee "$log"; then rc=0; else rc=$?; fi
linked=$(grep -c '^  linked  :' "$log" || true)
merged=$(grep -c '^  merged  :' "$log" || true)
pruned=$(grep -c '^  pruned  :' "$log" || true)
rm -f "$log"
echo "dotfiles: linked ${linked}, merged ${merged}, pruned ${pruned}"
exit "$rc"
