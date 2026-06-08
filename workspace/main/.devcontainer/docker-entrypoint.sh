#!/bin/bash
# ============================================================
# docker-entrypoint.sh — host-independent UID/GID remap + image sync
# ============================================================
# The image is built with a FIXED uid/gid (1000:1000) for the container
# user, so the generated .devcontainer/ is host-independent and can be
# committed. At container start this script runs as root, remaps that user
# to match the host owner of the bind-mounted workspace, drops privileges,
# and re-execs itself as that user (linuxserver.io PUID/PGID pattern).
#
# Target uid/gid resolution order:
#   1. HOST_UID / HOST_GID environment variables (explicit override).
#   2. Owner of $COCOON_WORKSPACE — on a Linux host this is the developer.
# When neither resolves, the build-time fixed id is kept (no remap).
# ============================================================
set -eu

COCOON_USER="${COCOON_USER:-developer}"
COCOON_WORKSPACE="${COCOON_WORKSPACE:-/home/${COCOON_USER}/workspace}"

# Non-root re-entry: reached after setpriv re-execs this script as the
# target user. Sync image files into the volume-mounted ~/.local, run CMD.
if [ "$(id -u)" -ne 0 ]; then
  if [ -d "$HOME/.image-local" ]; then
    mkdir -p "$HOME/.local"
    cp -a "$HOME/.image-local/." "$HOME/.local/"
  fi
  exec "$@"
fi

# --- root path: resolve target uid/gid -------------------------------------
user_home="$(getent passwd "$COCOON_USER" | cut -d: -f6)"
: "${user_home:=/home/${COCOON_USER}}"
cur_uid="$(id -u "$COCOON_USER")"
cur_gid="$(id -g "$COCOON_USER")"

target_uid="${HOST_UID:-}"
target_gid="${HOST_GID:-}"
if [ -z "$target_uid" ] && [ -d "$COCOON_WORKSPACE" ]; then
  target_uid="$(stat -c '%u' "$COCOON_WORKSPACE" 2>/dev/null || true)"
fi
if [ -z "$target_gid" ] && [ -d "$COCOON_WORKSPACE" ]; then
  target_gid="$(stat -c '%g' "$COCOON_WORKSPACE" 2>/dev/null || true)"
fi
: "${target_uid:=$cur_uid}"
: "${target_gid:=$cur_gid}"

# Rootless Docker / macOS Docker Desktop present the workspace as root-owned
# (or already mapped). Remapping the user to uid 0 would alias it to root,
# so skip the remap entirely in that case.
if [ "$target_uid" = "0" ] || [ "$target_gid" = "0" ]; then
  target_uid="$cur_uid"
  target_gid="$cur_gid"
fi

# Apply the remap (no-op guarded). -o allows a non-unique id: the host
# uid/gid may collide with an account baked into the base image.
if [ "$target_gid" != "$cur_gid" ]; then
  groupmod -o -g "$target_gid" "$COCOON_USER"
fi
if [ "$target_uid" != "$cur_uid" ]; then
  usermod -o -u "$target_uid" "$COCOON_USER"
fi

# Re-assert ownership of the home subtree so named-volume mountpoints
# (~/.local, ~/.cocoon, plugin volumes — created root-owned by Docker) and
# image-baked dotfiles are writable. Bind-mounted paths ($COCOON_BIND_PATHS)
# are pruned: chowning a bind mount rewrites ownership on the host and is
# slow on large trees.
if [ "$target_uid" != "$cur_uid" ] || [ "$target_gid" != "$cur_gid" ]; then
  prune=()
  IFS=':' read -ra _paths <<<"${COCOON_BIND_PATHS:-$COCOON_WORKSPACE}"
  for p in "${_paths[@]}"; do
    if [ -n "$p" ]; then
      prune+=(-path "$p" -prune -o)
    fi
  done
  find "$user_home" "${prune[@]}" -exec chown -h "$target_uid:$target_gid" {} +
fi

# Docker socket group: when /var/run/docker.sock is bind-mounted, find or
# create a group with the socket's GID and add the user to it. Resolved at
# runtime so the image carries no host docker gid. Must run before the
# setpriv drop so --init-groups picks the membership up.
if [ -S /var/run/docker.sock ]; then
  sock_gid="$(stat -c '%g' /var/run/docker.sock 2>/dev/null || true)"
  if [ -n "$sock_gid" ] && [ "$sock_gid" != "0" ]; then
    sock_group="$(getent group "$sock_gid" | cut -d: -f1 || true)"
    if [ -z "$sock_group" ]; then
      groupadd -o -g "$sock_gid" docker-host
      sock_group="docker-host"
    fi
    usermod -aG "$sock_group" "$COCOON_USER"
  fi
fi

# Drop privileges and re-exec this script as the unprivileged user.
if ! command -v setpriv >/dev/null 2>&1; then
  echo "docker-entrypoint.sh: setpriv not found (expected from util-linux)" >&2
  exit 1
fi
exec setpriv --reuid "$COCOON_USER" --regid "$COCOON_USER" \
  --init-groups --inh-caps=-all \
  env HOME="$user_home" USER="$COCOON_USER" LOGNAME="$COCOON_USER" \
  "$0" "$@"
