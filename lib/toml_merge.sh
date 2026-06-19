# TOML fragment merge — thin wrapper around json_merge.sh.
# Converts TOML ↔ JSON at the boundary, reuses the existing jq-based merge.
# Sourced by install.sh AFTER json_merge.sh.
# Requires: tomlq (TOML→JSON), python3 + toml module (JSON→TOML).

# _toml_available — true if both conversion tools are present.
_toml_available() {
  command -v tomlq >/dev/null 2>&1 && python3 -c 'import toml' 2>/dev/null
}

# _json_to_toml — read JSON from stdin, write TOML to stdout.
_json_to_toml() {
  python3 -c 'import toml,json,sys;toml.dump(json.load(sys.stdin),sys.stdout)'
}

# merge_toml <target.toml> <frag1.toml> [frag2.toml ...]
# Same semantics as merge_json but for TOML files.
# shellcheck disable=SC2086  # _mt_cleanup/_mt_json_frags are intentionally word-split
merge_toml() {
  _toml_available || {
    warn "tomlq/python3-toml not found, skipping TOML merge: $1"
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
    tomlq . "$_mt_f" >"$_mt_jtmp" || {
      rm -f $_mt_cleanup
      die "TOML parse failed: $_mt_f"
    }
    _mt_json_frags="$_mt_json_frags $_mt_jtmp"
  done

  # Convert target TOML to temp JSON (or leave nonexistent for _merge_chain).
  _mt_json_target=$(mktemp) || die "mktemp failed"
  _mt_cleanup="$_mt_cleanup $_mt_json_target"
  if [ -f "$_mt_real_target" ]; then
    tomlq . "$_mt_real_target" >"$_mt_json_target" || {
      rm -f $_mt_cleanup
      die "TOML parse failed: $_mt_real_target"
    }
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
  mkdir -p "$(dirname "$_mt_real_target")" || die "mkdir failed: $_mt_real_target"
  backup "$_mt_real_target"
  _mt_tmp=$(mktemp "${_mt_real_target}.dotfiles-tmp.XXXXXX") || die "mktemp failed"
  if ! printf '%s' "$_mt_result" | _json_to_toml >"$_mt_tmp" 2>/dev/null; then
    rm -f "$_mt_tmp" $_mt_cleanup
    die "JSON-to-TOML conversion failed: $_mt_real_target"
  fi
  mv "$_mt_tmp" "$_mt_real_target" || die "atomic move failed: $_mt_real_target"
  info "merged  : $_mt_real_target"

  [ "$FORCE" -eq 1 ] && _save_base $_mt_json_frags
  rm -f $_mt_cleanup
}
