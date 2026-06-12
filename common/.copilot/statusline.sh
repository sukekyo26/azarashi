#!/usr/bin/env bash
# Copilot CLI statusLine — reads session JSON on stdin, prints a single line.
# Wire up in ~/.copilot/settings.json:
#   "statusLine": { "type": "command", "command": "bash ~/.copilot/statusline.sh" }

set -u

input=$(cat)

# current_context_* はモデルバッジ / /context と同じ表示系の値。
# 旧バージョンの CLI 向けに used_percentage / context_window_size へフォールバックする。
ctx_pct=$(jq -r '.context_window.current_context_used_percentage // .context_window.used_percentage // empty' <<<"$input" 2>/dev/null)
ctx_used=$(jq -r '.context_window.current_context_tokens // empty' <<<"$input" 2>/dev/null)
ctx_limit=$(jq -r '.context_window.displayed_context_limit // .context_window.context_window_size // empty' <<<"$input" 2>/dev/null)

C_OK=$'\e[1;32m'
C_WARN=$'\e[1;33m'
C_DANGER=$'\e[1;31m'
C_DIM=$'\e[2m'
C_RESET=$'\e[0m'

fmt_tokens() {
  local n=$1
  if ((n >= 1000000)); then
    printf '%d.%dM' $((n / 1000000)) $((n % 1000000 / 100000))
  elif ((n >= 1000)); then
    printf '%d.%dk' $((n / 1000)) $((n % 1000 / 100))
  else
    printf '%d' "$n"
  fi
}

if [[ -z "$ctx_pct" ]]; then
  printf '%sctx ░░░░░░░░░░ --%% (waiting for session data)%s\n' "$C_DIM" "$C_RESET"
  exit 0
fi

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

tokens_segment=""
if [[ "$ctx_used" =~ ^[0-9]+$ && "$ctx_limit" =~ ^[0-9]+$ ]]; then
  tokens_segment=" ${C_DIM}($(fmt_tokens "$ctx_used")/$(fmt_tokens "$ctx_limit"))${C_RESET}"
fi

printf 'ctx %s%s%s%s%s %s%d%%%s%s\n' \
  "$bar_color" "$fill_str" "$C_DIM" "$empty_str" "$C_RESET" \
  "$bar_color" "$pct_int" "$C_RESET" "$tokens_segment"
