#!/usr/bin/env bash
# cache-audit.sh — audit prompt-cache efficiency across Claude Code transcripts.
#
# Reads ~/.claude/projects/*/*.jsonl, classifies every assistant turn by how
# much of the previous prefix was served from cache, and prints:
#   - a per-class summary (turns, rewritten tokens, USD spent on the rewrite)
#   - the warm misses with their candidate causes (--details)
#   - what the same sessions would have cost on the 5m vs the 1h cache tier
#
# Classes (checked in this order; prev = previous turn's input+read+write):
#   first    no previous turn in the session
#   append   read >= 90% of prev — the normal tail write
#   compact  a compact_boundary sits between the turns
#   ttl      idle gap exceeded the turn's cache TTL (5m: 300s, 1h: 3600s)
#   front    read < 5000 — the prefix head (system prompt / tools) changed
#   shrink   context got shorter within 5s — a retry or duplicate request
#   mid      anything else — the prefix broke after the static head
#
# Causes are candidates, not verdicts: a permission-mode / mode value that
# changed since the previous turn, and whether the miss sits at a user prompt
# (user-prompt) or inside a tool loop (tool-loop). Price table and geo
# multipliers mirror statusline.sh.
#
# Usage: cache-audit.sh [--dir DIR] [--project SLUG] [--details] [--json]
set -euo pipefail

dir="${HOME}/.claude/projects"
project=""
details=0
json=0
while [[ $# -gt 0 ]]; do
  case $1 in
    --dir)
      dir=$2
      shift 2
      ;;
    --project)
      project=$2
      shift 2
      ;;
    --details)
      details=1
      shift
      ;;
    --json)
      json=1
      shift
      ;;
    -h | --help)
      sed -n '2,22p' "$0" | sed 's/^# \{0,1\}//'
      exit 0
      ;;
    *)
      printf 'unknown option: %s (see --help)\n' "$1" >&2
      exit 2
      ;;
  esac
done

# Project dirs start with "-" (e.g. -home-user-repo); an absolute dir keeps the
# glob results from being read as options by jq.
dir=$(cd "$dir" 2>/dev/null && pwd) || {
  printf 'no such directory: %s\n' "$dir" >&2
  exit 1
}

# Pass 1: one JSON object per assistant turn, per transcript.
# shellcheck disable=SC2016  # jq programs: $vars are jq variables, not shell
per_turn='
def ep: sub("\\.[0-9]+Z$"; "Z") | fromdate;
def price(m):
  if   (m | test("fable|mythos")) then 10.0
  elif (m | test("opus"))         then 5.0
  elif (m | test("sonnet"))       then 3.0
  elif (m | test("haiku"))        then 1.0
  else 0 end;
def mult(m):
  if   (m | test("^global\\."))             then 1.0
  elif (m | test("^(jp|us|eu|au|apac)\\.")) then 1.1
  elif (m | startswith("anthropic."))       then 1.1
  else 1.0 end;
def wmult(t): if t == "1h" then 2 else 1.25 end;
def ttl(t): if t == "1h" then 3600 else 300 end;
. as $all
| def last_value(idx; t; f): [ $all[:idx][] | select(.type == t) | .[f] ] | last;
  [ range(length) as $i | $all[$i]
    | select(.type == "assistant" and .message.usage? and .timestamp?)
    | {i: $i, ts: .timestamp, id: .message.id, m: (.message.model // ""), u: .message.usage} ]
| group_by(.id) | map(.[0]) | sort_by(.ts) | . as $t
| range(length) as $k | $t[$k] as $c | (if $k > 0 then $t[$k-1] else null end) as $p
| ($c.u.input_tokens // 0) as $in
| ($c.u.cache_read_input_tokens // 0) as $read
| ($c.u.cache_creation_input_tokens
   // (($c.u.cache_creation.ephemeral_5m_input_tokens // 0) + ($c.u.cache_creation.ephemeral_1h_input_tokens // 0))) as $write
| (if ($c.u.cache_creation.ephemeral_1h_input_tokens // 0) > 0 then "1h" else "5m" end) as $tier
| ($in + $read + $write) as $total
| (if $p then ($p.u.input_tokens // 0) + ($p.u.cache_read_input_tokens // 0) + ($p.u.cache_creation_input_tokens // 0) else 0 end) as $prev
| (if $p then (($c.ts | ep) - ($p.ts | ep)) else 0 end) as $gap
| (if $p then [ $all[$p.i+1:$c.i][] | (.type + (if .subtype then "/" + .subtype else "" end)) ] | unique else [] end) as $between
| (if $p == null then "first"
   elif $read >= ($prev * 0.9 | floor) then "append"
   elif ($between | index("system/compact_boundary")) then "compact"
   elif $gap > ttl($tier) then "ttl"
   elif $read < 5000 then "front"
   elif $total < ($prev * 0.9 | floor) and $gap <= 5 then "shrink"
   else "mid" end) as $class
# Mode records are written on every prompt, so only a changed value is a signal.
| (if $p then
     ((last_value($p.i; "permission-mode"; "permissionMode")) as $pm0 | (last_value($c.i; "permission-mode"; "permissionMode")) as $pm1
      | (last_value($p.i; "mode"; "mode")) as $md0 | (last_value($c.i; "mode"; "mode")) as $md1
      | [ (if $pm0 != $pm1 then "permission-mode:\($pm0)->\($pm1)" else empty end),
          (if $md0 != $md1 then "mode:\($md0)->\($md1)" else empty end) ])
   else [] end) as $changes
| (if $p then ([ $all[$p.i+1:$c.i][] | select(.type == "user") | .message.content
                | if type == "string" then true else any(.[]?; .type == "text") end ] | any)
   else false end) as $at_prompt
| (if $class == "front" or $class == "mid" then
     (($changes + [ if $at_prompt then "user-prompt" else "tool-loop" end ]) | join("+"))
   elif $class == "shrink" then "retry" else "" end) as $cause
| (price($c.m) * mult($c.m) / 1e6) as $unit
# Input-side cost: uncached input at 1x, cache reads at 0.1x, cache writes at the tier multiplier.
| (($in + $read * 0.1 + $write * wmult($tier)) * $unit) as $usd
# Rewrite cost of a miss — what an append would not have paid.
| (if $class == "first" or $class == "append" then 0 else $write * wmult($tier) * $unit end) as $waste
# Simulated cost on tier T: cold turns rewrite the whole prefix, warm turns write only the new tail;
# misses that do not depend on idle time (front/mid/shrink/compact) cost the same on either tier.
| def sim(T):
    (if $class == "first" then $total
     elif ($class | IN("front", "mid", "shrink", "compact")) then $write
     elif $gap > ttl(T) then $total
     else ([$total - $prev, 0] | max) end) as $w
    | (($total - $w) * 0.1 + $w * wmult(T)) * $unit;
  {s: $session, ts: $c.ts, m: $c.m, tier: $tier, gap: $gap, read: $read, write: $write, total: $total, prev: $prev,
   class: $class, cause: $cause, usd: $usd, waste: $waste, u5: sim("5m"), u1: sim("1h"), priced: ($unit > 0)}
'

# Pass 2: aggregate every turn into one report object.
# shellcheck disable=SC2016
aggregate='
def r2: (. * 100 | round) / 100;
{
  turns: length,
  sessions: (map(.s) | unique | length),
  unpriced_turns: (map(select(.priced | not)) | length),
  hit_pct: ((map(.read) | add // 0) as $r | (map(.write) | add // 0) as $w
            | if $r + $w > 0 then ($r * 100 / ($r + $w) | round) else 0 end),
  by_class: (group_by(.class) | map({class: .[0].class, turns: length,
              write: (map(.write) | add), waste_usd: (map(.waste) | add | r2)})
             | sort_by(.turns) | reverse),
  usd: {actual: (map(.usd) | add // 0 | r2), sim_5m: (map(.u5) | add // 0 | r2), sim_1h: (map(.u1) | add // 0 | r2)},
  tier_by_session: (group_by(.s) | map({s: .[0].s, u5: (map(.u5) | add | r2), u1: (map(.u1) | add | r2)})
                    | {cheaper_5m: (map(select(.u5 < .u1)) | length), cheaper_1h: (map(select(.u1 < .u5)) | length),
                       top: (sort_by((.u1 - .u5) | fabs) | reverse | .[:10])}),
  misses: (map(select(.class | IN("front", "mid", "shrink")))
           | map({s: .s[:8], ts: .ts[:19], gap: .gap, read: .read, write: .write, prev: .prev, class: .class, cause: .cause}))
}
'

turns=$(
  for f in "$dir"/*"$project"*/*.jsonl; do
    [[ -r $f ]] || continue
    s=$(basename "$f" .jsonl)
    jq -c --arg session "$s" -s "$per_turn" "$f" 2>/dev/null || true
  done
)
[[ -n $turns ]] || {
  printf 'no assistant turns found under %s\n' "$dir" >&2
  exit 1
}
report=$(printf '%s\n' "$turns" | jq -s "$aggregate")

if [[ $json -eq 1 ]]; then
  printf '%s\n' "$report"
  exit 0
fi

jq -r --argjson details "$details" '
  def lpad(n): tostring | (n - length) as $d | (if $d > 0 then " " * $d else "" end) + .;
  def rpad(n): tostring | (n - length) as $d | . + (if $d > 0 then " " * $d else "" end);
  "sessions \(.sessions)  turns \(.turns)  cache hit \(.hit_pct)%"
    + (if .unpriced_turns > 0 then "  (\(.unpriced_turns) turns with unknown model price)" else "" end),
  "",
  "class      turns   write tokens  rewrite USD",
  (.by_class[] | "\(.class | rpad(8)) \(.turns | lpad(6)) \(.write | lpad(14)) \(.waste_usd | lpad(12))"),
  "",
  "input-side USD  actual \(.usd.actual)   if all 5m \(.usd.sim_5m)   if all 1h \(.usd.sim_1h)",
  "sessions cheaper on 5m: \(.tier_by_session.cheaper_5m)   cheaper on 1h: \(.tier_by_session.cheaper_1h)",
  (if $details == 1 then
     "",
     "warm misses (class, candidate cause):",
     (if (.misses | length) == 0 then "  none" else
       (.misses[] | "  \(.s) \(.ts) gap=\(.gap | lpad(4))s read=\(.read | lpad(7)) write=\(.write | lpad(7)) prev=\(.prev | lpad(7))  \(.class | rpad(6)) \(.cause)")
      end),
     "",
     "largest 5m/1h differences per session (USD):",
     (.tier_by_session.top[] | "  \(.s[:8])  5m \(.u5 | lpad(8))  1h \(.u1 | lpad(8))")
   else empty end)
' <<<"$report"
