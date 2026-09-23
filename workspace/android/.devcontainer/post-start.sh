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
command -v gopls >/dev/null 2>&1 || go install golang.org/x/tools/gopls@latest || true
rustup component add rust-analyzer >/dev/null 2>&1 || true

# ast-grep: 構造パターンでの検索・置換。Grep の正規表現と serena の名前検索の隙間
# (形で探す・一括書き換え) を埋める。cocoon plugin に無いので npm。同梱の短縮名 `sg` は
# 非推奨 (警告が出る) かつ Debian の /usr/bin/sg と同名なので、指示側は ast-grep で統一。非 fatal。
npm install -g @ast-grep/cli@0.45.3 || true

# WSLg の X0 を :50 として見せる (エイリアス studio が使う)。/tmp/.X11-unix ごと mount すると
# WSLg 側が read-only なので VS Code が自分の X 転送ソケットを作れなくなる。
if [ -S /mnt/wslg/.X11-unix/X0 ]; then
  mkdir -p /tmp/.X11-unix
  ln -sfn /mnt/wslg/.X11-unix/X0 /tmp/.X11-unix/X50
fi

# Android Studio は永続ボリュームの ~/.local に版ごとのディレクトリで入れ、未導入の版だけ取得する。
# ピンを書き換えれば新版を並べて入れ、リンクを張り替える。&& 連鎖なのは `|| true` 配下では
# set -e が効かず、検証失敗でも展開まで進んでしまうため。非 fatal。
as_ver=2026.1.4.8
as_url=https://edgedl.me.gvt1.com/android/studio/ide-zips/$as_ver/android-studio-quail4-patch1-linux.tar.gz
as_sha=25c97ca6c6b505f2a20bff962dfd28718327f61e25b09a9bc915f1dae7b1e534
as_dir=~/.local/opt/android-studio-$as_ver
if [ ! -d "$as_dir" ]; then
  mkdir -p ~/.local/opt
  as_tmp=$(mktemp -d ~/.local/opt/.android-studio.XXXXXX)
  curl -fsSL -o "$as_tmp/a.tar.gz" "$as_url" &&
    echo "$as_sha  $as_tmp/a.tar.gz" | sha256sum -c --quiet &&
    tar -xzf "$as_tmp/a.tar.gz" -C "$as_tmp" &&
    mv "$as_tmp/android-studio" "$as_dir" || true
  rm -rf "$as_tmp"
fi
if [ -d "$as_dir" ]; then ln -sfn "$as_dir" ~/.local/opt/android-studio; fi

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
