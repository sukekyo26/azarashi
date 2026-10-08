#!/usr/bin/env bash
# Apply repo_settings.json, then develop_ruleset.json / main_ruleset.json (all next to
# this script) to a GitHub repository.
set -euo pipefail

usage() {
  cat <<'EOF'
Usage: apply.sh [--repo OWNER/REPO] [--check NAME]... [--force] [--dry-run]

  --repo     target repository (default: the repository of the current directory)
  --check    required status check name, repeated per check. Without any, the
             required_status_checks rule is left out: a required check that never
             reports would block every merge
  --force    overwrite rulesets that already exist under the same name (the
             repository settings are always written; they are absolute values)
  --dry-run  print the payloads (settings first, then each ruleset) instead of
             calling the API
EOF
}

die() {
  printf 'apply.sh: %s\n' "$*" >&2
  exit 1
}

DIR=$(dirname -- "${BASH_SOURCE[0]}")
repo=
force=0
dry_run=0
checks=()
while [ $# -gt 0 ]; do
  case $1 in
    --repo | --check)
      [ $# -ge 2 ] || die "$1 needs a value"
      if [ "$1" = --repo ]; then repo=$2; else checks+=("$2"); fi
      shift 2
      ;;
    --force) force=1 && shift ;;
    --dry-run) dry_run=1 && shift ;;
    -h | --help) usage && exit 0 ;;
    *) usage >&2 && die "unknown argument: $1" ;;
  esac
done

checks_json=$(jq -nc '$ARGS.positional | map({context: .})' --args "${checks[@]}")

payload() { # <template>
  jq --argjson checks "$checks_json" '
    if ($checks | length) == 0 then .rules |= map(select(.type != "required_status_checks"))
    else (.rules[] | select(.type == "required_status_checks") | .parameters.required_status_checks) = $checks
    end' "$1"
}

if [ "$dry_run" = 1 ]; then
  jq . "$DIR/repo_settings.json"
  for tpl in "$DIR/develop_ruleset.json" "$DIR/main_ruleset.json"; do payload "$tpl"; done
  exit 0
fi

if [ -z "$repo" ]; then
  repo=$(gh repo view --json nameWithOwner -q .nameWithOwner) ||
    die "not inside a GitHub repository; pass --repo OWNER/REPO"
fi
[ ${#checks[@]} -gt 0 ] ||
  printf 'apply.sh: no --check given; applying without required status checks\n' >&2

# Settings first: the rulesets' allowed merge methods must be enabled on the repository.
gh api -X PATCH "repos/$repo" --input "$DIR/repo_settings.json" >/dev/null ||
  die "could not update the settings of $repo (see the gh error above)"
printf 'updated: repository settings on %s\n' "$repo"

for tpl in "$DIR/develop_ruleset.json" "$DIR/main_ruleset.json"; do
  name=$(jq -r .name "$tpl")
  id=$(gh api "repos/$repo/rulesets" --jq ".[] | select(.name == \"$name\") | .id")
  if [ -n "$id" ] && [ "$force" = 0 ]; then
    printf 'skip: %s already exists on %s (pass --force to overwrite)\n' "$name" "$repo"
    continue
  fi
  if [ -n "$id" ]; then
    method=PUT path="repos/$repo/rulesets/$id" done_msg=updated
  else
    method=POST path="repos/$repo/rulesets" done_msg=created
  fi
  payload "$tpl" | gh api -X "$method" "$path" --input - >/dev/null ||
    die "could not apply $name to $repo (see the gh error above)"
  printf '%s: %s on %s\n' "$done_msg" "$name" "$repo"
done
