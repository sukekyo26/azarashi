# jq-based deep merge of a *.fragment.json into an existing JSON settings file.
# Sourced by install.sh. Expects: DRY_RUN, NO_BACKUP, FORCE, MODE; helpers from common.sh.

# Keys never written into the target, even if a fragment mistakenly contains them.
PROTECTED_KEY_RE='credentials|token|api[_-]?key|secret|password|firstLaunchAt'

# _merge_result <fragment> <target> — print the merged JSON to stdout.
# The fragment is sanitized (protected keys removed); on conflict the existing
# target value wins, so user state is never clobbered.
_merge_result() {
  _mr_frag=$1
  _mr_target=$2

  jq empty "$_mr_frag" 2>/dev/null || die "invalid JSON fragment: $_mr_frag"

  _mr_clean=$(jq --arg re "$PROTECTED_KEY_RE" \
    'walk(if type == "object"
          then with_entries(select(.key | test("^(" + $re + ")$"; "i") | not))
          else . end)' \
    "$_mr_frag") || die "failed to sanitize fragment: $_mr_frag"

  if [ -f "$_mr_target" ]; then
    jq empty "$_mr_target" 2>/dev/null || die "existing target is not valid JSON: $_mr_target"
    printf '%s' "$_mr_clean" | jq -s '.[0] * .[1]' - "$_mr_target" \
      || die "merge failed: $_mr_target"
  else
    printf '%s' "$_mr_clean"
  fi
}

# _json_eq <json-string> <file> — true if the string equals the file's content
# (compared in canonical sorted form).
_json_eq() {
  [ -f "$2" ] || return 1
  [ "$(printf '%s' "$1" | jq -S .)" = "$(jq -S . "$2")" ]
}

# merge_json <fragment> <target> — deploy a fragment.
# In MODE=status, only reports state and makes no changes.
merge_json() {
  _mj_frag=$1
  _mj_target=$2
  _mj_result=$(_merge_result "$_mj_frag" "$_mj_target")

  if [ "$MODE" = status ]; then
    if [ ! -f "$_mj_target" ]; then
      info "missing : $_mj_target"
    elif _json_eq "$_mj_result" "$_mj_target"; then
      info "in-sync : $_mj_target"
    else
      info "drift   : $_mj_target"
    fi
    return 0
  fi

  if [ "$FORCE" -ne 1 ] && _json_eq "$_mj_result" "$_mj_target"; then
    info "in-sync : $_mj_target"
    return 0
  fi

  if [ "$DRY_RUN" -eq 1 ]; then
    printf '  [dry-run] merge %s -> %s\n' "$_mj_frag" "$_mj_target"
    return 0
  fi

  mkdir -p "$(dirname "$_mj_target")" || die "mkdir failed: $_mj_target"
  backup "$_mj_target"
  _mj_tmp="${_mj_target}.azarashi-tmp.$$"
  printf '%s\n' "$_mj_result" > "$_mj_tmp" || die "write failed: $_mj_tmp"
  if ! jq empty "$_mj_tmp" 2>/dev/null; then
    rm -f "$_mj_tmp"
    die "merge produced invalid JSON, aborted: $_mj_target"
  fi
  mv "$_mj_tmp" "$_mj_target" || die "atomic move failed: $_mj_target"
  info "merged  : $_mj_target"
}
