#!/usr/bin/env bash
# Claude Code statusLine — reads session JSON on stdin, prints a single line.
# Bedrock 利用時はトランスクリプトの usage を集計して実価格で再計算する（コストに
# "~" が付く）。Anthropic API 直の場合は Claude Code が報告する total_cost_usd を
# そのまま使う。どちらかはトランスクリプトのモデル ID から実行時に判定するので、
# 環境ごとにスクリプトを分ける必要はない。
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
transcript=$(jq -r '.transcript_path // empty' <<<"$input")
effort=$(jq -r '.effort.level // empty' <<<"$input")
thinking=$(jq -r '.thinking.enabled // false' <<<"$input")
worktree=$(jq -r '.workspace.git_worktree // empty' <<<"$input")
version=$(jq -r '.version // empty' <<<"$input")
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
    result=$(jq -rn '
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
# TTL: STATUSLINE_CACHE_TTL overrides; FORCE_PROMPT_CACHING_5M / ENABLE_PROMPT_CACHING_1H
# pin the tier; otherwise auto-detect from the newest turn's write slot. Claude Code
# picks the cache TTL per request, so the transcript is the source of truth, not 5m.
cache_ttl_segment=""
if [[ -r "$transcript" ]]; then
  # Read the tail once; reused by the tier check and the cache-state classifier.
  tail=$(tail -n 200 "$transcript" 2>/dev/null)
  if [[ -n "${STATUSLINE_CACHE_TTL:-}" ]]; then
    ttl=$STATUSLINE_CACHE_TTL
  elif [[ "${FORCE_PROMPT_CACHING_5M:-}" == "1" ]]; then
    ttl=300
  elif [[ "${ENABLE_PROMPT_CACHING_1H:-}" == "1" ]]; then
    ttl=3600
  elif [[ "$(jq -rs '[.[] | select(.type == "assistant" and .message.usage?)] | last
      | (if .message.usage.cache_creation? then (.message.usage.cache_creation.ephemeral_1h_input_tokens // 0) else 0 end) > 0' <<<"$tail" 2>/dev/null)" == "true" ]]; then
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
  IFS=$'\t' read -r cache_state last_req <<<"$(jq -rs '
    (([.[] | (.type == "system" and .subtype == "compact_boundary")] | rindex(true)) // -1) as $cb
    | (([.[] | (.type == "assistant" and (.timestamp != null))] | rindex(true)) // -1) as $at
    | if $cb > $at then "compact\t"
      elif $at >= 0 then "warm\t" + .[$at].timestamp
      else "none\t" end' <<<"$tail" 2>/dev/null)"
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
      cache_ttl_segment=" ${C_DANGER}❄️cold${C_RESET}"
      cache_segment="" # cold: the per-turn hit% is a pre-idle snapshot, drop it
    fi
  fi
fi

worktree_tag=""
[[ -n "$worktree" ]] && worktree_tag=" ${C_DIM}⑂${worktree}${C_RESET}"
version_tag=""
[[ -n "$version" ]] && version_tag=" ${C_DIM}v${version}${C_RESET}"

# Stack two lines so the bar stays readable in a narrow terminal:
# 1) project (cwd + branch + lines changed), 2) model + context + cost + cache.
# The +/- edit counts sit with the branch as a git-style diff stat.
printf '%s%s%s' "$C_DIR" "$cwd_short" "$C_RESET"
[[ -n "$branch" ]] && printf ' %s(%s)%s%s' "$C_BRANCH" "$branch" "$C_RESET" "$worktree_tag"
printf ' %s+%s%s/%s-%s%s\n' "$C_OK" "$added" "$C_RESET" "$C_DANGER" "$removed" "$C_RESET"

printf '%s%s%s%s%s%s %s%s$%.3f%s%s%s%s\n' \
  "$C_MODEL" "$model" "$C_RESET" "$style_tag" "$meta_segment" "$ctx_segment" \
  "$C_COST" "$cost_mark" "$cost" "$C_RESET" \
  "$cache_segment" "$cache_ttl_segment" "$version_tag"
