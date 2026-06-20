#!/usr/bin/env bash
# Devcontainer postStartCommand for the azarashi workspace.
#
# Referenced from cocoon.toml's [devcontainer].postStartCommand. To change the
# startup behaviour, edit this file; to change which script runs, edit cocoon.toml
# and regenerate .devcontainer/ with `cocoon gen`.
set -euo pipefail

# The context-mode plugin's git checkout omits the compiled build/ (.gitignore'd),
# so its bundled statusline renderer can only show the static "~98%" fallback. The
# npm package ships build/, giving the statusline real savings numbers. Guard on
# presence so a warm container restart skips the network round-trip; non-fatal so
# the statusline degrades gracefully when this CLI is absent.
command -v context-mode >/dev/null 2>&1 || npm install -g context-mode@1.0.162 || true

# The upstream chatgpt.com/codex/install.sh resolves a SHA256SUMS that omits the
# package asset and aborts; the npm package is the reliable path. Guard on presence
# so warm restarts skip the network round-trip; non-fatal so startup still proceeds.
command -v codex >/dev/null 2>&1 || npm install -g @openai/codex || true

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
