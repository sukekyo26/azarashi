# jq-based deep merge of one or more *.fragment.json into an existing JSON file.
# Sourced by install.sh. Expects: DRY_RUN, NO_BACKUP, FORCE, MODE; helpers from common.sh.

# Keys never written into the target, even if a fragment mistakenly contains them.
PROTECTED_KEY_RE='credentials|token|api[_-]?key|secret|password|firstLaunchAt'

# _merge_chain <target> <frag1> [frag2 ...] — print the merged JSON to stdout.
# Fragments are combined left-to-right (later fragment wins, so user over common)
# and sanitized (protected keys removed); on conflict the existing target value
# wins, so user state is never clobbered. Precedence: target > later > earlier.
_merge_chain() {
  _mc_target=$1
  shift

  for _mc_f in "$@"; do
    jq empty "$_mc_f" 2>/dev/null || die "invalid JSON fragment: $_mc_f"
  done

  _mc_clean=$(jq -s --arg re "$PROTECTED_KEY_RE" \
    'reduce .[1:][] as $x (.[0]; . * $x)
     | walk(if type == "object"
            then with_entries(select(.key | test("^(" + $re + ")$"; "i") | not))
            else . end)' \
    "$@") || die "failed to merge/sanitize fragments"

  if [ -f "$_mc_target" ]; then
    jq empty "$_mc_target" 2>/dev/null || die "existing target is not valid JSON: $_mc_target"
    printf '%s' "$_mc_clean" | jq -s '.[0] * .[1]' - "$_mc_target" ||
      die "merge failed: $_mc_target"
  else
    printf '%s' "$_mc_clean"
  fi
}

# _json_eq <json-string> <file> — true if the string equals the file's content
# (compared in canonical sorted form).
_json_eq() {
  [ -f "$2" ] || return 1
  [ "$(printf '%s' "$1" | jq -S .)" = "$(jq -S . "$2")" ]
}

# merge_json <target> <frag1> [frag2 ...] — deploy one or more fragments.
# In MODE=status, only reports state and makes no changes.
merge_json() {
  _mj_target=$1
  shift
  # _merge_chain die()s inside this $(...) subshell, which only exits the
  # subshell — propagate that failure so an invalid fragment/target aborts
  # before we overwrite the target (it printed the specific error to stderr).
  _mj_result=$(_merge_chain "$_mj_target" "$@") || exit 1

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
    printf '  [dry-run] merge %s -> %s\n' "$*" "$_mj_target"
    return 0
  fi

  mkdir -p "$(dirname "$_mj_target")" || die "mkdir failed: $_mj_target"
  backup "$_mj_target"
  _mj_tmp="${_mj_target}.dotfiles-tmp.$$"
  printf '%s\n' "$_mj_result" >"$_mj_tmp" || die "write failed: $_mj_tmp"
  if ! jq empty "$_mj_tmp" 2>/dev/null; then
    rm -f "$_mj_tmp"
    die "merge produced invalid JSON, aborted: $_mj_target"
  fi
  mv "$_mj_tmp" "$_mj_target" || die "atomic move failed: $_mj_target"
  info "merged  : $_mj_target"
}
