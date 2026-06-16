#!/usr/bin/env bash
# UserPromptSubmit hook — warn (or block, above a cost threshold) when the prompt cache has gone cold.
#
# An idle gap past the cache TTL drops the prompt cache to "cold": the NEXT
# request rebuilds the whole conversation prefix as a cache *write* (input*1.25
# for a 5m cache, input*2 for a 1h cache) instead of a cheap cache *read*
# (input*0.1). Rebuilding can't be avoided by continuing — only by NOT continuing
# this session (e.g. /clear into a fresh, short one). Below the cost threshold this
# hook just surfaces the estimate as a `systemMessage`; at or above it blocks the
# submit once so the user can reconsider, and a re-submit goes through.
#
# Mirrors the cold detection and Bedrock price table of statusline-bedrock.sh.
# Only the idle warm->cold case is flagged; /compact (deliberate, and whose
# post-summary size is unknown here) is left alone.
#
# On cold, it acts whenever a cost can be estimated (model is in the price table
# below); unknown-price models do nothing. Below WARN_COLD_CACHE_WARN_USD it's a
# low-key FYI (`systemMessage`, just the amount); at or above it BLOCKS the prompt
# once (`decision: block`) and a re-submit at the same cold point proceeds — a
# sentinel keyed on session + cold anchor enforces the one-shot block.
#
# The cache tier (5m/1h) is auto-detected from the newest turn's write slot and
# sets both the cold TTL and the write multiplier; env vars override it.
#
# Tunables (env):
#   WARN_COLD_CACHE_WARN_USD  escalate FYI -> warning at this rebuild cost (default 1)
#   FORCE_PROMPT_CACHING_5M=1 / ENABLE_PROMPT_CACHING_1H=1  pin the tier
#   STATUSLINE_CACHE_TTL      override the cold TTL in seconds
set -u

input=$(cat)
transcript=$(jq -r '.transcript_path // empty' <<<"$input")
session_id=$(jq -r '.session_id // empty' <<<"$input")
[[ -n "$transcript" && -r "$transcript" ]] || exit 0

# Read the tail once; feed it to the tier check, the cold check, and the estimate.
tail=$(tail -n 200 "$transcript" 2>/dev/null)

# Cache tier (5m vs 1h) drives BOTH the cold TTL and the rebuild-cost write
# multiplier (5m write = input*1.25, 1h write = input*2). Claude Code picks the
# TTL per request, so resolve from an env override, else from whether the newest
# assistant turn actually wrote to the 1h cache slot.
tier=5m
if [[ "${FORCE_PROMPT_CACHING_5M:-}" == "1" ]]; then
  tier=5m
elif [[ "${ENABLE_PROMPT_CACHING_1H:-}" == "1" ]]; then
  tier=1h
else
  newest_1h=$(jq -rs '[.[] | select(.type == "assistant" and .message.usage?)] | last
    | (.message.usage.cache_creation.ephemeral_1h_input_tokens // 0) > 0' <<<"$tail" 2>/dev/null)
  [[ "$newest_1h" == "true" ]] && tier=1h
fi
if [[ "$tier" == "1h" ]]; then
  ttl=3600
  write_mult=2
else
  ttl=300
  write_mult=1.25
fi
ttl=${STATUSLINE_CACHE_TTL:-$ttl}

# cold check: anchor on the newest assistant turn's timestamp (the request that
# warmed the cache), not file mtime — resume bookkeeping bumps mtime without a
# request. A newer compact_boundary means /compact, which we deliberately skip.
IFS=$'\t' read -r cache_state last_req <<<"$(jq -rs '
  (([.[] | (.type == "system" and .subtype == "compact_boundary")] | rindex(true)) // -1) as $cb
  | (([.[] | (.type == "assistant" and (.timestamp != null))] | rindex(true)) // -1) as $at
  | if $cb > $at then "compact\t"
    elif $at >= 0 then "warm\t" + .[$at].timestamp
    else "none\t" end' <<<"$tail" 2>/dev/null)"

[[ "$cache_state" == "warm" && -n "$last_req" ]] || exit 0
last_req=$(date -d "$last_req" +%s 2>/dev/null || echo 0)
((ttl - ($(date +%s) - last_req) <= 0)) || exit 0

# Estimate the rebuild cost: the newest assistant turn's input + cache_read +
# cache_creation tokens approximate the current cached prefix; rebuilding it
# costs prefix * input_price * write_mult (1.25 for a 5m cache, 2 for 1h) with
# the geo multiplier. Returns "<prefix_tokens>\t<usd>\t<warn|info>"; nothing when
# the model price is unknown.
warn_usd=${WARN_COLD_CACHE_WARN_USD:-1}
est=$(jq -rs --arg warn "$warn_usd" --arg write "$write_mult" '
  def price(m):
    if   (m | test("fable-5|mythos-5")) then 10.0
    elif (m | test("opus-4-[5-8]"))     then 5.0
    elif (m | test("sonnet-4-[56]"))    then 3.0
    elif (m | test("haiku-4-5"))        then 1.0
    else null end;
  def mult(m):
    if   (m | test("^global\\."))             then 1.0
    elif (m | test("^(jp|us|eu|au|apac)\\.")) then 1.1
    elif (m | startswith("anthropic."))       then 1.1
    else 1.0 end;
  [ .[] | select(.type == "assistant" and .message.usage? and .message.model?) ] | last as $a
  | if $a == null then empty
    else
      ($a.message.model) as $m
      | $a.message.usage as $u
      | (($u.input_tokens // 0)
         + ($u.cache_read_input_tokens // 0)
         + (if $u.cache_creation?
            then ($u.cache_creation.ephemeral_5m_input_tokens // 0)
                 + ($u.cache_creation.ephemeral_1h_input_tokens // 0)
            else ($u.cache_creation_input_tokens // 0) end)) as $prefix
      | price($m) as $p
      | if $p == null then empty
        else (($prefix * $p * ($write | tonumber) * mult($m)) / 1e6) as $cost
        | "\($prefix)\t\($cost)\t\(if $cost >= ($warn | tonumber) then "warn" else "info" end)"
        end
    end' <<<"$tail" 2>/dev/null)

[[ -n "$est" ]] || exit 0
IFS=$'\t' read -r prefix cost level <<<"$est"
prefix_k=$((prefix / 1000))

# Below the threshold: FYI only, never block.
if [[ "$level" != "warn" ]]; then
  msg=$(printf 'ℹ️ プロンプトキャッシュが cold です。\nこの再開での履歴の再構築コストは約 $%.2f です。' \
    "$cost")
  jq -n --arg m "$msg" '{systemMessage: $m}'
  exit 0
fi

# At/above the threshold: block once, then let an immediate re-submit through. The
# sentinel keys on session + the cold anchor (last_req), so re-submitting at the
# same cold point proceeds, but a fresh idle gap (new anchor) blocks again.
sentinel="${TMPDIR:-/tmp}/claude-coldwarn-${session_id:-nosession}"
if [[ -n "$session_id" && "$(cat "$sentinel" 2>/dev/null)" == "$last_req" ]]; then
  rm -f "$sentinel"
  exit 0 # second submit at the same cold point — proceed
fi
[[ -n "$session_id" ]] && printf '%s\n' "$last_req" >"$sentinel"

reason=$(printf '⚠️ プロンプトキャッシュが cold です。\nこのまま続けると履歴（約 %dk tokens）の再構築に約 $%.2f かかります。続けるにはもう一度送信してください。/clear で新規セッションにすればこのコストを避けられます。' \
  "$prefix_k" "$cost")
jq -n --arg r "$reason" '{decision: "block", reason: $r}'
