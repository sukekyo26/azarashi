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
| `💥miss $0.89 (model switch)` | プレフィックスが壊れてキャッシュを書き直した。その料金と、分かる場合は原因（後述） |
| `⏳59:58` | プロンプトキャッシュが warm でいられる残り時間。残り 60 秒以下で黄 |
| `❄️cold` | TTL 切れ。次の送信でプレフィックス全体を cache write する |
| `📦compact` | `/compact` 直後。次の送信で会話部分のキャッシュが再構築される |
| `v2.1.0` | Claude Code のバージョン |

`cache NN%` と `💥miss` は排他で、`❄️cold` / `📦compact` のときは hit 率を出さない（放置前・compact 前のスナップショットで意味が無いため）。

## 💥miss の判定

transcript の直近 2 ターンの usage を比較する。

- 前ターンのプレフィックス長 = `input_tokens + cache_read_input_tokens + cache_creation_input_tokens`
- 当ターンの `cache_read_input_tokens` がその 90% 未満なら miss

正常なら当ターンの cache_read は前ターンのプレフィックス長にほぼ一致する（末尾に追記されるだけ）。それを下回ったなら、プレフィックスのどこかが変わって API がそこから先を cache write として課金し直している。

表示するのは書き直しの料金で、`cache_creation × 入力単価 × write 係数（5m: 1.25 / 1h: 2）× 地域係数`。価格表は Bedrock コスト再計算と同じもの。

原因は transcript から確実に分かる場合だけ括弧で添える。

- `(model switch)`: 直前ターンとモデルが違う。キャッシュはモデルごとに別なので必ず miss になる
- `(compact)`: 2 ターンの間に `/compact` の境界がある

原因が付かない miss は、権限モードの切替、CLAUDE.md や memory の編集、MCP サーバーやツール定義の変化、API 側のリトライのどれか。usage には system prompt の内訳が無いので、statusline からは特定できない。

miss は次のユーザー入力まで表示し続ける。ツールループ中は数秒ごとにターンが進むが、その間もずっと残るので「このターンで miss した」と読める。離席していても次に入力するまで見える。セッション最初のターンは比較対象が無いので miss にならない。

## キャッシュ TTL の決め方

`⏳` のカウントダウンは transcript の最新 assistant ターンの timestamp を起点にし、ファイルの mtime は使わない（`claude --continue` は mtime を更新するがキャッシュを温めない）。TTL は次の優先順で決まる。

1. `STATUSLINE_CACHE_TTL`（秒）
2. `FORCE_PROMPT_CACHING_5M=1` → 300 秒
3. `ENABLE_PROMPT_CACHING_1H=1` → 3600 秒
4. 最新ターンの usage に `ephemeral_1h_input_tokens > 0` があれば 3600 秒、なければ 300 秒

## 関連

- `common/.claude/hooks/warn-cold-cache-cost.sh`: 送信前に cold を検知し、再構築コストを警告（閾値以上なら一度ブロック）する hook。判定と価格表は statusline と同じ
