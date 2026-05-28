#!/usr/bin/env bash
# Claude Code statusLine — reads session JSON on stdin, prints a single line.
# Wire up in ~/.claude/settings.json:
#   "statusLine": { "type": "command", "command": "bash ~/.claude/statusline.sh", "padding": 0 }

set -u

input=$(cat)

model=$(jq -r '.model.display_name // "?"' <<<"$input")
cwd=$(jq -r '.workspace.current_dir // ""' <<<"$input")
cost=$(jq -r '.cost.total_cost_usd // 0' <<<"$input")
added=$(jq -r '.cost.total_lines_added // 0' <<<"$input")
removed=$(jq -r '.cost.total_lines_removed // 0' <<<"$input")
ctx_pct=$(jq -r '.context_window.used_percentage // empty' <<<"$input")
style=$(jq -r '.output_style.name // ""' <<<"$input")

cwd_short="${cwd/#$HOME/'~'}"
branch=$(git -C "$cwd" branch --show-current 2>/dev/null)

C_MODEL=$'\e[1;36m'
C_DIR=$'\e[33m'
C_BRANCH=$'\e[32m'
C_COST=$'\e[35m'
C_OK=$'\e[1;32m'
C_WARN=$'\e[1;33m'
C_DANGER=$'\e[1;31m'
C_DIM=$'\e[2m'
C_RESET=$'\e[0m'

style_tag=""
if [[ -n "$style" && "$style" != "default" ]]; then
  style_tag=" ${C_DIM}{$style}${C_RESET}"
fi

ctx_segment=""
if [[ -n "$ctx_pct" ]]; then
  pct_int=${ctx_pct%%.*}
  [[ "$pct_int" =~ ^[0-9]+$ ]] || pct_int=0
  ((pct_int > 100)) && pct_int=100

  bar_width=10
  filled=$((pct_int * bar_width / 100))
  ((filled == 0 && pct_int > 0)) && filled=1
  ((filled > bar_width)) && filled=$bar_width
  empty=$((bar_width - filled))

  if ((pct_int >= 80)); then
    bar_color=$C_DANGER
  elif ((pct_int >= 60)); then
    bar_color=$C_WARN
  else
    bar_color=$C_OK
  fi

  fill_str=$(printf '%*s' "$filled" '' | tr ' ' '#')
  empty_str=$(printf '%*s' "$empty" '' | tr ' ' '-')
  fill_str=${fill_str//#/█}
  empty_str=${empty_str//-/░}

  ctx_segment=" ${bar_color}${fill_str}${C_DIM}${empty_str}${C_RESET} ${bar_color}${pct_int}%${C_RESET}"
fi

printf '%s%s%s%s%s | %s%s%s' \
  "$C_MODEL" "$model" "$C_RESET" "$style_tag" "$ctx_segment" \
  "$C_DIR" "$cwd_short" "$C_RESET"
[[ -n "$branch" ]] && printf ' %s(%s)%s' "$C_BRANCH" "$branch" "$C_RESET"
printf ' | %s$%.3f%s %s+%s/-%s%s\n' \
  "$C_COST" "$cost" "$C_RESET" \
  "$C_DIM" "$added" "$removed" "$C_RESET"
