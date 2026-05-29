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
