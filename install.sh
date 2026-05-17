#!/usr/bin/env sh
# azarashi installer — deploy repo config into the matching home directories.
#
# Each top-level ".<name>/" directory in this repo is a deploy target: its
# contents go to "~/.<name>/". Targets are discovered automatically, so adding
# a new ".<name>/" directory makes it deployable with no change to this script.
#
# Files and directories are symlinked (edits in the repo are live); *.fragment.json
# files are deep-merged into the matching settings JSON without clobbering keys.
set -u

REPO_DIR=$(
  unset CDPATH
  cd -- "$(dirname -- "$0")" && pwd
)

DRY_RUN=0
NO_BACKUP=0
FORCE=0
MODE=install

. "$REPO_DIR/lib/common.sh"
. "$REPO_DIR/lib/json_merge.sh"

usage() {
  cat <<'EOF'
azarashi installer — deploy repo config into the matching home directories

Usage: ./install.sh <command> [flags]

Commands:
  install            Deploy every target directory to the home directory (default)
  diff               Alias for: install --dry-run
  status             Report in-sync / drift / missing per entry
  uninstall          Remove azarashi-managed symlinks; restore backups
  sync-instructions  Copy .claude/CLAUDE.md to .copilot/copilot-instructions.md

Flags:
  --target <name>    Restrict to the given target(s); repeatable or
                     space/comma-separated (default: all discovered targets).
                     A target "name" maps repo ".<name>/" to "~/.<name>/".
  --dry-run          Print actions without applying them
  --no-backup        Skip backups before overwriting (default: backups on)
  --force            Re-link / re-merge even when already in sync
  -h, --help         Show this help
EOF
}

# --- target discovery ------------------------------------------------------

# discover_targets — print the name of every deployable target, one per line.
# A target is a top-level ".<name>/" directory other than ".git".
discover_targets() {
  for _dt in "$REPO_DIR"/.*/; do
    [ -d "$_dt" ] || continue
    # Strip the trailing slash and leading path with parameter expansion;
    # basename mishandles the "/./" and "/../" entries some shells glob in.
    _dt_name=${_dt%/}
    _dt_name=${_dt_name##*/}
    case $_dt_name in
      . | .. | .git) continue ;;
    esac
    printf '%s\n' "${_dt_name#.}"
  done
}

target_src() { printf '%s\n' "$REPO_DIR/.$1"; }
target_dest() { printf '%s\n' "$HOME/.$1"; }

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

# deploy_path <src> <dest> — a directory becomes a real dir with symlinked
# children (so the user's own entries can coexist); a file is symlinked.
deploy_path() {
  _dp_src=$1
  _dp_dest=$2
  if [ -d "$_dp_src" ] && [ ! -L "$_dp_src" ]; then
    if [ "$MODE" != status ] && [ "$DRY_RUN" -ne 1 ]; then
      mkdir -p "$_dp_dest" || die "mkdir failed: $_dp_dest"
    fi
    for _dp_child in "$_dp_src"/*; do
      [ -e "$_dp_child" ] || [ -L "$_dp_child" ] || continue
      link_path "$_dp_child" "$_dp_dest/$(basename "$_dp_child")"
    done
  else
    link_path "$_dp_src" "$_dp_dest"
  fi
}

# --- commands --------------------------------------------------------------

process_target() { # install + status
  _pt=$1
  _pt_src=$(target_src "$_pt")
  _pt_dest=$(target_dest "$_pt")
  if [ ! -d "$_pt_src" ]; then
    warn "no source dir, skipped: $_pt_src"
    return 0
  fi
  log ""
  log "[$_pt]  $_pt_src  ->  $_pt_dest"
  if [ "$MODE" != status ] && [ "$DRY_RUN" -ne 1 ]; then
    mkdir -p "$_pt_dest" || die "mkdir failed: $_pt_dest"
  fi
  for _pt_entry in "$_pt_src"/*; do
    [ -e "$_pt_entry" ] || [ -L "$_pt_entry" ] || continue
    _pt_name=$(basename "$_pt_entry")
    case $_pt_name in
      *.fragment.json)
        merge_json "$_pt_entry" "$_pt_dest/${_pt_name%.fragment.json}.json"
        ;;
      *)
        deploy_path "$_pt_entry" "$_pt_dest/$_pt_name"
        ;;
    esac
  done
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

uninstall_target() {
  _ut=$1
  _ut_src=$(target_src "$_ut")
  _ut_dest=$(target_dest "$_ut")
  [ -d "$_ut_src" ] || return 0
  log ""
  log "[$_ut]  uninstall from  $_ut_dest"
  for _ut_entry in "$_ut_src"/*; do
    [ -e "$_ut_entry" ] || continue
    _ut_name=$(basename "$_ut_entry")
    case $_ut_name in
      *.fragment.json)
        info "merged JSON left in place (cannot un-merge): $_ut_dest/${_ut_name%.fragment.json}.json"
        ;;
      *)
        if [ -d "$_ut_entry" ] && [ ! -L "$_ut_entry" ]; then
          for _ut_child in "$_ut_entry"/*; do
            [ -e "$_ut_child" ] || [ -L "$_ut_child" ] || continue
            remove_link "$_ut_dest/$_ut_name/$(basename "$_ut_child")"
          done
          if [ "$DRY_RUN" -ne 1 ] && [ -d "$_ut_dest/$_ut_name" ]; then
            rmdir "$_ut_dest/$_ut_name" 2>/dev/null &&
              info "removed empty dir: $_ut_dest/$_ut_name" || true
          fi
        else
          remove_link "$_ut_dest/$_ut_name"
        fi
        ;;
    esac
  done
}

cmd_sync_instructions() {
  _si_src="$REPO_DIR/.claude/CLAUDE.md"
  _si_dst="$REPO_DIR/.copilot/copilot-instructions.md"
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
TARGETS=""

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
    --target)
      shift
      TARGETS="$TARGETS $(printf '%s' "${1:-}" | tr ',' ' ')"
      ;;
    --target=*)
      TARGETS="$TARGETS $(printf '%s' "${1#--target=}" | tr ',' ' ')"
      ;;
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

ALL_TARGETS=$(discover_targets)
[ -n "$ALL_TARGETS" ] || die "no target directories found in $REPO_DIR"

if [ -z "$(printf '%s' "$TARGETS" | tr -d ' ')" ]; then
  TARGETS=$ALL_TARGETS
fi

for _t in $TARGETS; do
  _found=0
  for _a in $ALL_TARGETS; do
    [ "$_t" = "$_a" ] && _found=1
  done
  [ "$_found" -eq 1 ] || die "unknown target: $_t (available: $(echo "$ALL_TARGETS" | tr '\n' ' '))"
done

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
    for _t in $TARGETS; do process_target "$_t"; done
    log ""
    log "Done."
    ;;
  status)
    MODE=status
    for _t in $TARGETS; do process_target "$_t"; done
    ;;
  uninstall)
    MODE=uninstall
    [ "$DRY_RUN" -eq 1 ] && log "(dry-run — no changes will be made)"
    for _t in $TARGETS; do uninstall_target "$_t"; done
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
