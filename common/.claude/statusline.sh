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
effort=$(jq -r '.effort.level // empty' <<<"$input")
thinking=$(jq -r '.thinking.enabled // false' <<<"$input")
worktree=$(jq -r '.workspace.git_worktree // empty' <<<"$input")
version=$(jq -r '.version // empty' <<<"$input")
cache_read=$(jq -r '.context_window.current_usage.cache_read_input_tokens // 0' <<<"$input")
cache_create=$(jq -r '.context_window.current_usage.cache_creation_input_tokens // 0' <<<"$input")
session_id=$(jq -r '.session_id // empty' <<<"$input")
transcript=$(jq -r '.transcript_path // empty' <<<"$input")

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

meta_segment=""
[[ -n "$effort" && "$effort" != "null" ]] && meta_segment=" ${C_DIM}${effort}${C_RESET}"
[[ "$thinking" == "true" ]] && meta_segment="${meta_segment} ${C_DIM}🧠${C_RESET}"

# Prompt-cache health: read/(read+create) ratio for the last turn. A sharp
# drop (red) means the prefix changed and the cache was rebuilt this turn.
cache_segment=""
total_cache=$((cache_read + cache_create))
if ((total_cache > 0)); then
  hit=$((cache_read * 100 / total_cache))
  if ((hit >= 90)); then
    cache_color=$C_OK
  elif ((hit >= 50)); then
    cache_color=$C_WARN
  else
    cache_color=$C_DANGER
  fi
  cache_segment=" ${C_DIM}cache${C_RESET} ${cache_color}${hit}%${C_RESET}"
fi

# Cache TTL countdown — how long the prompt cache stays warm after the last API
# request (which resets the timer). Anchor on the last assistant turn's timestamp,
# NOT the file mtime: Claude Code appends mode/permission-mode bookkeeping lines on
# session resume (claude --continue), bumping mtime to "now" without any request
# having warmed the cache — that would falsely restart the countdown at 5:00.
# TTL: STATUSLINE_CACHE_TTL overrides; FORCE_PROMPT_CACHING_5M pins 5m;
# ENABLE_PROMPT_CACHING_1H opts into 1h; otherwise 5m.
cache_ttl_segment=""
if [[ -r "$transcript" ]]; then
  if [[ -n "${STATUSLINE_CACHE_TTL:-}" ]]; then
    ttl=$STATUSLINE_CACHE_TTL
  elif [[ "${FORCE_PROMPT_CACHING_5M:-}" == "1" ]]; then
    ttl=300
  elif [[ "${ENABLE_PROMPT_CACHING_1H:-}" == "1" ]]; then
    ttl=3600
  else
    ttl=300
  fi
  # Classify the cache state from the transcript tail (newest compact_boundary
  # vs newest assistant turn):
  #   warm <ts> — an assistant turn (the API request that warmed the cache) is
  #               the most recent of the two; count TTL down from its timestamp.
  #   compact   — a /compact boundary is newer, with no assistant turn after it.
  #               /compact swaps the messages prefix for a summary, so the next
  #               request rebuilds the conversation cache (tools/system survive,
  #               messages do not). Flag it instead of counting down a cache that
  #               no longer matches — and it guards against /new'ing it away.
  #   none      — no assistant turn at all (e.g. right after /new): nothing has
  #               warmed the cache, so show nothing rather than a bogus timer.
  IFS=$'\t' read -r cache_state last_req <<<"$(tail -n 200 "$transcript" 2>/dev/null | jq -rs '
    (([.[] | (.type == "system" and .subtype == "compact_boundary")] | rindex(true)) // -1) as $cb
    | (([.[] | (.type == "assistant" and (.timestamp != null))] | rindex(true)) // -1) as $at
    | if $cb > $at then "compact\t"
      elif $at >= 0 then "warm\t" + .[$at].timestamp
      else "none\t" end' 2>/dev/null)"
  if [[ "$cache_state" == "compact" ]]; then
    cache_ttl_segment=" ${C_WARN}📦compact${C_RESET}"
    cache_segment="" # compact: messages cache is rebuilt next turn, pre-compact hit% is stale
  elif [[ -n "$last_req" ]]; then
    last_req=$(date -d "$last_req" +%s 2>/dev/null || echo 0)
    remaining=$((ttl - ($(date +%s) - last_req)))
    if ((remaining > 0)); then
      ((remaining <= 60)) && ttl_color=$C_WARN || ttl_color=$C_OK
      cache_ttl_segment=$(printf ' %s⏳%d:%02d%s' "$ttl_color" "$((remaining / 60))" "$((remaining % 60))" "$C_RESET")
    else
      cache_ttl_segment=" ${C_DANGER}❄cold${C_RESET}"
      cache_segment="" # cold: the per-turn hit% is a pre-idle snapshot, drop it
    fi
  fi
fi

worktree_tag=""
[[ -n "$worktree" ]] && worktree_tag=" ${C_DIM}⑂${worktree}${C_RESET}"
version_tag=""
[[ -n "$version" ]] && version_tag=" ${C_DIM}v${version}${C_RESET}"

# Stack three lines so the bar stays readable in a narrow terminal:
# 1) project (cwd + branch + lines changed), 2) model + context + cost + cache,
# 3) context-mode. The +/- edit counts sit with the branch as a git-style diff stat.
printf '%s%s%s' "$C_DIR" "$cwd_short" "$C_RESET"
[[ -n "$branch" ]] && printf ' %s(%s)%s%s' "$C_BRANCH" "$branch" "$C_RESET" "$worktree_tag"
printf ' %s+%s%s/%s-%s%s\n' "$C_OK" "$added" "$C_RESET" "$C_DANGER" "$removed" "$C_RESET"

printf '%s%s%s%s%s%s %s$%.3f%s%s%s%s\n' \
  "$C_MODEL" "$model" "$C_RESET" "$style_tag" "$meta_segment" "$ctx_segment" \
  "$C_COST" "$cost" "$C_RESET" \
  "$cache_segment" "$cache_ttl_segment" "$version_tag"

# context-mode status line (3rd line). Reuse the plugin's own renderer so our
# numbers never drift from `ctx_stats`; degrade silently when absent. The plugin
# disables ANSI when stdout isn't a TTY (as here), so colorize its output
# ourselves: brand the label and tint the status dot.
#
# Prefer the npm-global `context-mode` CLI: it ships the compiled build/ that the
# plugin's git checkout omits (.gitignore'd), so its renderer reports real
# savings instead of the static "~98%" fallback. Fall back to the plugin-cache
# renderer (node on the bundled mjs) when the global CLI isn't installed.
ctxmode_out=""
if command -v context-mode >/dev/null 2>&1; then
  ctxmode_out=$(CLAUDE_SESSION_ID="$session_id" context-mode statusline <<<"$input" 2>/dev/null)
elif command -v node >/dev/null 2>&1; then
  ctxmode_mjs="" # newest cached renderer by mtime; sort -V isn't portable to BSD/BusyBox
  for _m in "$HOME"/.claude/plugins/cache/context-mode/context-mode/*/bin/statusline.mjs; do
    [[ -f "$_m" ]] || continue
    [[ -z "$ctxmode_mjs" || "$_m" -nt "$ctxmode_mjs" ]] && ctxmode_mjs="$_m"
  done
  [[ -f "$ctxmode_mjs" ]] && ctxmode_out=$(CLAUDE_SESSION_ID="$session_id" node "$ctxmode_mjs" <<<"$input" 2>/dev/null)
fi
if [[ -n "$ctxmode_out" ]]; then
  ctxmode_out=${ctxmode_out//  / } # tighten the plugin's 2-space separators
  ctxmode_out=${ctxmode_out//context-mode/${C_MODEL}context-mode${C_RESET}}
  ctxmode_out=${ctxmode_out//●/${C_OK}●${C_RESET}}
  printf '%s' "$ctxmode_out"
fi
