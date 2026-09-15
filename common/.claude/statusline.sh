#!/usr/bin/env bash
# Claude Code statusLine — reads session JSON on stdin, prints two lines (three while a cache miss is shown).
# キャッシュ関連（hit% / miss / TTL / compact）は Claude Code >= 2.1.251 が stdin
# で渡す .prompt_cache から読む（docs/statusline.md）。
# Bedrock 利用時はトランスクリプトの usage を集計して実価格で再計算する（コストに
# "~" が付く）。Anthropic API 直の場合は Claude Code が報告する total_cost_usd を
# そのまま使う。どちらかはトランスクリプトのモデル ID から実行時に判定するので、
# 環境ごとにスクリプトを分ける必要はない。
# Wire up in ~/.claude/settings.json:
#   "statusLine": { "type": "command", "command": "bash ~/.claude/statusline.sh", "padding": 0 }

set -u

input=$(cat)
# STATUSLINE_DEBUG_LOG=<path> appends every stdin payload, to diagnose a segment
# that disagrees with what Claude Code reported (e.g. warm/cold).
[[ -n "${STATUSLINE_DEBUG_LOG:-}" ]] && printf '%s %s\n' "$(date +%FT%T)" "$(jq -c . <<<"$input")" >>"$STATUSLINE_DEBUG_LOG"

model=$(jq -r '.model.display_name // "?"' <<<"$input")
cwd=$(jq -r '.workspace.current_dir // ""' <<<"$input")
cost=$(jq -r '.cost.total_cost_usd // 0' <<<"$input")
added=$(jq -r '.cost.total_lines_added // 0' <<<"$input")
removed=$(jq -r '.cost.total_lines_removed // 0' <<<"$input")
ctx_pct=$(jq -r '.context_window.used_percentage // empty' <<<"$input")
style=$(jq -r '.output_style.name // ""' <<<"$input")
transcript=$(jq -r '.transcript_path // empty' <<<"$input")
effort=$(jq -r '.effort.level // empty' <<<"$input")
thinking=$(jq -r '.thinking.enabled // false' <<<"$input")
worktree=$(jq -r '.workspace.git_worktree // empty' <<<"$input")
version=$(jq -r '.version // empty' <<<"$input")
session_id=$(jq -r '.session_id // empty' <<<"$input")
cache_read=$(jq -r '.context_window.current_usage.cache_read_input_tokens // 0' <<<"$input")
cache_create=$(jq -r '.context_window.current_usage.cache_creation_input_tokens // 0' <<<"$input")

# --- Bedrock cost calculation ---------------------------------------------
# 価格テーブル: Bedrock の Global クロスリージョン推論プロファイル基準
# (USD per 1M tokens)。cache write 5m = input*1.25, 1h = input*2,
# cache read = input*0.1。モデル追加時は下の jq の price() に行を足す。
#
# 料金の確認先 (2026-09-11 に下記で照合済み):
#   Bedrock 料金表   https://aws.amazon.com/bedrock/pricing/
#   モデル別の実額   https://aws.amazon.com/marketplace/pp/prodview-mv6skd5ti2kow
#                    (Opus 4.8 Bedrock Edition。全ディメンションが Global 表記で
#                     $5/$25、cache write $6.25 / $10.00、cache read $0.50)
#   global の 10%安  https://docs.aws.amazon.com/bedrock/latest/userguide/global-cross-region-inference.html
#   jp の +10% 実額  https://aws.amazon.com/jp/blogs/news/amazon-bedrock-now-supports-japan-cross-region-inference/
#                    (Sonnet 4.5 jp = $3.3/$16.5 ← global $3/$15)
#
# 地理プロファイル (jp./us./eu./au./apac.) は Global 比 +10%。比較の基準は
# In-Region ではなく Global である点に注意。In-Region (裸の anthropic.) の
# +10% だけは AWS に明記が無く推定 — 過小評価を避けるため geo と同値にしている。
# 現行世代に無い geo (Opus 5 は us/eu/au のみ) も、将来復活時に無言で ×1.0 と
# なるのを防ぐため regex には残しておくこと。
# shellcheck disable=SC2016  # jq program text, not shell expansion
jq_price_defs='
  def price(m):
    if   (m | test("fable|mythos")) then {i: 10.0, o: 50.0}
    elif (m | test("opus"))         then {i: 5.0,  o: 25.0}
    elif (m | test("sonnet"))       then {i: 3.0,  o: 15.0}
    elif (m | test("haiku"))        then {i: 1.0,  o: 5.0}
    else null end;
  def mult(m):
    if   (m | test("^global\\."))                 then 1.0
    elif (m | test("^(jp|us|eu|au|apac)\\."))     then 1.1
    elif (m | startswith("anthropic."))           then 1.1
    else 1.0 end;
'
cost_mark=""
if [[ -n "$transcript" && -r "$transcript" ]]; then
  size=$(stat -c %s "$transcript" 2>/dev/null || echo 0)
  cache_file="${TMPDIR:-/tmp}/claude-statusline-cost-$(md5sum <<<"$transcript" | cut -d' ' -f1)"

  if [[ -r "$cache_file" ]] && read -r cached_size cached_cost cached_mark <"$cache_file" &&
    [[ "$cached_size" == "$size" ]]; then
    if [[ -n "$cached_mark" ]]; then
      cost=$cached_cost
      cost_mark="~"
    fi
  else
    result=$(jq -rn "$jq_price_defs"'
      [ inputs | select(.message.usage? and .message.id?) ]
      | unique_by(.message.id)
      | map(.message
          | (.model // "") as $m
          | .usage as $u
          | ($u.input_tokens // 0) as $in
          | ($u.output_tokens // 0) as $out
          | ($u.cache_read_input_tokens // 0) as $cr
          | (if $u.cache_creation? then
               [($u.cache_creation.ephemeral_5m_input_tokens // 0),
                ($u.cache_creation.ephemeral_1h_input_tokens // 0)]
             else
               [($u.cache_creation_input_tokens // 0), 0]
             end) as [$c5, $c1]
          | price($m) as $p
          | if $p == null then {cost: 0, bedrock: false}
            else {
              cost: (($in * $p.i + $out * $p.o
                      + $c5 * $p.i * 1.25 + $c1 * $p.i * 2
                      + $cr * $p.i * 0.1) * mult($m) / 1e6),
              bedrock: ($m | contains("anthropic.claude"))
            } end)
      | [(map(.cost) | add // 0), (any(.bedrock))]
      | @tsv
    ' "$transcript" 2>/dev/null)

    if [[ -n "$result" ]]; then
      calc_cost=${result%%$'\t'*}
      is_bedrock=${result##*$'\t'}
      if [[ "$is_bedrock" == "true" ]]; then
        cost=$calc_cost
        cost_mark="~"
      fi
      printf '%s %s %s\n' "$size" "$calc_cost" "$cost_mark" >"$cache_file"
    fi
  fi
fi
# ---------------------------------------------------------------------------

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

# bar <percentage> — a 10-cell gauge with the value, green < 60 <= yellow < 80 <= red.
# Used for the context window and the subscription rate limits.
bar() {
  local pct_int=${1%%.*} bar_width=10 filled empty color fill_str empty_str
  [[ "$pct_int" =~ ^[0-9]+$ ]] || pct_int=0
  ((pct_int > 100)) && pct_int=100
  filled=$((pct_int * bar_width / 100))
  ((filled == 0 && pct_int > 0)) && filled=1
  empty=$((bar_width - filled))
  if ((pct_int >= 80)); then
    color=$C_DANGER
  elif ((pct_int >= 60)); then
    color=$C_WARN
  else
    color=$C_OK
  fi
  fill_str=$(printf '%*s' "$filled" '' | tr ' ' '#')
  empty_str=$(printf '%*s' "$empty" '' | tr ' ' '-')
  printf '%s%s%s%s%s %s%s%%%s' "$color" "${fill_str//#/█}" "$C_DIM" "${empty_str//-/░}" "$C_RESET" "$color" "$pct_int" "$C_RESET"
}

ctx_segment=""
[[ -n "$ctx_pct" ]] && ctx_segment=" $(bar "$ctx_pct")"

# Subscription rate limits (Claude.ai Pro / Max, or a gateway spend limit).
# Absent on Bedrock and API keys, so nothing is shown there. Each window may
# be missing on its own; the 5h reset is a clock, the 7d one a date.
rate_segment=""
for w in five_hour seven_day spend_limit; do
  IFS=$'\t' read -r used resets <<<"$(jq -r --arg w "$w" '.rate_limits[$w] | select(. != null) | [(.used_percentage // 0), (.resets_at // 0)] | @tsv' <<<"$input")"
  [[ -n "$used" ]] || continue
  case $w in
    five_hour) label=5h fmt=%H:%M ;;
    seven_day) label=7d fmt='%m/%d %H:%M' ;;
    *) label=spend fmt='%m/%d' ;;
  esac
  reset_str=""
  ((resets > 0)) && reset_str=" ${C_DIM}($(date -d "@$resets" +"$fmt"))${C_RESET}"
  rate_segment="${rate_segment} ${C_DIM}${label}${C_RESET} $(bar "$used")${reset_str}"
done

meta_segment=""
[[ -n "$effort" && "$effort" != "null" ]] && meta_segment=" ${C_DIM}${effort}${C_RESET}"
[[ "$thinking" == "true" ]] && meta_segment="${meta_segment} ${C_DIM}🧠${C_RESET}"

# --- Prompt cache ----------------------------------------------------------
# Claude Code >= 2.1.251 passes .prompt_cache on stdin (warm / ttl / expires_at
# / misses / last_miss_cause ...), computed from the API's cache token counts
# with a view of the system prompt and tool list that a transcript never has.
# Segments:
#   cache NN%          read/(read+create) of the last turn
#   💥miss $X (cause)  on its own third line: the newest miss, priced, with
#                      Claude Code's own diagnosis (model_changed, tools_changed,
#                      system_prompt_changed ...); kept until the next user
#                      prompt (prompt_id changes) so a tool loop right after the
#                      miss does not wipe it
#   ⏳m:ss (HH:MM:SS)    time until the cached prefix goes cold, and the clock
#   ❄️cold             time it does so / already cold
#   📦compact          messages just rewritten (/compact or tool-result clearing);
#                      the next request rebuilds the conversation cache
# Nothing is shown before the first API response (.prompt_cache absent).
cache_segment=""
cache_ttl_segment=""
miss_line=""
pc=$(jq -c '.prompt_cache // empty' <<<"$input")
if [[ -n "$pc" ]]; then
  IFS=$'\t' read -r pc_warm pc_ttl pc_expires pc_miss_at pc_causes pc_miss_tokens pc_recache_if_cold <<<"$(jq -r '
    [ (.warm // false), (.ttl // "5m"), (.expires_at // 0), (.last_miss_at // 0),
      ((.last_miss_cause.causes // []) | join("+") | if . == "" then "-" else . end),
      (.miss_recache_tokens // 0), (.recache_tokens_if_cold // "null") ] | @tsv' <<<"$pc")"

  if ((cache_read + cache_create > 0)); then
    hit=$((cache_read * 100 / (cache_read + cache_create)))
    if ((hit >= 90)); then
      cache_color=$C_OK
    elif ((hit >= 50)); then
      cache_color=$C_WARN
    else
      cache_color=$C_DANGER
    fi
    cache_segment=" ${C_DIM}cache${C_RESET} ${cache_color}${hit}%${C_RESET}"
  fi

  # The newest miss: miss_recache_tokens is cumulative, so the tokens this miss
  # re-cached are its delta from the total at the previous miss, kept in a
  # per-session state file together with the prompt_id the miss happened in.
  if ((pc_miss_at > 0)); then
    prompt_id=$(jq -r '.prompt_id // ""' <<<"$input")
    miss_state="${TMPDIR:-/tmp}/claude-statusline-miss-$(md5sum <<<"${session_id:-$transcript}" | cut -d' ' -f1)"
    # A truncated or hand-edited state file is treated as no state at all.
    read -r s_miss_at s_prompt s_tokens s_total 2>/dev/null <"$miss_state" &&
      [[ "$s_tokens" =~ ^[0-9]+$ && "$s_total" =~ ^[0-9]+$ ]] ||
      { s_miss_at=0 s_prompt="" s_tokens=0 s_total=0; }
    if [[ "$s_miss_at" != "$pc_miss_at" ]]; then
      # A lower cumulative total than last stored (session stats reset, or a
      # stale/reused state file) means the baseline is unknown: treat the
      # whole reported total as this miss rather than show a negative price.
      s_tokens=$((pc_miss_tokens > s_total ? pc_miss_tokens - s_total : pc_miss_tokens))
      s_prompt=$prompt_id
      printf '%s %s %s %s\n' "$pc_miss_at" "$prompt_id" "$s_tokens" "$pc_miss_tokens" >"$miss_state"
    fi
    if [[ "$s_prompt" == "$prompt_id" ]]; then
      model_id=$(jq -r '.model.id // ""' <<<"$input")
      miss_usd=$(jq -n --arg m "$model_id" --arg t "$pc_ttl" --argjson n "$s_tokens" "$jq_price_defs"'
        (price($m) // {i: 0}).i * mult($m) * (if $t == "1h" then 2 else 1.25 end) * $n / 1e6')
      miss_line=$(printf '%s💥miss $%.2f%s%s' "$C_DANGER" "$miss_usd" \
        "$([[ "$pc_causes" != "-" ]] && printf ' (%s)' "$pc_causes")" "$C_RESET")
    fi
  fi

  # Cold wins over compact: recache_tokens_if_cold stays null until the next
  # request, so a session left idle after a compaction would otherwise show
  # 📦compact past its expiry.
  if [[ "$pc_warm" == "true" ]] && ((pc_expires > 0)); then
    remaining=$((pc_expires - $(date +%s)))
    if ((remaining <= 0)); then
      cache_ttl_segment=" ${C_DANGER}❄️cold${C_RESET}"
    elif [[ "$pc_recache_if_cold" == "null" ]]; then
      cache_ttl_segment=" ${C_WARN}📦compact${C_RESET}"
    else
      ((remaining <= 60)) && ttl_color=$C_WARN || ttl_color=$C_OK
      cache_ttl_segment=$(printf ' %s⏳%d:%02d (%s)%s' "$ttl_color" "$((remaining / 60))" "$((remaining % 60))" \
        "$(date -d "@$pc_expires" +%H:%M:%S)" "$C_RESET")
    fi
  elif [[ "$(jq -r '.caching_observed // false' <<<"$pc")" == "true" ]]; then
    cache_ttl_segment=" ${C_DANGER}❄️cold${C_RESET}"
  fi
fi

worktree_tag=""
[[ -n "$worktree" ]] && worktree_tag=" ${C_DIM}⑂${worktree}${C_RESET}"
version_tag=""
[[ -n "$version" ]] && version_tag=" ${C_DIM}v${version}${C_RESET}"

# Stack the lines so the bar stays readable in a narrow terminal:
# 1) project (cwd + branch + lines changed), 2) model + context + cost + cache
# + subscription rate limits, 3) the cache miss notice, only while there is one.
# The +/- edit counts sit with the branch as a git-style diff stat.
printf '%s%s%s' "$C_DIR" "$cwd_short" "$C_RESET"
[[ -n "$branch" ]] && printf ' %s(%s)%s%s' "$C_BRANCH" "$branch" "$C_RESET" "$worktree_tag"
printf ' %s+%s%s/%s-%s%s\n' "$C_OK" "$added" "$C_RESET" "$C_DANGER" "$removed" "$C_RESET"

printf '%s%s%s%s%s%s %s%s$%.3f%s%s%s%s%s\n' \
  "$C_MODEL" "$model" "$C_RESET" "$style_tag" "$meta_segment" "$ctx_segment" \
  "$C_COST" "$cost_mark" "$cost" "$C_RESET" \
  "$cache_segment" "$cache_ttl_segment" "$rate_segment" "$version_tag"
if [[ -n "$miss_line" ]]; then
  printf '%s\n' "$miss_line"
fi
