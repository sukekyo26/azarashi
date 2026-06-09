#!/usr/bin/env sh
# Unit tests for the sourced libraries (lib/common.sh, lib/json_merge.sh).
# Run: sh test/run.sh   (depends only on jq). Exits non-zero on any failure.
set -u

SCRIPT_DIR=$(
  unset CDPATH
  cd -- "$(dirname -- "$0")" && pwd
)

# Globals the libraries read; the test harness owns them per case.
DRY_RUN=0
NO_BACKUP=0
FORCE=0
MODE=install

# shellcheck source=lib/common.sh
. "$SCRIPT_DIR/../lib/common.sh"
# shellcheck source=lib/json_merge.sh
. "$SCRIPT_DIR/../lib/json_merge.sh"

TESTS=0
FAILS=0

ok() {
  TESTS=$((TESTS + 1))
  printf '  ok   - %s\n' "$1"
}
ng() {
  TESTS=$((TESTS + 1))
  FAILS=$((FAILS + 1))
  printf '  FAIL - %s\n' "$1"
}
assert_eq() { # <desc> <actual> <expected>
  if [ "$2" = "$3" ]; then
    ok "$1"
  else
    ng "$1"
    printf '         got : %s\n         want: %s\n' "$2" "$3"
  fi
}
expect_true() { # <desc> <cmd...>
  _d=$1
  shift
  if "$@"; then ok "$_d"; else ng "$_d"; fi
}
expect_false() { # <desc> <cmd...>
  _d=$1
  shift
  if "$@"; then ng "$_d"; else ok "$_d"; fi
}
count_glob() { # <path-glob...> — print how many of the arguments exist
  _n=0
  for _f in "$@"; do
    [ -e "$_f" ] && _n=$((_n + 1))
  done
  printf '%s' "$_n"
}

WORK=$(mktemp -d)
trap 'rm -rf "$WORK"' EXIT INT TERM

t="$WORK/settings.json"
f="$WORK/frag.json"
bf="$WORK/settings.fragment.base.json" # 3-way base == ${t%.json}.fragment.base.json

# --- json_merge.sh: merge_json ---------------------------------------------

rm -f "$t"
printf '{"b":3}\n' >"$f"
merge_json "$t" "$f" >/dev/null
assert_eq "merge into absent target materializes the fragment" \
  "$(jq -Sc . "$t")" '{"b":3}'

printf '{"a":1}\n' >"$t"
printf '{"a":2,"b":3}\n' >"$f"
merge_json "$t" "$f" >/dev/null
assert_eq "existing target value wins over the fragment" \
  "$(jq -Sc . "$t")" '{"a":1,"b":3}'

rm -f "$t"
printf '{"a":1}\n' >"$WORK/f1.json"
printf '{"a":2}\n' >"$WORK/f2.json"
merge_json "$t" "$WORK/f1.json" "$WORK/f2.json" >/dev/null
assert_eq "later fragment (user) wins over the earlier one (common)" \
  "$(jq -Sc . "$t")" '{"a":2}'

rm -f "$t"
printf '{"x":{"apiKey":"k","API_KEY":"k","ok":1},"token":"t","keep":2}\n' >"$f"
merge_json "$t" "$f" >/dev/null
assert_eq "protected keys are stripped (nested, case-insensitive)" \
  "$(jq -Sc . "$t")" '{"keep":2,"x":{"ok":1}}'

printf '{"p":[1,2]}\n' >"$t"
printf '{"p":[3]}\n' >"$f"
merge_json "$t" "$f" >/dev/null
assert_eq "arrays: the existing target array wins wholesale" \
  "$(jq -Sc . "$t")" '{"p":[1,2]}'

rm -f "$t"
printf '{"p":[1]}\n' >"$WORK/f1.json"
printf '{"p":[2]}\n' >"$WORK/f2.json"
merge_json "$t" "$WORK/f1.json" "$WORK/f2.json" >/dev/null
assert_eq "arrays: a later fragment replaces, never merges" \
  "$(jq -Sc . "$t")" '{"p":[2]}'

rm -f "$t"
printf 'not json\n' >"$WORK/bad.json"
(merge_json "$t" "$WORK/bad.json") >/dev/null 2>&1
rc=$?
assert_eq "an invalid fragment aborts (rc=1)" "$rc" "1"
assert_eq "the target is not created on abort" \
  "$([ -e "$t" ] && echo yes || echo no)" "no"

printf 'garbage{\n' >"$t"
printf '{"b":2}\n' >"$f"
(merge_json "$t" "$f") >/dev/null 2>&1
rc=$?
assert_eq "an invalid existing target aborts (rc=1)" "$rc" "1"
assert_eq "the invalid target is left untouched" "$(cat "$t")" "garbage{"

rm -f "$t"
printf '{"ok":1}\n' >"$f"
merge_json "$t" "$f" >/dev/null
assert_eq "no .dotfiles-tmp.* is left behind after a merge" \
  "$(count_glob "$WORK"/*.dotfiles-tmp.*)" "0"

printf '{"a":1}\n' >"$t"
printf '{"b":2}\n' >"$f"
MODE=status
out=$(merge_json "$t" "$f" 2>&1)
MODE=install
case "$out" in
  *drift*) ok "status mode reports drift" ;;
  *) ng "status mode reports drift (got: $out)" ;;
esac
assert_eq "status mode leaves the target unchanged" \
  "$(jq -Sc . "$t")" '{"a":1}'

# --- json_merge.sh: merge_json under --force -------------------------------

FORCE=1

# the fragment value overwrites the existing target key; user>common layering is
# kept; a target-only key/subkey absent from every fragment is preserved
rm -f "$t" "$bf"
printf '{"statusLine":{"command":"OLD","padding":9},"mine":1}\n' >"$t"
printf '{"statusLine":{"command":"NEW","type":"command"}}\n' >"$WORK/f1.json"
printf '{"statusLine":{"command":"USER"}}\n' >"$WORK/f2.json"
merge_json "$t" "$WORK/f1.json" "$WORK/f2.json" >/dev/null
assert_eq "force: the later fragment value overwrites the target key (user > common)" \
  "$(jq -Sc .statusLine.command "$t")" '"USER"'
assert_eq "force: a target-only key absent from every fragment is preserved" \
  "$(jq -Sc .mine "$t")" '1'
assert_eq "force: a target-only subkey under an overwritten object survives" \
  "$(jq -Sc .statusLine.padding "$t")" '9'

# protected keys are kept from the target even under --force; a non-protected
# key is still overwritten by the fragment
rm -f "$t" "$bf"
printf '{"statusLine":{"command":"OLD"},"token":"SECRET","firstLaunchAt":"2020"}\n' >"$t"
printf '{"statusLine":{"command":"NEW"},"token":"FROM_FRAG"}\n' >"$f"
merge_json "$t" "$f" >/dev/null
assert_eq "force: protected target keys are kept, never taken from the fragment" \
  "$(jq -Sc '{firstLaunchAt,token}' "$t")" '{"firstLaunchAt":"2020","token":"SECRET"}'
assert_eq "force: a non-protected key is still overwritten by the fragment" \
  "$(jq -Sc .statusLine.command "$t")" '"NEW"'

# arrays: under --force the fragment array replaces the target array wholesale
rm -f "$t" "$bf"
printf '{"hooks":[{"a":1},{"a":2}]}\n' >"$t"
printf '{"hooks":[{"b":1},{"b":2},{"b":3}]}\n' >"$f"
merge_json "$t" "$f" >/dev/null
assert_eq "force: a fragment array replaces the target array wholesale" \
  "$(jq -Sc .hooks "$t")" '[{"b":1},{"b":2},{"b":3}]'

# idempotency: a second force run converges, reports in-sync, makes no new backup
rm -f "$t" "$bf" "$t".dotfiles-bak.*
printf '{"k":"old"}\n' >"$t"
printf '{"k":"new"}\n' >"$f"
merge_json "$t" "$f" >/dev/null
bk1=$(count_glob "$t".dotfiles-bak.*)
out=$(merge_json "$t" "$f" 2>&1)
bk2=$(count_glob "$t".dotfiles-bak.*)
assert_eq "force: a second run converges on the fragment value" \
  "$(jq -Sc .k "$t")" '"new"'
case "$out" in
  *in-sync*) ok "force: a converged re-merge reports in-sync (no rewrite)" ;;
  *) ng "force: a converged re-merge should report in-sync (got: $out)" ;;
esac
assert_eq "force: a converged re-merge adds no new backup" "$bk2" "$bk1"

# --- json_merge.sh: 3-way key deletion under --force -----------------------

# (a) a key dropped from the fragment is removed from the target (base records it)
rm -f "$t" "$bf"
printf '{"keep":1,"gone":2}\n' >"$bf"
printf '{"keep":1,"gone":2}\n' >"$t"
printf '{"keep":1}\n' >"$f"
merge_json "$t" "$f" >/dev/null
assert_eq "force 3-way: a key gone from the fragment is deleted from the target" \
  "$(jq -Sc . "$t")" '{"keep":1}'

# (b) a key changed by hand since the base is NOT deleted (manual edit wins)
rm -f "$t" "$bf"
printf '{"keep":1,"gone":2}\n' >"$bf"
printf '{"keep":1,"gone":99}\n' >"$t"
printf '{"keep":1}\n' >"$f"
merge_json "$t" "$f" >/dev/null
assert_eq "force 3-way: a manually-changed key is not deleted" \
  "$(jq -Sc .gone "$t")" '99'

# (c) with no base (first ever --force) nothing is deleted, and a base is written
rm -f "$t" "$bf"
printf '{"keep":1,"extra":2}\n' >"$t"
printf '{"keep":1}\n' >"$f"
merge_json "$t" "$f" >/dev/null
assert_eq "force 3-way: no base (first run) deletes nothing" \
  "$(jq -Sc .extra "$t")" '2'
assert_eq "force 3-way: the first run writes a base snapshot" \
  "$([ -f "$bf" ] && echo yes || echo no)" "yes"

# (d) without --force, deletion never happens even when a base exists
FORCE=0
rm -f "$t" "$bf"
printf '{"keep":1,"gone":2}\n' >"$bf"
printf '{"keep":1,"gone":2}\n' >"$t"
printf '{"keep":1}\n' >"$f"
merge_json "$t" "$f" >/dev/null
assert_eq "FORCE=0: a key is never deleted even with a base present" \
  "$(jq -Sc .gone "$t")" '2'
FORCE=1

# (e) protected keys are never deletion candidates (absent from base/clean)
rm -f "$t" "$bf"
printf '{"keep":1}\n' >"$bf"
printf '{"keep":1,"token":"SECRET"}\n' >"$t"
printf '{"keep":1}\n' >"$f"
merge_json "$t" "$f" >/dev/null
assert_eq "force 3-way: a protected target key is never deleted" \
  "$(jq -Sc .token "$t")" '"SECRET"'

# (f) nested deletion keeps siblings; an array value is removed atomically
rm -f "$t" "$bf"
printf '{"n":{"x":1,"y":2},"arr":[1,2]}\n' >"$bf"
printf '{"n":{"x":1,"y":2},"arr":[1,2]}\n' >"$t"
printf '{"n":{"x":1}}\n' >"$f"
merge_json "$t" "$f" >/dev/null
assert_eq "force 3-way: nested partial deletion keeps the sibling key" \
  "$(jq -Sc .n "$t")" '{"x":1}'
assert_eq "force 3-way: an array-valued key is deleted atomically (no [{}])" \
  "$(jq -Sc 'has("arr")' "$t")" 'false'

# (g) dry-run lists the keys it would delete and changes nothing
rm -f "$t" "$bf"
printf '{"keep":1,"gone":2}\n' >"$bf"
printf '{"keep":1,"gone":2}\n' >"$t"
printf '{"keep":1}\n' >"$f"
DRY_RUN=1
out=$(merge_json "$t" "$f" 2>&1)
DRY_RUN=0
case "$out" in
  *"delete key: gone"*) ok "force 3-way: --dry-run lists the key it would delete" ;;
  *) ng "force 3-way: --dry-run should list 'delete key: gone' (got: $out)" ;;
esac
assert_eq "force 3-way: --dry-run leaves the target unchanged" \
  "$(jq -Sc .gone "$t")" '2'

# (h) after a delete, a second run converges (idempotent) and adds no backup
rm -f "$t" "$bf" "$t".dotfiles-bak.*
printf '{"keep":1,"gone":2}\n' >"$bf"
printf '{"keep":1,"gone":2}\n' >"$t"
printf '{"keep":1}\n' >"$f"
merge_json "$t" "$f" >/dev/null
bk1=$(count_glob "$t".dotfiles-bak.*)
out=$(merge_json "$t" "$f" 2>&1)
bk2=$(count_glob "$t".dotfiles-bak.*)
case "$out" in
  *in-sync*) ok "force 3-way: a second run after a delete is in-sync" ;;
  *) ng "force 3-way: a second run should be in-sync (got: $out)" ;;
esac
assert_eq "force 3-way: a converged delete adds no new backup" "$bk2" "$bk1"

# (i) a manual structural change (object -> scalar) under a deleted key is kept,
# and never aborts the merge with a getpath error
rm -f "$t" "$bf"
printf '{"n":{"x":1,"y":2}}\n' >"$bf"
printf '{"n":5}\n' >"$t"
printf '{"n":{"x":1}}\n' >"$f"
merge_json "$t" "$f" >/dev/null
assert_eq "force 3-way: a manual structural change does not abort the merge" \
  "$(jq -Sc .n "$t")" '{"x":1}'

# (j) --dry-run no-ops cleanly when the base exists but the target is gone
rm -f "$t" "$bf"
printf '{"keep":1,"gone":2}\n' >"$bf"
printf '{"keep":1}\n' >"$f"
DRY_RUN=1
out=$(merge_json "$t" "$f" 2>&1)
DRY_RUN=0
case "$out" in
  *"Could not open"* | *"No such file"*) ng "force 3-way: dry-run with a gone target must not error (got: $out)" ;;
  *) ok "force 3-way: dry-run with a gone target and present base does not error" ;;
esac

# (k) several dropped keys are all deleted in a single run
rm -f "$t" "$bf"
printf '{"keep":1,"g1":2,"g2":3}\n' >"$bf"
printf '{"keep":1,"g1":2,"g2":3}\n' >"$t"
printf '{"keep":1}\n' >"$f"
merge_json "$t" "$f" >/dev/null
assert_eq "force 3-way: multiple dropped keys are all deleted in one run" \
  "$(jq -Sc . "$t")" '{"keep":1}'

# (l) a whole object subtree dropped from the fragment is removed atomically
rm -f "$t" "$bf"
printf '{"keep":1,"obj":{"x":1,"y":2}}\n' >"$bf"
printf '{"keep":1,"obj":{"x":1,"y":2}}\n' >"$t"
printf '{"keep":1}\n' >"$f"
merge_json "$t" "$f" >/dev/null
assert_eq "force 3-way: a whole object subtree is deleted atomically (no empty {})" \
  "$(jq -Sc . "$t")" '{"keep":1}'

# (m) one run overwrites a changed key, adds a new one, and deletes a dropped one
rm -f "$t" "$bf"
printf '{"a":1,"del":2}\n' >"$bf"
printf '{"a":1,"del":2}\n' >"$t"
printf '{"a":99,"new":3}\n' >"$f"
merge_json "$t" "$f" >/dev/null
assert_eq "force 3-way: a single run overwrites, adds, and deletes together" \
  "$(jq -Sc . "$t")" '{"a":99,"new":3}'

# (n) deletion works across layered fragments (common + user merged into the base)
rm -f "$t" "$bf"
printf '{"common":1,"user":2,"gone":3}\n' >"$bf"
printf '{"common":1,"user":2,"gone":3}\n' >"$t"
printf '{"common":1}\n' >"$WORK/f1.json"
printf '{"user":2}\n' >"$WORK/f2.json"
merge_json "$t" "$WORK/f1.json" "$WORK/f2.json" >/dev/null
assert_eq "force 3-way: a key gone from the layered (common+user) fragments is deleted" \
  "$(jq -Sc . "$t")" '{"common":1,"user":2}'

# (o) --force --dry-run never rewrites the base snapshot (dry-run has no side effects)
rm -f "$t" "$bf"
printf '{"keep":1,"OLD":1}\n' >"$bf"
printf '{"keep":1}\n' >"$t"
printf '{"keep":1}\n' >"$f"
DRY_RUN=1
merge_json "$t" "$f" >/dev/null 2>&1
DRY_RUN=0
assert_eq "force 3-way: --dry-run does not rewrite the base snapshot" \
  "$(jq -Sc . "$bf")" '{"OLD":1,"keep":1}'

rm -f "$t" "$bf"

FORCE=0

# --- json_merge.sh: _json_eq -----------------------------------------------

printf '{"b":2,"a":1}\n' >"$t"
expect_true "_json_eq is key-order insensitive" _json_eq '{"a":1,"b":2}' "$t"
expect_false "_json_eq detects a difference" _json_eq '{"a":1,"b":3}' "$t"
expect_false "_json_eq is false for a missing file" _json_eq '{"a":1}' "$WORK/none.json"

# --- common.sh: backup -----------------------------------------------------

rm -f "$WORK/x"
backup "$WORK/x" >/dev/null 2>&1
assert_eq "backup is a no-op when the target is absent" \
  "$(count_glob "$WORK"/x.dotfiles-bak.*)" "0"

printf 'hi\n' >"$WORK/x"
backup "$WORK/x" >/dev/null 2>&1
assert_eq "backup copies an existing target" \
  "$(count_glob "$WORK"/x.dotfiles-bak.*)" "1"

printf 'hi\n' >"$WORK/y"
NO_BACKUP=1
backup "$WORK/y" >/dev/null 2>&1
NO_BACKUP=0
assert_eq "backup is skipped with --no-backup" \
  "$(count_glob "$WORK"/y.dotfiles-bak.*)" "0"

printf 'hi\n' >"$WORK/z"
DRY_RUN=1
backup "$WORK/z" >/dev/null 2>&1
DRY_RUN=0
assert_eq "backup is skipped in dry-run" \
  "$(count_glob "$WORK"/z.dotfiles-bak.*)" "0"

# --- common.sh: newest_backup ----------------------------------------------

base="$WORK/nb"
: >"$base.dotfiles-bak.20240101T000000Z"
: >"$base.dotfiles-bak.20250101T000000Z"
: >"$base.dotfiles-bak.20230101T000000Z"
assert_eq "newest_backup returns the most recent timestamp" \
  "$(newest_backup "$base")" "$base.dotfiles-bak.20250101T000000Z"

# --- summary ---------------------------------------------------------------

printf '\n%s test(s), %s failure(s)\n' "$TESTS" "$FAILS"
[ "$FAILS" -eq 0 ]
