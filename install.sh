#!/usr/bin/env sh
# dotfiles installer — deploy common/ (plus an optional per-user overlay) into $HOME.
#
# Two source layers are mirrored into $HOME:
#   common/        — shared base, deployed for everyone
#   users/<name>/  — per-user overrides; same layout as common/, wins on conflict
# The active user is resolved from --user, then `git config dotfiles.user`, then
# `gh api user`. With no user (or no matching users/<name>/ dir) only common/ is
# deployed, identical to a single-layer install.
#
# A directory present in only one layer is symlinked whole; but if both layers
# contribute, or the destination already exists as a real directory, the
# installer steps inside and deploys each child so per-file overrides apply and
# existing tool/user state is preserved. Plain files are symlinked. *.fragment.json
# files are deep-merged (common then user) into the matching settings JSON
# without clobbering existing keys.
set -u

REPO_DIR=$(
  unset CDPATH
  cd -- "$(dirname -- "$0")" && pwd
)
COMMON_SRC="$REPO_DIR/common"

DRY_RUN=0
NO_BACKUP=0
FORCE=0
NO_PRUNE=0
MODE=install
CLI_USER=""
RESOLVED_USER=""
USER_SRC=""

. "$REPO_DIR/lib/common.sh"
. "$REPO_DIR/lib/json_merge.sh"

usage() {
  cat <<'EOF'
dotfiles installer — deploy common/ (plus an optional per-user overlay) into $HOME

Usage: ./install.sh <command> [flags]

Commands:
  install            Deploy everything under common/ (and users/<name>/) into $HOME
                     (default); also prunes orphaned symlinks (see --no-prune)
  diff               Alias for: install --dry-run
  status             Report in-sync / drift / missing / orphan per entry
  uninstall          Remove managed symlinks; prune emptied directories
  sync-instructions  Copy common/.claude/CLAUDE.md to common/.copilot/copilot-instructions.md

Flags:
  --user <name>      Overlay users/<name>/ on top of common/ (user files win).
                     Default: git config dotfiles.user, else `gh api user`,
                     else common/ only.
  --dry-run          Print actions without applying them
  --no-backup        Skip backups before overwriting (default: backups on)
  --force            Re-link / re-merge even when already in sync
  --no-prune         Skip pruning orphaned symlinks on install
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

# is_managed_link <path> — true if <path> is a deploy symlink, i.e. it points
# at a deploy payload (common/ or users/). Stricter than is_our_link (which
# matches any link into the repo): only deploy-created links are eligible for
# pruning. Keyed off the static repo layout, not the currently-resolved user,
# so prune/uninstall recognize links from any user (or when no user resolves).
is_managed_link() {
  [ -L "$1" ] || return 1
  case "$(readlink "$1")" in
    "$COMMON_SRC"/* | "$REPO_DIR"/users/*) return 0 ;;
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
    # back up only foreign content; one of our own repo links is reconstructible
    is_link_to "$_lp_dest" "$_lp_src" || is_our_link "$_lp_dest" || backup "$_lp_dest"
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
    warn "not a managed symlink, left untouched: $_rml"
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

# --- user overlay resolution -----------------------------------------------

# valid_username <name> — reject empties and anything that could escape users/.
valid_username() {
  case $1 in
    "" | */* | . | .. | *'*'* | *'?'*) return 1 ;;
    *) return 0 ;;
  esac
}

# resolve_user — pick the active user and, if users/<name>/ exists, set USER_SRC.
# Order: --user, then `git config dotfiles.user`, then `gh api user`. An explicit
# --user that is invalid is fatal; auto-detected values that are invalid are
# skipped. With no user resolved, only common/ is deployed.
resolve_user() {
  if [ -n "$CLI_USER" ]; then
    valid_username "$CLI_USER" || die "invalid --user value: $CLI_USER"
    RESOLVED_USER=$CLI_USER
  else
    _ru=$(git config dotfiles.user 2>/dev/null) || _ru=""
    if [ -n "$_ru" ] && valid_username "$_ru"; then
      RESOLVED_USER=$_ru
    elif command -v gh >/dev/null 2>&1 &&
      _ru=$(gh api user --jq .login 2>/dev/null) &&
      [ -n "$_ru" ] && valid_username "$_ru"; then
      RESOLVED_USER=$_ru
    fi
  fi

  [ -n "$RESOLVED_USER" ] || return 0
  if [ -d "$REPO_DIR/users/$RESOLVED_USER" ]; then
    USER_SRC="$REPO_DIR/users/$RESOLVED_USER"
    log "user overlay: $USER_SRC"
  else
    warn "user '$RESOLVED_USER' has no users/ directory — deploying common/ only"
  fi
}

# --- recursive overlay deploy ----------------------------------------------
# deploy_rel / prune_rel / uninstall_rel recurse using only the per-call
# positional parameter $1 (a path relative to the layer roots) plus for-loop
# variables. A `for var in glob` list is fixed at expansion time, so reusing the
# same loop-var name across the recursive call is safe — no `local` needed.

# effective_src <rel> — print the highest-precedence layer path that has <rel>
# (users/ over common/), or nothing if neither layer has it.
effective_src() {
  if [ -n "$USER_SRC" ] && { [ -e "$USER_SRC/$1" ] || [ -L "$USER_SRC/$1" ]; }; then
    printf '%s' "$USER_SRC/$1"
  elif [ -e "$COMMON_SRC/$1" ] || [ -L "$COMMON_SRC/$1" ]; then
    printf '%s' "$COMMON_SRC/$1"
  fi
}

# ensure_destdir <dest> — make <dest> a real directory, backing up and removing
# a foreign file/symlink first (one of our own repo links is reconstructible, so
# it is not backed up). No-op in status mode and (after printing) in dry-run, or
# when <dest> is already a real directory.
ensure_destdir() {
  if [ -d "$1" ] && [ ! -L "$1" ]; then
    return 0
  fi
  if [ "$MODE" = status ]; then
    return 0
  fi
  if [ "$DRY_RUN" -eq 1 ]; then
    if [ -e "$1" ] || [ -L "$1" ]; then
      printf '  [dry-run] replace %s with a directory\n' "$1"
    else
      printf '  [dry-run] mkdir %s\n' "$1"
    fi
    return 0
  fi
  if [ -e "$1" ] || [ -L "$1" ]; then
    is_our_link "$1" || backup "$1"
    rm -rf "$1"
  fi
  mkdir -p "$1" || die "mkdir failed: $1"
}

# deploy_children <rel> — deploy the union of children of <rel>, user layer
# first; common children whose name also exists in the user layer are skipped
# (already handled), so each name is deployed once, user-first.
deploy_children() {
  if [ -n "$USER_SRC" ] && [ -d "$USER_SRC/$1" ]; then
    for _dc in "$USER_SRC/$1"/* "$USER_SRC/$1"/.*; do
      [ -e "$_dc" ] || [ -L "$_dc" ] || continue
      case ${_dc##*/} in . | ..) continue ;; esac
      deploy_rel "$1/${_dc##*/}"
    done
  fi
  [ -d "$COMMON_SRC/$1" ] || return 0
  for _dc in "$COMMON_SRC/$1"/* "$COMMON_SRC/$1"/.*; do
    [ -e "$_dc" ] || [ -L "$_dc" ] || continue
    case ${_dc##*/} in . | ..) continue ;; esac
    if [ -n "$USER_SRC" ] &&
      { [ -e "$USER_SRC/$1/${_dc##*/}" ] || [ -L "$USER_SRC/$1/${_dc##*/}" ]; }; then
      continue
    fi
    deploy_rel "$1/${_dc##*/}"
  done
}

# deploy_fragment <rel> — merge the common then user versions of a fragment
# into the matching JSON under $HOME (existing target keys still win).
deploy_fragment() {
  _df_rel=$1
  _df_target="$HOME/${_df_rel%.fragment.json}.json"
  set --
  [ -e "$COMMON_SRC/$_df_rel" ] && set -- "$@" "$COMMON_SRC/$_df_rel"
  [ -n "$USER_SRC" ] && [ -e "$USER_SRC/$_df_rel" ] && set -- "$@" "$USER_SRC/$_df_rel"
  [ "$#" -gt 0 ] || return 0
  merge_json "$_df_target" "$@"
}

# deploy_rel <rel>
deploy_rel() {
  _eff=$(effective_src "$1")
  [ -n "$_eff" ] || return 0

  case ${1##*/} in
    *.fragment.json)
      deploy_fragment "$1"
      return 0
      ;;
  esac

  if [ -d "$_eff" ] && [ ! -L "$_eff" ]; then
    # Directories are always materialized as real directories and only their
    # leaf files are symlinked. A whole-directory symlink would mean a tool
    # writing into e.g. ~/.claude writes back into the repo, and would leave a
    # surprising symlinked directory behind — so we never do that.
    ensure_destdir "$HOME/$1"
    deploy_children "$1"
    return 0
  fi

  link_path "$_eff" "$HOME/$1"
}

# --- recursive uninstall ---------------------------------------------------

# uninstall_rel <rel> — walk the deployed tree at $HOME/<rel>, remove managed
# leaf symlinks (restoring any backup), recurse real directories and drop those
# left empty. Real files (e.g. a deep-merged settings.json) are left in place.
# Driven by what is on disk, not the active layer set, so it cleans up whatever
# was deployed regardless of which user is resolved now.
uninstall_rel() {
  if [ -d "$HOME/$1" ] && [ ! -L "$HOME/$1" ]; then
    for _uc in "$HOME/$1"/* "$HOME/$1"/.*; do
      [ -e "$_uc" ] || [ -L "$_uc" ] || continue
      case ${_uc##*/} in . | ..) continue ;; esac
      uninstall_rel "$1/${_uc##*/}"
    done
    if [ "$DRY_RUN" -ne 1 ] && [ -d "$HOME/$1" ] && [ ! -L "$HOME/$1" ]; then
      rmdir "$HOME/$1" 2>/dev/null && info "removed empty dir: $HOME/$1"
    fi
    return 0
  fi
  [ -L "$HOME/$1" ] && remove_link "$HOME/$1"
  return 0
}

# uninstall_toplevel — remove any managed symlinks directly under $HOME that the
# layer-driven walk did not visit, so uninstall is complete regardless of user.
uninstall_toplevel() {
  for _ut in "$HOME"/* "$HOME"/.*; do
    [ -L "$_ut" ] || continue
    case ${_ut##*/} in . | ..) continue ;; esac
    is_managed_link "$_ut" || continue
    remove_link "$_ut"
  done
}

# --- orphan prune ----------------------------------------------------------
# An orphan is a deploy symlink whose source no longer exists in either layer.

# prune_one <path> — report (status) or remove (install) one orphan symlink.
# Unlike uninstall's remove_link, pruning never restores a *.dotfiles-bak.*
# backup: a deleted source entry is not an uninstall, so any stale backup on
# disk is left as-is. Callers must pass an is_managed_link path.
prune_one() {
  if [ "$MODE" = status ]; then
    info "orphan  : $1"
    return 0
  fi
  if [ "$DRY_RUN" -eq 1 ]; then
    printf '  [dry-run] remove orphan symlink %s\n' "$1"
    return 0
  fi
  rm -f "$1" && info "pruned  : $1"
}

# prune_rel <rel> — walk the deployed real directory $HOME/<rel> and prune
# managed symlinks whose source is gone from the active layers. Real files and
# foreign symlinks are left untouched. A directory not sourced by any active
# layer that is left empty by pruning is itself an orphan and is removed (this
# cleans up a previously-selected user's top-level overlay directory on switch).
prune_rel() {
  [ -d "$HOME/$1" ] && [ ! -L "$HOME/$1" ] || return 0
  for _pr in "$HOME/$1"/* "$HOME/$1"/.*; do
    [ -e "$_pr" ] || [ -L "$_pr" ] || continue
    case ${_pr##*/} in . | ..) continue ;; esac
    if [ -n "$(effective_src "$1/${_pr##*/}")" ]; then
      prune_rel "$1/${_pr##*/}"
    elif is_managed_link "$_pr"; then
      prune_one "$_pr"
    elif [ -d "$_pr" ] && [ ! -L "$_pr" ]; then
      # unsourced real directory — recurse to catch orphan links nested inside
      prune_rel "$1/${_pr##*/}"
    fi
  done
  if [ "$MODE" != status ] && [ "$DRY_RUN" -ne 1 ] && [ -z "$(effective_src "$1")" ]; then
    rmdir "$HOME/$1" 2>/dev/null && info "pruned  : $HOME/$1"
  fi
}

# prune_toplevel — prune top-level whole-directory deploy symlinks that the
# active layers no longer source: the source was deleted from a layer, or the
# link is a leftover from a previously-selected user whose entry is not in the
# current common+user set. Keyed off effective_src, not whether the link target
# still resolves (a previous user's target may still exist on disk).
prune_toplevel() {
  for _pt in "$HOME"/* "$HOME"/.*; do
    [ -L "$_pt" ] || continue
    case ${_pt##*/} in . | ..) continue ;; esac
    is_managed_link "$_pt" || continue
    [ -n "$(effective_src "${_pt##*/}")" ] && continue # sourced by an active layer
    prune_one "$_pt"
  done
}

# --- top-level layer walk --------------------------------------------------

# walk_top <action> — run <action> for each unique top-level entry name in the
# active layers (user names first, then common names not present in the user
# layer). Used by deploy. <action> is deploy | prune | uninstall.
walk_top() {
  if [ -n "$USER_SRC" ]; then
    for _wt in "$USER_SRC"/* "$USER_SRC"/.*; do
      [ -e "$_wt" ] || [ -L "$_wt" ] || continue
      case ${_wt##*/} in . | ..) continue ;; esac
      walk_top_do "$1" "${_wt##*/}"
    done
  fi
  for _wt in "$COMMON_SRC"/* "$COMMON_SRC"/.*; do
    [ -e "$_wt" ] || [ -L "$_wt" ] || continue
    case ${_wt##*/} in . | ..) continue ;; esac
    if [ -n "$USER_SRC" ] &&
      { [ -e "$USER_SRC/${_wt##*/}" ] || [ -L "$USER_SRC/${_wt##*/}" ]; }; then
      continue
    fi
    walk_top_do "$1" "${_wt##*/}"
  done
}

# walk_all_top <action> — run <action> for each top-level entry name the repo
# could ever have deployed (common/ plus every users/*/). Used by prune and
# uninstall so a previously-selected user's leftovers are handled regardless of
# the active user. Names may repeat across layers; prune/uninstall are
# idempotent, so duplicates are harmless. <action> is prune | uninstall.
walk_all_top() {
  for _wat in "$COMMON_SRC"/* "$COMMON_SRC"/.* \
    "$REPO_DIR"/users/*/* "$REPO_DIR"/users/*/.*; do
    [ -e "$_wat" ] || [ -L "$_wat" ] || continue
    case ${_wat##*/} in . | ..) continue ;; esac
    walk_top_do "$1" "${_wat##*/}"
  done
}

# walk_top_do <action> <name>
walk_top_do() {
  case $1 in
    deploy)
      log ""
      log "[$2]  $(effective_src "$2")  ->  $HOME/$2"
      deploy_rel "$2"
      ;;
    prune) prune_rel "$2" ;;
    uninstall) uninstall_rel "$2" ;;
  esac
}

# --- commands --------------------------------------------------------------

cmd_run() { # install / diff / status
  [ -d "$COMMON_SRC" ] || die "missing payload directory: $COMMON_SRC"
  walk_top deploy

  if [ "$MODE" = status ] || [ "$NO_PRUNE" -ne 1 ]; then
    log ""
    log "[prune]  orphaned managed symlinks"
    walk_all_top prune
    prune_toplevel
  fi
}

cmd_uninstall() {
  [ -d "$COMMON_SRC" ] || die "missing payload directory: $COMMON_SRC"
  walk_all_top uninstall
  uninstall_toplevel
}

cmd_sync_instructions() {
  _si_src="$COMMON_SRC/.claude/CLAUDE.md"
  _si_dst="$COMMON_SRC/.copilot/copilot-instructions.md"
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
    --user)
      shift
      [ $# -gt 0 ] || {
        usage >&2
        die "missing value for --user"
      }
      CLI_USER=$1
      ;;
    --dry-run) DRY_RUN=1 ;;
    --no-backup) NO_BACKUP=1 ;;
    --force) FORCE=1 ;;
    --no-prune) NO_PRUNE=1 ;;
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

resolve_user

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
