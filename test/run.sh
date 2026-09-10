#!/usr/bin/env sh
# Unit tests for the sourced libraries (lib/common.sh, lib/json_merge.sh,
# lib/toml_merge.sh). Run: sh test/run.sh — needs jq; the TOML merge tests also
# need python3 >= 3.9 and are skipped otherwise. Exits non-zero on any failure.
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
# shellcheck source=lib/toml_merge.sh
. "$SCRIPT_DIR/../lib/toml_merge.sh"

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
printf '{"a":"common","c":1}\n' >"$WORK/f1.json"
printf '{"a":"profile","p":2}\n' >"$WORK/f2.json"
printf '{"a":"user","u":3}\n' >"$WORK/f3.json"
merge_json "$t" "$WORK/f1.json" "$WORK/f2.json" "$WORK/f3.json" >/dev/null
assert_eq "three layers merge in order (common < profile < user)" \
  "$(jq -Sc . "$t")" '{"a":"user","c":1,"p":2,"u":3}'

rm -f "$t"
printf '{"x":{"apiKey":"k","API_KEY":"k","ok":1},"token":"t","keep":2}\n' >"$f"
merge_json "$t" "$f" >/dev/null
assert_eq "protected keys are stripped (nested, case-insensitive)" \
  "$(jq -Sc . "$t")" '{"keep":2,"x":{"ok":1}}'

printf '{"p":[1,2]}\n' >"$t"
printf '{"p":[3]}\n' >"$f"
merge_json "$t" "$f" >/dev/null
assert_eq "arrays: fragment elements are unioned into the target array" \
  "$(jq -Sc . "$t")" '{"p":[1,2,3]}'

printf '{"p":[1,2]}\n' >"$t"
printf '{"p":[2,3]}\n' >"$f"
merge_json "$t" "$f" >/dev/null
assert_eq "arrays: union deduplicates by deep equality" \
  "$(jq -Sc . "$t")" '{"p":[1,2,3]}'

printf '{"p":[{"a":1},{"b":2}]}\n' >"$t"
printf '{"p":[{"a":1}]}\n' >"$f"
merge_json "$t" "$f" >/dev/null
assert_eq "arrays: object elements are deduplicated by deep equality" \
  "$(jq -Sc . "$t")" '{"p":[{"a":1},{"b":2}]}'

printf '{"h":{"Pre":[{"m":"B"}]}}\n' >"$t"
printf '{"h":{"Pre":[{"m":"W"}]}}\n' >"$f"
merge_json "$t" "$f" >/dev/null
assert_eq "arrays: nested array union through object merge" \
  "$(jq -Sc . "$t")" '{"h":{"Pre":[{"m":"B"},{"m":"W"}]}}'

printf '{"p":[1,2]}\n' >"$t"
printf '{"p":[3]}\n' >"$f"
merge_json "$t" "$f" >/dev/null
printf '{"p":[3]}\n' >"$f"
merge_json "$t" "$f" >/dev/null
assert_eq "arrays: union is idempotent (second run same result)" \
  "$(jq -Sc . "$t")" '{"p":[1,2,3]}'

rm -f "$t"
printf '{"p":[1]}\n' >"$WORK/f1.json"
printf '{"p":[2]}\n' >"$WORK/f2.json"
merge_json "$t" "$WORK/f1.json" "$WORK/f2.json" >/dev/null
assert_eq "arrays: a later fragment appends to the earlier one, earlier first" \
  "$(jq -Sc . "$t")" '{"p":[1,2]}'

rm -f "$t"
printf '{"p":[1,2]}\n' >"$WORK/f1.json"
printf '{"p":[2,3]}\n' >"$WORK/f2.json"
merge_json "$t" "$WORK/f1.json" "$WORK/f2.json" >/dev/null
assert_eq "arrays: overlapping entries across layers are deduplicated" \
  "$(jq -Sc . "$t")" '{"p":[1,2,3]}'

# the layered hooks case: an overlay adding one entry must not drop the base's
rm -f "$t"
printf '{"h":{"Pre":[{"m":"B"}]},"e":{"A":"1"},"s":"common"}\n' >"$WORK/f1.json"
printf '{"h":{"Pre":[{"m":"E"}]},"e":{"B":"2"},"s":"profile"}\n' >"$WORK/f2.json"
merge_json "$t" "$WORK/f1.json" "$WORK/f2.json" >/dev/null
assert_eq "layers: arrays append, objects deep-merge, scalars take the later value" \
  "$(jq -Sc . "$t")" '{"e":{"A":"1","B":"2"},"h":{"Pre":[{"m":"B"},{"m":"E"}]},"s":"profile"}'

rm -f "$t"
printf '{"p":[1]}\n' >"$WORK/f1.json"
printf '{"p":[2]}\n' >"$WORK/f2.json"
printf '{"p":[3]}\n' >"$WORK/f3.json"
merge_json "$t" "$WORK/f1.json" "$WORK/f2.json" "$WORK/f3.json" >/dev/null
assert_eq "arrays: three layers append in order (common, profile, user)" \
  "$(jq -Sc . "$t")" '{"p":[1,2,3]}'

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

# (c2) the fragment dropped the parent object too: the nested key still goes,
# while a sibling the user added under that parent survives. Regression: the
# parent-exists guard used to skip these, so `[mcp_servers.<plugin>]` stayed
# behind whenever it was the fragment's only entry under that table.
rm -f "$t" "$bf"
printf '{"servers":{"gone":{"cmd":"x"}}}\n' >"$bf"
printf '{"servers":{"gone":{"cmd":"x"},"mine":{"cmd":"y"}}}\n' >"$t"
printf '{"other":1}\n' >"$f"
merge_json "$t" "$f" >/dev/null
assert_eq "force 3-way: a nested key is deleted even when the fragment dropped its parent" \
  "$(jq -Sc .servers "$t")" '{"mine":{"cmd":"y"}}'

# (c3) same shape, but the user edited the key since the base — it must survive.
rm -f "$t" "$bf"
printf '{"servers":{"gone":{"cmd":"x"}}}\n' >"$bf"
printf '{"servers":{"gone":{"cmd":"edited"}}}\n' >"$t"
printf '{"other":1}\n' >"$f"
merge_json "$t" "$f" >/dev/null
assert_eq "force 3-way: a manually-changed nested key survives a dropped parent" \
  "$(jq -Sc .servers.gone.cmd "$t")" '"edited"'

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

# (g2) dry-run previews add/overwrite/delete together and changes nothing
rm -f "$t" "$bf"
printf '{"a":1,"b":2}\n' >"$bf"
printf '{"a":9,"b":2}\n' >"$t"
printf '{"a":1,"c":3}\n' >"$f"
DRY_RUN=1
out=$(merge_json "$t" "$f" 2>&1)
DRY_RUN=0
case "$out" in
  *"add key: c"*) ok "force 3-way: --dry-run previews an added key" ;;
  *) ng "force 3-way: --dry-run should preview 'add key: c' (got: $out)" ;;
esac
case "$out" in
  *"overwrite key: a"*) ok "force 3-way: --dry-run previews an overwritten key" ;;
  *) ng "force 3-way: --dry-run should preview 'overwrite key: a' (got: $out)" ;;
esac
case "$out" in
  *"delete key: b"*) ok "force 3-way: --dry-run previews a deleted key" ;;
  *) ng "force 3-way: --dry-run should preview 'delete key: b' (got: $out)" ;;
esac
assert_eq "force 3-way: --dry-run preview leaves the target unchanged" \
  "$(jq -Sc . "$t")" '{"a":9,"b":2}'

# (g3) without --force, the preview lists only additions (the target wins)
rm -f "$t" "$bf"
printf '{"a":9,"b":2}\n' >"$t"
printf '{"a":1,"c":3}\n' >"$f"
FORCE=0
DRY_RUN=1
out=$(merge_json "$t" "$f" 2>&1)
DRY_RUN=0
FORCE=1
case "$out" in
  *"overwrite key:"*) ng "non-force --dry-run must not preview an overwrite (got: $out)" ;;
  *"add key: c"*) ok "non-force --dry-run previews only additions" ;;
  *) ng "non-force --dry-run should preview 'add key: c' (got: $out)" ;;
esac

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

# (p) force 3-way preserves user-added array elements via base comparison
rm -f "$t" "$bf"
printf '{"h":[{"a":1}]}\n' >"$bf"
printf '{"h":[{"a":1},{"u":1}]}\n' >"$t"
printf '{"h":[{"a":1},{"b":2}]}\n' >"$f"
merge_json "$t" "$f" >/dev/null
assert_eq "force 3-way: user-added array element is preserved" \
  "$(jq -Sc .h "$t")" '[{"a":1},{"b":2},{"u":1}]'

# (q) force 3-way removes fragment-dropped array elements but keeps user additions
rm -f "$t" "$bf"
printf '{"h":[{"a":1},{"b":2}]}\n' >"$bf"
printf '{"h":[{"a":1},{"b":2},{"u":1}]}\n' >"$t"
printf '{"h":[{"a":1}]}\n' >"$f"
merge_json "$t" "$f" >/dev/null
assert_eq "force 3-way: dropped element removed, user addition kept" \
  "$(jq -Sc .h "$t")" '[{"a":1},{"u":1}]'

# (r) force 3-way array: user addition identical to new fragment element is not duplicated
rm -f "$t" "$bf"
printf '{"h":[{"a":1}]}\n' >"$bf"
printf '{"h":[{"a":1},{"b":2}]}\n' >"$t"
printf '{"h":[{"a":1},{"b":2}]}\n' >"$f"
merge_json "$t" "$f" >/dev/null
assert_eq "force 3-way: overlapping user/fragment element not duplicated" \
  "$(jq -Sc .h "$t")" '[{"a":1},{"b":2}]'

# (s) force 3-way array works through nested objects
rm -f "$t" "$bf"
printf '{"hooks":{"Pre":[{"m":"B"}]}}\n' >"$bf"
printf '{"hooks":{"Pre":[{"m":"B"},{"m":"U"}]}}\n' >"$t"
printf '{"hooks":{"Pre":[{"m":"B"},{"m":"W"}]}}\n' >"$f"
merge_json "$t" "$f" >/dev/null
assert_eq "force 3-way: nested array preserves user-added element" \
  "$(jq -Sc .hooks.Pre "$t")" '[{"m":"B"},{"m":"W"},{"m":"U"}]'

rm -f "$t" "$bf"

FORCE=0

# --- json_merge.sh: _json_eq -----------------------------------------------

printf '{"b":2,"a":1}\n' >"$t"
expect_true "_json_eq is key-order insensitive" _json_eq '{"a":1,"b":2}' "$t"
expect_false "_json_eq detects a difference" _json_eq '{"a":1,"b":3}' "$t"
expect_false "_json_eq is false for a missing file" _json_eq '{"a":1}' "$WORK/none.json"

# --- common.sh: atomic_write -----------------------------------------------

rm -f "$WORK/aw"
printf 'new\n' >"$WORK/aw.tmp"
atomic_write "$WORK/aw.tmp" "$WORK/aw"
assert_eq "atomic_write renames the temp onto the target" \
  "$(cat "$WORK/aw")" "new"
assert_eq "atomic_write consumes the temp file" \
  "$([ -e "$WORK/aw.tmp" ] && echo yes || echo no)" "no"

# A bind-mounted target refuses rename (EBUSY) but accepts a write through the
# inode. Force that path by making mv fail, and check the target keeps its inode.
printf 'old\n' >"$WORK/aw"
_aw_ino_before=$(stat -c %i "$WORK/aw")
printf 'replaced\n' >"$WORK/aw.tmp"
mv() { return 1; }
atomic_write "$WORK/aw.tmp" "$WORK/aw"
unset -f mv 2>/dev/null || unalias mv 2>/dev/null || true
assert_eq "atomic_write falls back to copying when rename fails" \
  "$(cat "$WORK/aw")" "replaced"
assert_eq "the fallback writes through the existing inode" \
  "$(stat -c %i "$WORK/aw")" "$_aw_ino_before"
assert_eq "the fallback still consumes the temp file" \
  "$([ -e "$WORK/aw.tmp" ] && echo yes || echo no)" "no"

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

# --- toml_merge.sh (skipped when python3 >= 3.9 unavailable) ----------------

# tj <file> <jq-filter> — read a value out of a TOML file via the python bridge.
tj() { _toml_to_json "$1" | jq -r "$2"; }

if _toml_available; then

  tf="$WORK/frag.toml"
  tt="$WORK/target.toml"

  # (a) merge into absent target materializes the fragment as TOML
  rm -f "$tt"
  printf '[features]\nhooks = true\n' >"$tf"
  merge_toml "$tt" "$tf" >/dev/null
  assert_eq "toml: merge into absent target materializes the fragment" \
    "$(tj "$tt" .features.hooks)" "true"

  # (b) existing target value wins over the fragment
  printf '[features]\nhooks = false\nmodel = "o3"\n' >"$tt"
  printf '[features]\nhooks = true\n' >"$tf"
  merge_toml "$tt" "$tf" >/dev/null
  assert_eq "toml: existing target value wins over the fragment" \
    "$(tj "$tt" .features.hooks)" "false"
  assert_eq "toml: target-only key is preserved" \
    "$(tj "$tt" .features.model)" "o3"

  # (c) fragment adds new keys to existing target
  printf '[features]\nhooks = true\n' >"$tt"
  printf '[mcp]\ncommand = "ctx"\n' >"$tf"
  merge_toml "$tt" "$tf" >/dev/null
  assert_eq "toml: fragment adds new keys to existing target" \
    "$(tj "$tt" .mcp.command)" "ctx"
  assert_eq "toml: existing keys survive after new key addition" \
    "$(tj "$tt" .features.hooks)" "true"

  # (d) status mode reports drift (fragment adds a key the target lacks)
  printf '[features]\nhooks = true\n' >"$tt"
  printf '[features]\nhooks = true\n[mcp]\ncommand = "ctx"\n' >"$tf"
  MODE=status
  out=$(merge_toml "$tt" "$tf" 2>&1)
  MODE=install
  case "$out" in
    *drift*) ok "toml: status mode reports drift" ;;
    *) ng "toml: status mode should report drift (got: $out)" ;;
  esac

  # (e) status mode reports in-sync
  printf '[features]\nhooks = true\n' >"$tt"
  printf '[features]\nhooks = true\n' >"$tf"
  MODE=status
  out=$(merge_toml "$tt" "$tf" 2>&1)
  MODE=install
  case "$out" in
    *in-sync*) ok "toml: status mode reports in-sync" ;;
    *) ng "toml: status mode should report in-sync (got: $out)" ;;
  esac

  # (f) already-quoted special-char table key round-trips
  printf '[projects."/home/u/proj"]\ntrust = "high"\n' >"$tf"
  rm -f "$tt"
  merge_toml "$tt" "$tf" >/dev/null
  assert_eq "toml: special-char table key round-trips" \
    "$(tj "$tt" '.projects["/home/u/proj"].trust')" "high"

  # (g) an unquoted '/' path header parses, merges, and is emitted quoted
  # (the spec-valid form codex's reader requires)
  printf '[features]\nhooks = true\n' >"$tf"
  printf '[projects./home/u/proj]\ntrust = "high"\n' >"$tt"
  merge_toml "$tt" "$tf" >/dev/null
  assert_eq "toml: unquoted '/' path key is preserved through merge" \
    "$(tj "$tt" '.projects["/home/u/proj"].trust')" "high"
  assert_eq "toml: the new fragment key is merged in" \
    "$(tj "$tt" .features.hooks)" "true"
  if grep -q '^\[projects\."/home/u/proj"\]$' "$tt"; then
    ok "toml: '/' header is written back quoted (spec-valid for codex)"
  else
    ng "toml: '/' header should be quoted (got: $(grep projects "$tt"))"
  fi

  # (h) comments and unrelated keys survive a merge verbatim
  printf '# keep me\n[features]\nhooks = true # trailing\nnote = "x"\n' >"$tt"
  printf '[mcp]\ncommand = "ctx"\n' >"$tf"
  merge_toml "$tt" "$tf" >/dev/null
  if grep -q '# keep me' "$tt" && grep -q '# trailing' "$tt"; then
    ok "toml: comments survive the merge"
  else
    ng "toml: comments should survive (got: $(cat "$tt"))"
  fi
  assert_eq "toml: unrelated key survives the merge" \
    "$(tj "$tt" .features.note)" "x"

  # (j) codex super-table: add bare [tui] keys where only [tui.sub] exists
  printf '[tui]\nstatus_line = ["model"]\n' >"$tf"
  printf '[projects./home/u/p]\ntrust = "t"\n[tui.model_availability_nux]\ngpt-5.5 = 1\n' >"$tt"
  merge_toml "$tt" "$tf" >/dev/null
  assert_eq "toml: bare [tui] key is added alongside an existing [tui.sub]" \
    "$(tj "$tt" '.tui.status_line[0]')" "model"
  # the brain sees the dotted key as nested (gpt-5.5 => gpt-5.5); what matters is
  # the on-disk line below stays verbatim, which the next check asserts.
  assert_eq "toml: the existing [tui.sub] table survives" \
    "$(tj "$tt" '.tui.model_availability_nux["gpt-5"]["5"]')" "1"
  if grep -q '^gpt-5.5 = 1$' "$tt"; then
    ok "toml: sub-table's dotted key stays verbatim (not split)"
  else
    ng "toml: 'gpt-5.5 = 1' should stay verbatim (got: $(grep gpt "$tt"))"
  fi

  # (i) a genuinely malformed target is skipped with a warning, not fatal
  printf '[features]\nhooks = true\n' >"$tf"
  printf 'broken = "unterminated\n' >"$tt"
  out=$(merge_toml "$tt" "$tf" 2>&1)
  rc=$?
  case "$out" in
    *skipping*) ok "toml: malformed target is skipped, not fatal" ;;
    *) ng "toml: malformed target should skip (got: $out)" ;;
  esac
  assert_eq "toml: skip returns success" "$rc" "0"

  # (k) status mode still emits a drift line for an unparseable target
  printf '[features]\nhooks = true\n' >"$tf"
  printf 'broken = "unterminated\n' >"$tt"
  MODE=status
  out=$(merge_toml "$tt" "$tf" 2>&1)
  MODE=install
  case "$out" in
    *drift*) ok "toml: status reports drift for an unparseable target" ;;
    *) ng "toml: status should report drift for unparseable (got: $out)" ;;
  esac

  # (l) an array of inline tables round-trips (not stringified)
  rm -f "$tt"
  printf 'folders = [{ path = "." }, { path = "/x" }]\n' >"$tf"
  merge_toml "$tt" "$tf" >/dev/null
  assert_eq "toml: array of inline tables round-trips" \
    "$(tj "$tt" '.folders[1].path')" "/x"

  rm -f "$tf" "$tt"

else
  printf '  skip - toml_merge tests (python3 >= 3.9 not available)\n'
fi

# --- summary ---------------------------------------------------------------

printf '\n%s test(s), %s failure(s)\n' "$TESTS" "$FAILS"
[ "$FAILS" -eq 0 ]
