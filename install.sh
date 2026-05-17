#!/usr/bin/env sh
# azarashi installer — deploy the contents of home/ into $HOME.
#
# Everything under the repo's home/ directory is mirrored into $HOME
# (home/.claude/ -> ~/.claude/, home/.agents/ -> ~/.agents/, ...).
#
# A directory is symlinked whole; but if its destination already exists as a
# real directory, the installer steps inside and deploys each child instead, so
# existing tool/user state is preserved. Plain files are symlinked. *.fragment.json
# files are deep-merged into the matching settings JSON without clobbering keys.
set -u

REPO_DIR=$(
  unset CDPATH
  cd -- "$(dirname -- "$0")" && pwd
)
HOME_SRC="$REPO_DIR/home"

DRY_RUN=0
NO_BACKUP=0
FORCE=0
MODE=install

. "$REPO_DIR/lib/common.sh"
. "$REPO_DIR/lib/json_merge.sh"

usage() {
  cat <<'EOF'
azarashi installer — deploy the contents of home/ into $HOME

Usage: ./install.sh <command> [flags]

Commands:
  install            Deploy everything under home/ into $HOME (default)
  diff               Alias for: install --dry-run
  status             Report in-sync / drift / missing per entry
  uninstall          Remove azarashi-managed symlinks; prune emptied directories
  sync-instructions  Copy home/.claude/CLAUDE.md to home/.copilot/copilot-instructions.md

Flags:
  --dry-run          Print actions without applying them
  --no-backup        Skip backups before overwriting (default: backups on)
  --force            Re-link / re-merge even when already in sync
  -h, --help         Show this help
EOF
}

# --- symlink helpers -------------------------------------------------------

# is_link_to <path> <expected-target>
is_link_to() {
  [ -L "$1" ] || return 1
  [ "$(readlink "$1")" = "$2" ]
}

# is_our_link <path> — true if <path> is a symlink into this repo.
is_our_link() {
  [ -L "$1" ] || return 1
  case "$(readlink "$1")" in
    "$REPO_DIR"/*) return 0 ;;
    *) return 1 ;;
  esac
}

# link_path <src-abs> <dest> — symlink dest -> src, idempotent.
link_path() {
  _lp_src=$1
  _lp_dest=$2

  if [ "$MODE" = status ]; then
    if is_link_to "$_lp_dest" "$_lp_src"; then
      info "in-sync : $_lp_dest"
    elif [ -e "$_lp_dest" ] || [ -L "$_lp_dest" ]; then
      info "drift   : $_lp_dest"
    else
      info "missing : $_lp_dest"
    fi
    return 0
  fi

  if [ "$FORCE" -ne 1 ] && is_link_to "$_lp_dest" "$_lp_src"; then
    info "in-sync : $_lp_dest"
    return 0
  fi

  if [ "$DRY_RUN" -eq 1 ]; then
    printf '  [dry-run] symlink %s -> %s\n' "$_lp_dest" "$_lp_src"
    return 0
  fi

  if [ -e "$_lp_dest" ] || [ -L "$_lp_dest" ]; then
    is_link_to "$_lp_dest" "$_lp_src" || backup "$_lp_dest"
    rm -rf "$_lp_dest"
  fi
  ln -s "$_lp_src" "$_lp_dest" || die "symlink failed: $_lp_dest"
  info "linked  : $_lp_dest"
}

remove_link() {
  _rml=$1
  if is_our_link "$_rml"; then
    if [ "$DRY_RUN" -eq 1 ]; then
      printf '  [dry-run] remove symlink %s\n' "$_rml"
    else
      rm -f "$_rml"
      info "removed : $_rml"
    fi
    restore_backup "$_rml"
  elif [ -e "$_rml" ] || [ -L "$_rml" ]; then
    warn "not an azarashi symlink, left untouched: $_rml"
  fi
}

restore_backup() { # restore newest backup only when the target is now absent
  _rb=$1
  _rb_bk=$(newest_backup "$_rb")
  [ -n "$_rb_bk" ] || return 0
  if [ -e "$_rb" ] || [ -L "$_rb" ]; then
    return 0
  fi
  if [ "$DRY_RUN" -eq 1 ]; then
    printf '  [dry-run] restore %s -> %s\n' "$_rb_bk" "$_rb"
    return 0
  fi
  mv "$_rb_bk" "$_rb" && info "restored: $_rb (from $(basename "$_rb_bk"))"
}

# --- recursive deploy ------------------------------------------------------
# deploy_entry and uninstall_entry recurse using only the per-call positional
# parameters $1/$2 (which are frame-local) plus a loop variable the `for`
# construct reassigns each iteration — so no `local` is needed.

# deploy_entry <src> <dest>
deploy_entry() {
  case ${1##*/} in
    *.fragment.json)
      merge_json "$1" "${2%.fragment.json}.json"
      return 0
      ;;
  esac

  if [ -d "$1" ] && [ ! -L "$1" ]; then
    if [ -d "$2" ] && [ ! -L "$2" ]; then
      # destination is a real directory — step inside
      for _de_child in "$1"/* "$1"/.*; do
        [ -e "$_de_child" ] || [ -L "$_de_child" ] || continue
        case ${_de_child##*/} in . | ..) continue ;; esac
        deploy_entry "$_de_child" "$2/${_de_child##*/}"
      done
      return 0
    fi
    # destination absent (or not a real dir) — symlink the directory whole
    link_path "$1" "$2"
    return 0
  fi

  link_path "$1" "$2"
}

# uninstall_entry <src> <dest>
uninstall_entry() {
  case ${1##*/} in
    *.fragment.json)
      info "merged JSON left in place (cannot un-merge): ${2%.fragment.json}.json"
      return 0
      ;;
  esac

  if [ -d "$1" ] && [ ! -L "$1" ] && [ -d "$2" ] && [ ! -L "$2" ]; then
    for _ue_child in "$1"/* "$1"/.*; do
      [ -e "$_ue_child" ] || [ -L "$_ue_child" ] || continue
      case ${_ue_child##*/} in . | ..) continue ;; esac
      uninstall_entry "$_ue_child" "$2/${_ue_child##*/}"
    done
    if [ "$DRY_RUN" -ne 1 ] && [ -d "$2" ] && [ ! -L "$2" ]; then
      rmdir "$2" 2>/dev/null && info "removed empty dir: $2" || true
    fi
    return 0
  fi

  remove_link "$2"
}

# --- commands --------------------------------------------------------------

cmd_run() { # install / diff / status — walk each top-level entry of home/
  [ -d "$HOME_SRC" ] || die "missing payload directory: $HOME_SRC"
  for _top in "$HOME_SRC"/* "$HOME_SRC"/.*; do
    [ -e "$_top" ] || [ -L "$_top" ] || continue
    case ${_top##*/} in . | ..) continue ;; esac
    log ""
    log "[${_top##*/}]  $_top  ->  $HOME/${_top##*/}"
    deploy_entry "$_top" "$HOME/${_top##*/}"
  done
}

cmd_uninstall() {
  [ -d "$HOME_SRC" ] || die "missing payload directory: $HOME_SRC"
  for _top in "$HOME_SRC"/* "$HOME_SRC"/.*; do
    [ -e "$_top" ] || continue
    case ${_top##*/} in . | ..) continue ;; esac
    log ""
    log "[${_top##*/}]  uninstall from  $HOME/${_top##*/}"
    uninstall_entry "$_top" "$HOME/${_top##*/}"
  done
}

cmd_sync_instructions() {
  _si_src="$HOME_SRC/.claude/CLAUDE.md"
  _si_dst="$HOME_SRC/.copilot/copilot-instructions.md"
  [ -f "$_si_src" ] || die "missing source: $_si_src"
  if [ "$DRY_RUN" -eq 1 ]; then
    printf '  [dry-run] cp %s -> %s\n' "$_si_src" "$_si_dst"
    return 0
  fi
  cp "$_si_src" "$_si_dst" || die "copy failed: $_si_dst"
  log "synced: $_si_dst"
}

# --- argument parsing ------------------------------------------------------

CMD=""

while [ $# -gt 0 ]; do
  case $1 in
    install | status | uninstall | sync-instructions) CMD=$1 ;;
    diff)
      CMD=install
      DRY_RUN=1
      ;;
    --dry-run) DRY_RUN=1 ;;
    --no-backup) NO_BACKUP=1 ;;
    --force) FORCE=1 ;;
    -h | --help)
      usage
      exit 0
      ;;
    *)
      usage >&2
      die "unknown argument: $1"
      ;;
  esac
  shift
done
[ -n "$CMD" ] || CMD=install

# --- dependency check ------------------------------------------------------

for _dep in git jq; do
  command -v "$_dep" >/dev/null 2>&1 ||
    die "'$_dep' is required but not found. Install it (e.g. sudo apt install $_dep)."
done

# --- dispatch --------------------------------------------------------------

case $CMD in
  install)
    MODE=install
    [ "$DRY_RUN" -eq 1 ] && log "(dry-run — no changes will be made)"
    cmd_run
    log ""
    log "Done."
    ;;
  status)
    MODE=status
    cmd_run
    ;;
  uninstall)
    MODE=uninstall
    [ "$DRY_RUN" -eq 1 ] && log "(dry-run — no changes will be made)"
    cmd_uninstall
    log ""
    log "Done."
    ;;
  sync-instructions)
    cmd_sync_instructions
    ;;
  *)
    usage >&2
    die "unknown command: $CMD"
    ;;
esac
