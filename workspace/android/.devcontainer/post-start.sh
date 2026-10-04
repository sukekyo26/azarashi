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
command -v gopls >/dev/null 2>&1 || go install golang.org/x/tools/gopls@latest || true
rustup component add rust-analyzer >/dev/null 2>&1 || true

# ast-grep: 構造パターンでの検索・置換。Grep の正規表現と LSP の名前検索の隙間
# (形で探す・一括書き換え) を埋める。cocoon plugin に無いので npm。同梱の短縮名 `sg` は
# 非推奨 (警告が出る) かつ Debian の /usr/bin/sg と同名なので、指示側は ast-grep で統一。非 fatal。
npm install -g @ast-grep/cli@0.45.3 || true

# Docker の seccomp で Chrome のサンドボックスが namespace を作れず即落ちするため、--no-sandbox 版を既定にする。
# Docker ソケットがあるので、このブラウザは Google サインイン等の信頼できるページ専用にする。
if command -v google-chrome-stable >/dev/null 2>&1; then
	mkdir -p ~/.local/share/applications
	cat >~/.local/share/applications/google-chrome-no-sandbox.desktop <<'EOF'
[Desktop Entry]
Type=Application
Name=Google Chrome (no sandbox)
Exec=/usr/bin/google-chrome-stable --no-sandbox --no-first-run %U
MimeType=text/html;x-scheme-handler/http;x-scheme-handler/https;
NoDisplay=true
EOF
	xdg-mime default google-chrome-no-sandbox.desktop text/html x-scheme-handler/http x-scheme-handler/https || true
fi

cd ~/work/azarashi

# Run ./dotfiles, echo its output live, and condense the actions into one line so
# each container start shows at a glance what changed.
log=$(mktemp)
if ./dotfiles | tee "$log"; then rc=0; else rc=$?; fi
linked=$(grep -c '^  linked  :' "$log" || true)
merged=$(grep -c '^  merged  :' "$log" || true)
pruned=$(grep -c '^  pruned  :' "$log" || true)
rm -f "$log"
echo "dotfiles: linked ${linked}, merged ${merged}, pruned ${pruned}"
exit "$rc"
