# statusline の表示内容

`common/.claude/statusline.sh` が Claude Code のステータスラインに描く 2 行（miss があるときは 3 行）の説明。入力は Claude Code が stdin に渡す JSON と、`transcript_path` が指すセッションの transcript（JSONL）。

```
~/work/azarashi (develop) ⑂wt +12/-3
Opus {serena} high 🧠 ███░░░░░░░ 32% $1.234 cache 98% ⏳59:58 (16:42:07) 5h ██░░░░░░░░ 18% (20:00) 7d █░░░░░░░░░ 12% (09/21 15:00) v2.1.0
💥miss $0.89 (model_changed)
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
| `⏳59:58 (16:42:07)` | プロンプトキャッシュが warm でいられる残り時間と、cold になる時刻。残り 60 秒以下で黄 |
| `❄️cold` | TTL 切れ。次の送信でプレフィックス全体を cache write する |
| `📦compact` | `/compact` 直後。次の送信で会話部分のキャッシュが再構築される。TTL も切れていれば `❄️cold` が優先 |
| `5h ██░░░░░░░░ 18% (20:00)` | サブスクリプションの 5 時間枠の使用率とリセット時刻（後述） |
| `7d █░░░░░░░░░ 12% (09/21 15:00)` | 同じく 7 日枠。リセットは日付と時刻 |
| `v2.1.0` | Claude Code のバージョン |

### レートリミット

Claude.ai Pro / Max の契約者（または支出上限付き gateway 経由）だけに stdin の `rate_limits` が来る。Bedrock や API キーでは項目自体が無いので何も出ない。ゲージはコンテキスト使用率と同じ色分け（緑 < 60% ≤ 黄 < 80% ≤ 赤）。括弧はその枠がリセットされる時刻で、5 時間枠は時刻、7 日枠は日付と時刻。支出上限（`spend`）があればその後ろに付く。リセット時刻を過ぎた枠は Claude Code 側が落とすので消える。

## 3 行目: キャッシュ miss

miss があるときだけ出る。次のユーザー入力で消える。

```
💥miss $0.89 (model_changed)
```

**意味**: 直前のリクエストで、本来キャッシュから読めたはずのプレフィックスを API が読めず、cache write として課金し直した。金額はその書き直し分の料金。通常の会話ではプレフィックスは末尾に追記されるだけなので、miss が出るのは何かがプレフィックスの途中を変えたとき。

**原因**: 括弧内は Claude Code の判定。複数あれば `+` で繋ぐ。特定できなかった場合は括弧無し。

| 原因 | 意味 | 自分の操作か |
|---|---|---|
| `model_changed` | モデルを切り替えた。キャッシュはモデルごとに別 | はい（`/model`） |
| `cache_scope_or_ttl_changed` | キャッシュの TTL（5m / 1h）や範囲が変わった | 環境変数か Claude Code 側 |
| `betas_changed` | API の beta フラグが変わった。モデル切替や機能の切替に伴う | ほぼ操作に伴う |
| `messages_rewritten` | 会話履歴が書き換わった。`/compact`、古い tool_result の除去、リトライ | `/compact` なら はい |
| `system_prompt_changed` | system prompt が変わった。CLAUDE.md・memory・output style・権限モード・hook の注入内容 | 場合による |
| `tools_changed` | ツール一覧が増減した。MCP サーバーの接続・切断、プラグインの有効・無効、deferred tool の読み込み | 場合による |
| `ttl_expired_5m` | 5 分の TTL を過ぎて放置した | はい（放置） |
| `likely_server_side` | クライアント側に変化が無く、API 側の事情と推定 | いいえ |

**見たら何をするか**: 自分の操作（モデル切替、`/compact`、output style 変更）の直後なら、その操作の料金を知るだけでよい。何もしていないのに `system_prompt_changed` や `tools_changed` が出るなら、CLAUDE.md・memory・MCP サーバー・プラグインの変化を疑う。`likely_server_side` は対処のしようが無い。

原因の一覧は [Claude Code のドキュメント](https://code.claude.com/docs/ja/prompt-caching)を参照。

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

## 💥miss の判定と計算

Claude Code は、キャッシュから読めたはずの分の 5% かつ 2,000 トークン以上を再処理し、compact やツール結果の除去では説明できないリクエストを miss と数える。

- 料金は `この miss で書き直したトークン × 入力単価 × write 係数（5m: 1.25 / 1h: 2）× 地域係数`。価格表は Bedrock コスト再計算と共通
- `miss_recache_tokens` は累計なので、直前の miss 時点との差分をこの miss の量とする。差分と miss 発生時の `prompt_id` は `$TMPDIR/claude-statusline-miss-<session>` に保持する
- `prompt_id` が変わる（次のユーザー入力）まで表示し続ける。ツールループが何分続いても、離席していても、次に入力するまで「このターンで miss した」と読める

## 表示が実態と合わないとき

`STATUSLINE_DEBUG_LOG=<path>` を設定すると（`settings.json` の `env` で Claude Code から渡す）、実行ごとに stdin の JSON を 1 行ずつ追記する。`prompt_cache.warm` / `expires_at` と表示を突き合わせれば、Claude Code の報告と描画のどちらがずれているか切り分けられる。

## 関連

- `common/.claude/hooks/warn-cold-cache-cost.sh`: 送信前に cold を検知し、再構築コストを警告（閾値以上なら一度ブロック）する hook。判定と価格表は statusline と同じ
