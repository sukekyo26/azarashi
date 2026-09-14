# プロンプトキャッシュの監査

`~/.claude/cache-audit.sh`（リポジトリでは `common/.claude/cache-audit.sh`）は Claude Code のトランスクリプトを読み、プロンプトキャッシュのミスを分類して集計する。常駐させるものではなく、ティア設定を見直すときや、無駄な再書込が増えていないか点検するときに手で走らせる。

```sh
~/.claude/cache-audit.sh            # 分類別集計と 5m / 1h ティアの損益比較
~/.claude/cache-audit.sh --details  # warm 中のミス一覧（原因候補付き）とセッション別のティア差
~/.claude/cache-audit.sh --project azarashi --json
```

## 背景

エージェントのコストは「トークン数 × 単価」で、単価はキャッシュ状態で桁が変わる（cache read は入力の 0.1 倍、cache write は 5m ティアで 1.25 倍、1h ティアで 2 倍）。rtk / Serena / context 圧縮系はどれも「文脈に入るトークン数」を減らす軸で、単価側の軸はこのリポジトリの statusline（hit % 表示）と `warn-cold-cache-cost.sh`（TTL 切れの事前警告）が担っている。このスクリプトはその事後監査。

## 分類

前ターンのプレフィックス長 `prev = input + cache_read + cache_creation` に対し、当ターンの `cache_read` が 90% 未満ならミスとみなし、次の順で分類する。

| class | 条件 | 意味 |
|---|---|---|
| first | 前ターンなし | セッション初回、不可避 |
| append | `read >= prev × 0.9` | 正常な末尾追記 |
| compact | 間に `compact_boundary` | `/compact` |
| ttl | 放置時間がティアの TTL 超 | 放置。`warn-cold-cache-cost.sh` の守備範囲 |
| front | `read < 5000` | system prompt / tools が変わった |
| shrink | 文脈が短くなり 5 秒以内 | リトライか重複リクエスト |
| mid | 上記以外 | 静的な先頭は生きていて、その後で切れた |

front / mid の原因候補は、2 ターンの間に挟まったレコードから推定する（`permission-mode` / `mode` → 権限モード切替、`bridge-session` → Remote Control 接続）。usage には system prompt の内訳が無いので、あくまで候補。

## 2026-09-14 時点の監査結果

| class | ターン数 | 再書込トークン |
|---|---|---|
| append | 5406 | 8.17M |
| first | 60 | 1.72M |
| front | 11 | 1.97M |
| mid | 9 | 1.06M |
| ttl | 5 | 1.32M |
| compact | 2 | 0.09M |
| shrink | 1 | 0.00M |

- ミスは全ターンの 0.5% で、全体の hit 率は 99%。監視し続ける価値は薄く、点検で足りる。
- warm 中のミス 21 件のうち 15 件は権限モード切替か Remote Control 接続と重なる。mid の `read` は 26448 で複数セッション共通で、静的な system 部分の直後が変わっている。
- ティアは全セッション合計で 1h の方が安い（5m 換算 789 USD に対し 1h 換算 745 USD）。セッション単位では 5m が安いものが多数だが、長いセッションの放置コストが支配的。現状の 1h 設定は維持でよい。

## 運用ルール

- 権限モードはセッション冒頭で決め、途中で切り替えない。切替のたびに system prompt が変わり、プレフィックス全体を書き直す。
- Remote Control の接続も同様にプレフィックスを壊すので、長いセッションの途中で繋がない。

## 実装メモ

- 価格表と地域係数は `statusline.sh` / `warn-cold-cache-cost.sh` と同じものを持つ（AWS 一次情報で照合済み）。
- project ディレクトリ名は `-` で始まるため、絶対パスで glob しないと jq がオプションと誤認する。
