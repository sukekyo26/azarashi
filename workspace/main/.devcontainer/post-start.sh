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

cd ~/work/azarashi
./install.sh
