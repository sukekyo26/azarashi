# jq-based deep merge of one or more *.fragment.json into an existing JSON file.
# Sourced by install.sh. Expects: DRY_RUN, NO_BACKUP, FORCE, MODE; helpers from common.sh.

# Keys never written into the target, even if a fragment mistakenly contains them.
PROTECTED_KEY_RE='credentials|token|api[_-]?key|secret|password|firstLaunchAt'

# jq program for the --force 3-way step. Inputs: $clean (the fragment as applied),
# $base[0] (the previously applied fragment), $target[0] (the current file) and
# $mode ("apply" | "list"). It removes every key that was in the base but is gone
# from the new fragment, but only the topmost such boundary and only where the
# target still holds the base value — so manual edits survive (protected keys
# never reach base/clean, so they are never candidates). Removing the topmost
# boundary deletes scalars, arrays and objects atomically, leaving no empty {}.
# "list" prints the dotted paths it would delete; "apply" returns the merged JSON.
# shellcheck disable=SC2016  # $base/$target/$clean/$mode/$p are jq vars, not shell
_3WAY_JQ='
def walk_ok($o; $p):
  $o | reduce $p[] as $k ({cur: ., ok: true};
         if (.ok and (.cur | type == "object") and (.cur | has($k)))
         then {cur: (.cur[$k]), ok: true}
         else {cur: null, ok: false} end);
def absent($o; $p): walk_ok($o; $p) | .ok | not;
def parentObj($o; $p): walk_ok($o; $p[0:-1]) | (.ok and (.cur | type == "object"));
($base[0]) as $b | ($target[0]) as $t | ($clean) as $f
| [ $b | [paths] as $all | $all[] as $p
    # compare via walk_ok, not getpath: if the target diverged structurally from
    # the base (a manual edit turned an object into a scalar/array), treat it as a
    # mismatch and keep the key, rather than letting getpath abort the whole merge.
    | select(($p | length) > 0
             and parentObj($f; $p)
             and absent($f; $p)
             and (walk_ok($t; $p) as $tw | $tw.ok and ($tw.cur == ($b | getpath($p)))))
    | $p ] as $del
| if $mode == "list" then ($del[] | map(tostring) | join("."))
  else (($t * $f) | delpaths($del)) end
'

# _clean_fragment <frag1> [frag2 ...] — validate every fragment, then print the
# left-to-right merged (later wins, so user over common) and sanitized (protected
# keys removed) JSON. The single source of truth for "the fragment as applied",
# shared by the merge and by the 3-way base snapshot.
_clean_fragment() {
  for _cf_f in "$@"; do
    jq empty "$_cf_f" 2>/dev/null || die "invalid JSON fragment: $_cf_f"
  done
  jq -s --arg re "$PROTECTED_KEY_RE" \
    'reduce .[1:][] as $x (.[0]; . * $x)
     | walk(if type == "object"
            then with_entries(select(.key | test("^(" + $re + ")$"; "i") | not))
            else . end)' \
    "$@" || die "failed to merge/sanitize fragments"
}

# _merge_chain <target> <frag1> [frag2 ...] — print the merged JSON to stdout.
# By default the existing target value wins on conflict, so user state is never
# clobbered (target > later > earlier). With --force the fragment wins instead
# (later > earlier > target); additionally, when a $BASE_FILE snapshot of the
# previously applied fragment exists, keys dropped from the fragment are removed
# (3-way) where the target is unchanged since. Protected keys are stripped from
# the fragments, so the target's protected keys always survive.
_merge_chain() {
  _mc_target=$1
  shift

  _mc_clean=$(_clean_fragment "$@") || exit 1

  if [ ! -f "$_mc_target" ]; then
    printf '%s' "$_mc_clean"
    return 0
  fi
  jq empty "$_mc_target" 2>/dev/null || die "existing target is not valid JSON: $_mc_target"

  if [ "$FORCE" -eq 1 ] && [ -n "${BASE_FILE:-}" ] && [ -f "$BASE_FILE" ]; then
    jq empty "$BASE_FILE" 2>/dev/null || die "fragment base is not valid JSON: $BASE_FILE"
    jq -n --arg mode apply --argjson clean "$_mc_clean" \
      --slurpfile base "$BASE_FILE" --slurpfile target "$_mc_target" \
      "$_3WAY_JQ" || die "3-way merge failed: $_mc_target"
    return 0
  fi

  # 2-way: stdin (clean) is .[0], target is .[1]. Default .[0] * .[1] keeps the
  # target; --force flips to .[1] * .[0] so the fragment overwrites the target.
  _mc_expr='.[0] * .[1]'
  [ "$FORCE" -eq 1 ] && _mc_expr='.[1] * .[0]'
  printf '%s' "$_mc_clean" | jq -s "$_mc_expr" - "$_mc_target" ||
    die "merge failed: $_mc_target"
}

# _save_base <frag1> [frag2 ...] — snapshot the clean fragment just applied to
# $BASE_FILE, so the next --force run can detect keys removed from the fragment.
# Only called under --force, outside status/dry-run.
_save_base() {
  _sb_clean=$(_clean_fragment "$@") || exit 1
  mkdir -p "$(dirname "$BASE_FILE")" || die "mkdir failed: $BASE_FILE"
  _sb_tmp="${BASE_FILE}.dotfiles-tmp.$$"
  printf '%s\n' "$_sb_clean" >"$_sb_tmp" || die "write failed: $_sb_tmp"
  mv "$_sb_tmp" "$BASE_FILE" || die "atomic move failed: $BASE_FILE"
}

# _show_deleted_keys <frag1> [frag2 ...] — under --force --dry-run, print the
# dotted path of each key the 3-way merge would remove. No-op without a base.
_show_deleted_keys() {
  # no-op unless both the base snapshot and the target exist: with a missing
  # target there is nothing to delete, and slurping it into jq would error.
  [ -n "${BASE_FILE:-}" ] && [ -f "$BASE_FILE" ] && [ -f "$_mj_target" ] || return 0
  jq empty "$BASE_FILE" 2>/dev/null || return 0
  _sdk_clean=$(_clean_fragment "$@") || exit 1
  jq -rn --arg mode list --argjson clean "$_sdk_clean" \
    --slurpfile base "$BASE_FILE" --slurpfile target "$_mj_target" \
    "$_3WAY_JQ" | while IFS= read -r _sdk_p; do
    [ -n "$_sdk_p" ] && info "[dry-run] delete key: $_sdk_p"
  done
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
  # Where the previously applied fragment is snapshotted: next to the target,
  # under $HOME. It is never a *.fragment.json (so deploy ignores it) and never a
  # *.dotfiles-bak.* (so clean-backups ignores it). Drives the 3-way delete.
  BASE_FILE="${_mj_target%.json}.fragment.base.json"
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

  # Skip when already converged, even under --force: a re-merge whose result
  # equals the target is a pure no-op, so honoring this keeps install idempotent
  # and avoids a fresh backup on every run. --force still changes _mj_result
  # itself (the fragment wins), so a genuinely changed fragment is never skipped.
  if _json_eq "$_mj_result" "$_mj_target"; then
    info "in-sync : $_mj_target"
    # Refresh the base even when unchanged, so a later fragment edit diffs
    # against the fragment actually in effect now (keeps 3-way delete accurate).
    [ "$FORCE" -eq 1 ] && _save_base "$@"
    return 0
  fi

  if [ "$DRY_RUN" -eq 1 ]; then
    if [ "$FORCE" -eq 1 ]; then
      printf '  [dry-run] merge (force: fragment overwrites target) %s -> %s\n' "$*" "$_mj_target"
      _show_deleted_keys "$@"
    else
      printf '  [dry-run] merge %s -> %s\n' "$*" "$_mj_target"
    fi
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
  # Snapshot the applied fragment for the next --force run's 3-way delete.
  [ "$FORCE" -eq 1 ] && _save_base "$@"
}
