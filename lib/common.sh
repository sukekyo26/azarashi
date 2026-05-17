# Shared helpers for install.sh. Sourced, not executed.
# Expects the caller to define: DRY_RUN, NO_BACKUP, FORCE (0/1).

log() { printf '%s\n' "$*"; }
info() { printf '  %s\n' "$*"; }
warn() { printf 'WARN: %s\n' "$*" >&2; }
err() { printf 'ERROR: %s\n' "$*" >&2; }
die() {
  err "$*"
  exit 1
}

# backup <path> — timestamped copy of an existing file/dir/symlink.
# No-op when the path is absent, in dry-run, or --no-backup.
backup() {
  _bk_target=$1
  if [ ! -e "$_bk_target" ] && [ ! -L "$_bk_target" ]; then
    return 0
  fi
  if [ "$NO_BACKUP" -eq 1 ]; then
    warn "backup skipped (--no-backup): $_bk_target"
    return 0
  fi
  _bk_dest="${_bk_target}.azarashi-bak.$(date -u +%Y%m%dT%H%M%SZ)"
  if [ "$DRY_RUN" -eq 1 ]; then
    printf '  [dry-run] backup %s -> %s\n' "$_bk_target" "$_bk_dest"
    return 0
  fi
  cp -RP "$_bk_target" "$_bk_dest" || die "backup failed: $_bk_target"
  info "backed up: $_bk_dest"
}

# newest_backup <path> — print the most recent backup of <path>, if any.
newest_backup() {
  _nb_base=$1
  find "$(dirname "$_nb_base")" -maxdepth 1 \
    -name "$(basename "$_nb_base").azarashi-bak.*" 2>/dev/null |
    sort | tail -n 1
}
