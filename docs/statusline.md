# statusline の表示内容

`common/.claude/statusline.sh` が Claude Code のステータスラインに描く 2 行の説明。入力は Claude Code が stdin に渡す JSON と、`transcript_path` が指すセッションの transcript（JSONL）。

```
~/work/azarashi (develop) ⑂wt +12/-3
Opus {serena} high 🧠 ███░░░░░░░ 32% $1.234 cache 98% ⏳59:58 v2.1.0
```

## 1 行目: プロジェクト

| 表示 | 意味 |
|---|---|
| `~/work/azarashi` | カレントディレクトリ（`$HOME` は `~` に短縮） |
| `(develop)` | git ブランチ。リポジトリ外では出ない |
| `⑂wt` | git worktree 名。worktree 内でのみ出る |
| `+12/-3` | このセッションで追加 / 削除した行数 |

## 2 行目: モデルとコスト

| 表示 | 意味 |
|---|---|
| `Opus` | モデルの表示名 |
| `{serena}` | output style。`default` のときは出ない |
| `high` | effort level |
| `🧠` | extended thinking が有効 |
| `███░░░░░░░ 32%` | コンテキスト使用率。緑 < 60% ≤ 黄 < 80% ≤ 赤 |
| `$1.234` | セッションの累計コスト（USD）。先頭に `~` が付くときは Bedrock 用に transcript から再計算した推定値 |
| `cache 98%` | 直近ターンのキャッシュ hit 率 = cache_read / (cache_read + cache_creation)。緑 ≥ 90% > 黄 ≥ 50% > 赤 |
| `💥miss $0.89 (model_changed)` | Claude Code が miss と判定したリクエストの書き直し料金と原因（後述） |
| `⏳59:58` | プロンプトキャッシュが warm でいられる残り時間。残り 60 秒以下で黄 |
| `❄️cold` | TTL 切れ。次の送信でプレフィックス全体を cache write する |
| `📦compact` | `/compact` 直後。次の送信で会話部分のキャッシュが再構築される |
| `v2.1.0` | Claude Code のバージョン |

`cache NN%` と `💥miss` は排他で、miss がある間は hit 率の代わりに miss を出す。

## キャッシュ関連セグメントの情報源

キャッシュの状態は Claude Code 2.1.251 以降が stdin で渡す `prompt_cache` オブジェクトから読む。Claude Code が API 応答のキャッシュトークン数から計算していて、system prompt やツール一覧の変化まで見て原因を判定するので、transcript を自前で解析するより正確。`prompt_cache` が無い（古い Claude Code、または最初の API 応答前）ときはキャッシュ関連のセグメントを何も出さない。

使う項目は次の通り。

| 項目 | 用途 |
|---|---|
| `warm` / `expires_at` | `⏳` のカウントダウンと `❄️cold` |
| `ttl` | miss の料金計算の write 係数（5m: 1.25 / 1h: 2） |
| `recache_tokens_if_cold` | `null` なら会話が書き直された直後（`/compact` か古い tool_result の除去）で `📦compact` |
| `last_miss_at` / `last_miss_cause` | `💥miss` の表示と原因 |
| `miss_recache_tokens` | miss で書き直したトークンの累計。直前の miss 時点との差分がこの miss の量 |

## 💥miss の表示

Claude Code が miss と判定した（キャッシュから読めたはずの分の 5% かつ 2,000 トークン以上を再処理し、compact やツール結果の除去では説明できない）リクエストがあると出る。

- 料金は `この miss で書き直したトークン × 入力単価 × write 係数 × 地域係数`。価格表は Bedrock コスト再計算と共通
- 原因は Claude Code の `last_miss_cause.causes` をそのまま `+` で繋ぐ。`model_changed` / `tools_changed` / `system_prompt_changed` / `betas_changed` / `messages_rewritten` / `ttl_expired_5m` / `likely_server_side` など。Claude Code が原因を特定できなかった miss は括弧無し
- miss が起きた `prompt_id` の間は表示し続け、次のユーザー入力で消える。ツールループが何分続いても、離席していても、次に入力するまで「このターンで miss した」と読める。miss ごとの差分と prompt_id は `$TMPDIR/claude-statusline-miss-<session>` に保持する

miss が出たときに何かする必要があるかは原因次第。モデル切替・output style 変更・`/compact` のように自分の操作が原因なら、その操作の料金を知るだけでよい。`system_prompt_changed` や `tools_changed` が操作無しで出るなら、CLAUDE.md・memory・MCP サーバー・プラグインの変化を疑う。

## 関連

- `common/.claude/hooks/warn-cold-cache-cost.sh`: 送信前に cold を検知し、再構築コストを警告（閾値以上なら一度ブロック）する hook。判定と価格表は statusline と同じ
