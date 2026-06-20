#!/usr/bin/env bash
# Codex の agent-turn-complete 通知で端末ベルを複数回鳴らす。
# Claude Code 側の Notification フック（.claude/settings.fragment.json）と同等の注意喚起。
# Codex は notify プログラムを単一の JSON 引数付きで起動する。
set -eu

payload="${1:-}"

# 現状 Codex が通知する type は agent-turn-complete のみだが、将来の他イベントで
# 鳴らさないよう明示的に絞る。jq があれば使い、無ければ素朴に文字列照合する。
if [ -n "$payload" ]; then
  if command -v jq >/dev/null 2>&1; then
    [ "$(printf '%s' "$payload" | jq -r '.type // empty')" = "agent-turn-complete" ] || exit 0
  else
    case "$payload" in
      *'"agent-turn-complete"'*) ;;
      *) exit 0 ;;
    esac
  fi
fi

# 制御端末へ直接 BEL を送る。notify プログラムの stdout は端末とは限らないため。
out=/dev/tty
[ -w "$out" ] || out=/dev/stderr

# Claude 側と同じく 0.3 秒間隔で 5 回鳴らす。
for _ in 1 2 3 4 5; do
  printf '\a' >"$out"
  sleep 0.3
done
