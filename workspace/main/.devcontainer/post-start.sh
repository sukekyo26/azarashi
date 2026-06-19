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

# RTK (rtk-ai) CLI for the redirect-tests hook's transparent compression. Install
# the binary ONLY — never `rtk init`, so RTK's own PreToolUse hook / RTK.md context
# can't compete with context-mode. The hook resolves rtk by absolute path, so no
# PATH wiring is needed. Installs to ~/.local/bin; guard on that to skip warm
# restarts. Non-fatal so a missing network degrades to the context-mode fallback.
# Pin a release with RTK_VERSION=vX.Y.Z if reproducibility matters.
[ -x "$HOME/.local/bin/rtk" ] || command -v rtk >/dev/null 2>&1 ||
  curl -fsSL https://raw.githubusercontent.com/rtk-ai/rtk/refs/heads/master/install.sh | sh || true

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
