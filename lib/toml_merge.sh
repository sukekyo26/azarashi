# TOML fragment merge — thin wrapper around json_merge.sh.
# Converts TOML <-> JSON at the boundary via a vendored tomlkit (lib/toml_merge.py)
# and reuses the existing jq-based merge. tomlkit makes the write comment- and
# format-preserving and tolerates codex's unquoted '/' path keys.
# Sourced by install.sh AFTER json_merge.sh.
# Requires: python3 (tomlkit is vendored under lib/vendor/), jq.

# _toml_lib_dir — the lib/ dir holding toml_merge.py, resolved from whichever
# entrypoint sourced us (install.sh sets REPO_DIR; test/run.sh sets SCRIPT_DIR).
_toml_lib_dir() {
  if [ -n "${REPO_DIR:-}" ]; then
    printf '%s/lib' "$REPO_DIR"
  elif [ -n "${SCRIPT_DIR:-}" ]; then
    printf '%s/../lib' "$SCRIPT_DIR"
  else
    printf 'lib'
  fi
}

_TOML_PY="$(_toml_lib_dir)/toml_merge.py"

# Minimum Python the vendored tomlkit supports (its Requires-Python is >=3.9).
_TOML_MIN_PY="3.9"

# _toml_python_ok — true if python3 exists and is new enough for tomlkit.
_toml_python_ok() {
  command -v python3 >/dev/null 2>&1 &&
    python3 -c 'import sys; sys.exit(0 if sys.version_info[:2] >= (3, 9) else 1)' 2>/dev/null
}

# _toml_available — true if the python bridge can run.
_toml_available() {
  _toml_python_ok && [ -f "$_TOML_PY" ]
}

# _toml_to_json <file> — parse TOML to JSON on stdout (nonzero on parse error).
_toml_to_json() {
  python3 "$_TOML_PY" to-json "$1"
}

# merge_toml <target.toml> <frag1.toml> [frag2.toml ...]
# Same semantics as merge_json but for TOML files.
# shellcheck disable=SC2086  # _mt_cleanup/_mt_json_frags are intentionally word-split
merge_toml() {
  _toml_available || {
    warn "python3 >= $_TOML_MIN_PY not found (needed by the vendored tomlkit), skipping TOML merge: $1"
    return 0
  }

  _mt_real_target=$1
  shift
  _mt_orig_frags="$*"
  _mt_cleanup=""
  _mt_json_frags=""

  # Convert each TOML fragment to a temp JSON file.
  for _mt_f in "$@"; do
    _mt_jtmp=$(mktemp) || die "mktemp failed"
    _mt_cleanup="$_mt_cleanup $_mt_jtmp"
    _toml_to_json "$_mt_f" >"$_mt_jtmp" || {
      rm -f $_mt_cleanup
      die "TOML parse failed: $_mt_f"
    }
    _mt_json_frags="$_mt_json_frags $_mt_jtmp"
  done

  # Convert target TOML to temp JSON (or leave nonexistent for _merge_chain).
  _mt_json_target=$(mktemp) || die "mktemp failed"
  _mt_cleanup="$_mt_cleanup $_mt_json_target"
  if [ -f "$_mt_real_target" ]; then
    if ! _toml_to_json "$_mt_real_target" >"$_mt_json_target" 2>/dev/null; then
      warn "TOML parse failed (non-standard syntax?), skipping merge: $_mt_real_target"
      # Still emit a status line so `status` stays uniform/script-friendly.
      [ "$MODE" = status ] && info "drift   : $_mt_real_target"
      rm -f $_mt_cleanup
      return 0
    fi
  else
    rm -f "$_mt_json_target"
  fi

  # shellcheck disable=SC2034  # BASE_FILE/_mj_target consumed by json_merge.sh
  BASE_FILE="${_mt_real_target%.toml}.fragment.base.json"
  _mj_target=$_mt_json_target

  _mt_result=$(_merge_chain "$_mt_json_target" $_mt_json_frags) || {
    rm -f $_mt_cleanup
    exit 1
  }

  # --- status ---
  if [ "$MODE" = status ]; then
    if [ ! -f "$_mt_real_target" ]; then
      info "missing : $_mt_real_target"
    elif [ -f "$_mt_json_target" ] && _json_eq "$_mt_result" "$_mt_json_target"; then
      info "in-sync : $_mt_real_target"
    else
      info "drift   : $_mt_real_target"
    fi
    rm -f $_mt_cleanup
    return 0
  fi

  # --- convergence ---
  if [ -f "$_mt_json_target" ] && _json_eq "$_mt_result" "$_mt_json_target"; then
    info "in-sync : $_mt_real_target"
    [ "$FORCE" -eq 1 ] && [ "$DRY_RUN" -ne 1 ] && _save_base $_mt_json_frags
    rm -f $_mt_cleanup
    return 0
  fi

  # --- dry-run ---
  if [ "$DRY_RUN" -eq 1 ]; then
    if [ "$FORCE" -eq 1 ]; then
      printf '  [dry-run] merge (force: fragment overwrites target) %s -> %s\n' \
        "$_mt_orig_frags" "$_mt_real_target"
      _show_changed_keys 1 $_mt_json_frags
      _show_deleted_keys $_mt_json_frags
    else
      printf '  [dry-run] merge %s -> %s\n' "$_mt_orig_frags" "$_mt_real_target"
      _show_changed_keys 0 $_mt_json_frags
    fi
    rm -f $_mt_cleanup
    return 0
  fi

  # --- write ---
  # Apply the merged JSON onto the original document so comments/formatting of
  # untouched keys survive: pass the live target as <orig> ('-' when absent).
  mkdir -p "$(dirname "$_mt_real_target")" || die "mkdir failed: $_mt_real_target"
  _mt_mjson=$(mktemp) || die "mktemp failed"
  _mt_cleanup="$_mt_cleanup $_mt_mjson"
  printf '%s' "$_mt_result" >"$_mt_mjson" || die "write failed: $_mt_mjson"
  _mt_orig='-'
  _mt_tgt_json='-'
  if [ -f "$_mt_real_target" ]; then
    _mt_orig=$_mt_real_target
    _mt_tgt_json=$_mt_json_target
  fi
  backup "$_mt_real_target"
  _mt_tmp=$(mktemp "${_mt_real_target}.dotfiles-tmp.XXXXXX") || die "mktemp failed"
  if ! python3 "$_TOML_PY" apply "$_mt_orig" "$_mt_tgt_json" "$_mt_mjson" >"$_mt_tmp" 2>/dev/null; then
    rm -f "$_mt_tmp" $_mt_cleanup
    die "JSON-to-TOML conversion failed: $_mt_real_target"
  fi
  mv "$_mt_tmp" "$_mt_real_target" || die "atomic move failed: $_mt_real_target"
  info "merged  : $_mt_real_target"

  [ "$FORCE" -eq 1 ] && _save_base $_mt_json_frags
  rm -f $_mt_cleanup
}
