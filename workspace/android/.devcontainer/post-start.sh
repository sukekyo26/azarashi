#!/usr/bin/env bash
# Devcontainer postStartCommand for the azarashi workspace.
#
# Referenced from cocoon.toml's [devcontainer].postStartCommand. To change the
# startup behaviour, edit this file; to change which script runs, edit cocoon.toml
# and regenerate .devcontainer/ with `cocoon gen`.
set -euo pipefail

# The context-mode plugin's git checkout omits the compiled build/ (.gitignore'd),
# so its bundled statusline renderer can only show the static "~98%" fallback until
# the plugin is upgraded in place. `cli.bundle.mjs upgrade` pulls the latest release,
# rebuilds, updates the npm global and rewires the hooks in one step — the same thing
# the /context-mode:ctx-upgrade skill runs, which otherwise has to be invoked by hand.
# Fall back to the npm package when the plugin checkout is absent; both are non-fatal
# so the statusline just degrades gracefully.
ctx_plugin="$HOME/.claude/plugins/marketplaces/context-mode"
if [ -f "$ctx_plugin/cli.bundle.mjs" ]; then
  node "$ctx_plugin/cli.bundle.mjs" upgrade || true
elif [ -f "$ctx_plugin/build/cli.js" ]; then
  node "$ctx_plugin/build/cli.js" upgrade || true
else
  npm install -g context-mode || true
fi

# The upstream chatgpt.com/codex/install.sh resolves a SHA256SUMS that omits the
# package asset and aborts; the npm package is the reliable path. Always reinstall
# to pick up the latest release; non-fatal so startup still proceeds.
npm install -g @openai/codex || true

# Claude Code の typescript-lsp プラグインは PATH 上の typescript-language-server を
# 起動するだけなので、本体はここで npm global に入れる。非 fatal。
npm install -g typescript typescript-language-server || true

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
