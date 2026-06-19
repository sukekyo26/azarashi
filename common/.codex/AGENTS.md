# agents instructions

**全ての回答は日本語で行うこと**

## 設計原則

- **シンプルな実装を最優先する** — 読んで即座に意図が伝わるコードを書く。巧妙なテクニックより明快さを選ぶ。
- **DRY 原則** — 同じロジックを 2 箇所以上に書かない。プロジェクトの共通モジュール（ユーティリティ・型・バリデーション）を活用し、なければそこに追加する。
- **後方互換性のために実装を複雑にしない** — 非推奨パスや分岐を積み重ねるくらいなら、破壊的変更 + マイグレーション手順を選ぶ。互換レイヤーは一時的な措置に留める。
- **べき等性を保つ** — セットアップ・生成系の処理は何度実行しても同じ結果になること。既存リソースの再作成・上書きを避け、上書きは明示的なフラグ指定時のみとする。
- **早期失敗と明確なエラー** — 異常は検出した時点で即座に中断する。エラーメッセージにはユーザーが次に何をすべきかを含める。
- **既存の共通基盤を使う** — 車輪の再発明をしない。既存のログ・設定・パス解決・バリデーションを再利用する。

## テストとリントのチェック

- **コミット前に必ずローカルでテストとリントを通す** — push 後に CI で初めて失敗を検知するのは避ける。コードを変更したら、プロジェクトが定義する全テスト・リントスイート（`just ci` / `make test` 等、プロジェクト依存）を実行し、グリーンを確認してからコミットする。
- **修正したら再実行する** — 失敗を直したら無関係な箇所を壊していないか、テスト・リストを再実行して検証する。「あとで CI が拾うから」と未確認のままコミットしない。
- **CI ワークフローを変更した場合** — 参照しているスクリプト・ファイルが実在することを確認する。削除済みのパスが残っていないか grep で点検する。
- **CI 失敗の修正コミットを積み上げない** — 同じ PR 内で「ci: fix」コミットが連続するのは push 前チェックを怠っているサイン。失敗の根本原因をローカルで再現してからコミットする。

## コメントの方針

- **デフォルトは書かない** — WHAT が識別子から明らかなら不要。書くのは WHY が非自明（順序依存・呼び出し契約・workaround・bug 履歴）な時だけ、1〜2 行で。
- **公開 API の docstring は別物** — 言い換えだけのインラインコメントは避けるが、公開関数・クラスの docstring はプロジェクト規約に従い必要なら書く。
- **避ける** — 「Foo returns the foo」式の言い換え / 「Earlier revisions …」式の墓標 / 手順の逐次解説 / PR description の再述。
- **既存の冗長は引きずらない** — 新規・改修は短く。気付いた既存冗長は別 PR で刈り込む。

## トークン効率と文脈管理

- **ファイルは的を絞って読む** — 全読みする前に `grep` / 検索で当たりを付け、必要な行範囲（offset/limit）だけを読む。シンボル定義・該当関数が分かっているなら、その周辺だけ読む。
- **一度読んだものを再読しない** — 既に文脈にあるファイル・出力は読み直さない。編集後の確認のためだけの再読もしない（編集ツールが失敗していれば分かる）。
- **広い調査は subagent に投げて結論だけ受け取る** — 多数のファイル横断・命名規約の探索など「読んだ中身ではなく結論だけ要る」調査は subagent に委譲し、ファイルダンプを本文脈に流し込まない。
- **大きなツール出力は本文脈に流さない** — テストログ・ビルド出力・巨大な検索結果などは、丸ごと読むのではなく中間処理（フィルタ・集計・抽出）を通して必要な結論だけを取り込む。
- **出力は簡潔に** — 前置き・要約の繰り返し・自明な手順解説を書かない。結論と根拠を先に、装飾は最小限。
- **倹約のために正確性を犠牲にしない（偽の節約の禁止）** — トークンを惜しんで確認すべきものを読まず推測で進めるのは逆効果（誤った実装・やり直しでかえって高くつく）。削るのは「無駄打ち」であって「必要な確認」ではない。

## Context7 MCP の利用

- **Context7 MCP を利用する** — ライブラリ・フレームワーク・SDK・API の仕様や設定を調べる際は、まず Context7 MCP 経由で最新ドキュメントを取得できないか検討する。学習データより新しい変更が反映されている。

## CHANGELOG の更新

- **コード変更時は CHANGELOG を同時に更新する** — 機能追加・バグ修正・変更を行った場合、コミット前に CHANGELOG を更新する。プロジェクトが二言語の CHANGELOG（例: `CHANGELOG.md` と `docs/CHANGELOG.ja.md`）を持つ場合は両方を同じ内容で同期させる。
- **CHANGELOG が無いプロジェクトでは更新しない** — リポジトリに CHANGELOG ファイルが存在しない場合は、新規に作成せず CHANGELOG の更新をスキップする。
- **判断基準**: 「エンドユーザーの操作・設定・出力・動作が変わるか？」→ **No なら記載しない**。
- **記載する** ✓: 新しい設定項目 / 新しい CLI コマンド・フラグ / ユーザーが体験していたバグの修正 / BREAKING changes（設定形式の変更・オプション削除等）/ セキュリティ修正 / 体感できるパフォーマンス改善。
- **記載しない** ✗: テスト追加・カバレッジ閾値変更 / CI ワークフロー変更 / テスト用内部 API 追加 / 外部動作が変わらないリファクタリング / 開発者向けツールのレシピ追加 / lint・フォーマット設定変更 / CHANGELOG 自体の修正。
- 詳細な記載ルール（カテゴリ・フォーマット・整理ルール）は `changelog` スキルに従う。

## ブランチと PR のワークフロー

- **`main` には直接コミット・push しない** — `main` への反映はリリース時の `develop` → `main` PR 経由のみ。`main` への直接 PR も出さない。
- **`develop` への直接コミットは許可** — 小さく低リスクな変更（ドキュメント・typo・バージョンバンプ・設定の微修正・自明な小バグ修正など）は `develop` に直接コミットしてよい。一方、レビューを要する・影響範囲が大きい・複数の独立変更を含む変更は専用ブランチ + PR を選ぶ。迷ったら PR にする。
- **専用ブランチを切る場合** — 種別ごとに `feature/` `fix/` `refactor/` `chore/` `docs/` `test/` の prefix を付け、最新の `develop` から `<prefix>/<short-kebab-name>` を切る。複数の独立した変更を 1 ブランチに混ぜず、各ブランチは `develop` をベースに PR を出す。
- **粒度の目安**: 1 機能追加・1 バグ修正・1 リファクタリング = 1 ブランチ・1 PR。レビューしやすい粒度を優先する。
- `develop` の取り込み・PR 作成は `sync-upstream` / `pr-create` スキルに従う。

## Git コミットのワークフロー

- **タスク完了時は明示指示なしで `git add` + `git commit` する（自動コミット）** — コミット前に `git status` で変更内容を確認し、`working tree clean` を確認してからタスク完了を宣言する。コミット漏れがないことを検証する。
- **関連する修正単位でコミットする** — 1 つのタスクで複数の変更がある場合、論理的にまとまった単位（機能とそのテスト、設定とドキュメント等）でコミットを分ける。
- **Conventional Commits 形式・英語 1 文** — `feat:` / `fix:` / `docs:` / `chore:` / `refactor:` / `test:` などのプレフィックスを付ける。
- **`.gitignore` 対象のファイルはコミットしない** — `git add` 時に明示的に追加しない。`git status --ignored` で確認できる。

## 作業スコープの規律

- **依頼されたスコープを超えない** — 作業中に発見した別件の修正・リファクタを混ぜない。指摘・依頼されていない箇所のリファクタを織り込まない。
- 別件は別ブランチ・別 PR に切り出すか、ユーザーに報告して判断を仰ぐ。

---

# context-mode — MANDATORY routing rules

context-mode MCP tools available. Rules protect context window from flooding. One unrouted command dumps 56 KB into context. Codex CLI hooks provide runtime enforcement when `[features].hooks = true`; these instructions remain mandatory model-side enforcement. Follow strictly.

## Think in Code — MANDATORY

Analyze/count/filter/compare/search/parse/transform data: **write code** via `ctx_execute(language, code)`, `console.log()` only the answer. Do NOT read raw data into context. PROGRAM the analysis, not COMPUTE it. Pure JavaScript — Node.js built-ins only (`fs`, `path`, `child_process`). `try/catch`, handle `null`/`undefined`. One script replaces ten tool calls.

## BLOCKED — do NOT use

### curl / wget — FORBIDDEN
Do NOT use `curl`/`wget` in shell. Dumps raw HTTP into context.
Use: `ctx_fetch_and_index(url, source)` or `ctx_execute(language: "javascript", code: "const r = await fetch(...)")`

### Inline HTTP — FORBIDDEN
No `node -e "fetch(..."`, `python -c "requests.get(..."`. Bypasses sandbox.
Use: `ctx_execute(language, code)` — only stdout enters context

### Direct web fetching — FORBIDDEN
Raw HTML can exceed 100 KB.
Use: `ctx_fetch_and_index(url, source)` then `ctx_search(queries)`

## REDIRECTED — use sandbox

### Shell (>20 lines output)
Shell ONLY for: `git`, `mkdir`, `rm`, `mv`, `cd`, `ls`, `npm install`, `pip install`.
Otherwise: `ctx_batch_execute(commands, queries)` or `ctx_execute(language: "shell", code: "...")`

### File reading (for analysis)
Reading to **edit** → reading correct. Reading to **analyze/explore/summarize** → `ctx_execute_file(path, language, code)`.

### grep / search (large results)
Use `ctx_execute(language: "shell", code: "grep ...")` in sandbox.

## Tool selection

0. **MEMORY**: `ctx_search(sort: "timeline")` — after resume, check prior context before asking user.
1. **GATHER**: `ctx_batch_execute(commands, queries)` — runs all commands, auto-indexes, returns search. ONE call replaces 30+. Each command: `{label: "header", command: "..."}`.
2. **FOLLOW-UP**: `ctx_search(queries: ["q1", "q2", ...])` — all questions as array, ONE call (default relevance mode).
3. **PROCESSING**: `ctx_execute(language, code)` | `ctx_execute_file(path, language, code)` — sandbox, only stdout enters context.
4. **WEB**: `ctx_fetch_and_index(url, source)` then `ctx_search(queries)` — raw HTML never enters context.
5. **INDEX**: `ctx_index(content, source)` — store in FTS5 for later search.

## Parallel I/O batches

For multi-URL fetches or multi-API calls, **always** include `concurrency: N` (1-8):

- `ctx_batch_execute(commands: [3+ network commands], concurrency: 5)` — gh, curl, dig, docker inspect, multi-region cloud queries
- `ctx_fetch_and_index(requests: [{url, source}, ...], concurrency: 5)` — multi-URL batch fetch

**Use concurrency 4-8** for I/O-bound work (network calls, API queries). **Keep concurrency 1** for CPU-bound (npm test, build, lint) or commands sharing state (ports, lock files, same-repo writes).

GitHub API rate-limit: cap at 4 for `gh` calls.

## Output

Write artifacts to FILES — never inline. Return: file path + 1-line description.
Descriptive source labels for `ctx_search(source: "label")`.

## Session Continuity

Skills, roles, and decisions persist for the entire session. Do not abandon them as the conversation grows.

## Memory

Session history is persistent and searchable. On resume, search BEFORE asking the user:

| Need | Command |
|------|---------|
| What were we working on? | `ctx_search(queries: ["summary"], source: "compaction", sort: "timeline")` |
| What did we decide? | `ctx_search(queries: ["decision"], source: "decision", sort: "timeline")` |
| What NOT to repeat? | `ctx_search(queries: ["rejected"], source: "rejected-approach")` |
| What constraints exist? | `ctx_search(queries: ["constraint"], source: "constraint")` |

Note: user-prompt history not available.

DO NOT ask "what were we working on?" — SEARCH FIRST.
If search returns 0 results, proceed as a fresh session.

## ctx commands

| Command | Action |
|---------|--------|
| `ctx stats` | Call `stats` MCP tool, display full output verbatim |
| `ctx doctor` | Call `doctor` MCP tool, run returned shell command, display as checklist |
| `ctx upgrade` | Call `upgrade` MCP tool, run returned shell command, display as checklist |
| `ctx purge` | Call `purge` MCP tool with confirm: true. Warns before wiping knowledge base. |

After /clear or /compact: knowledge base and session stats preserved. Use `ctx purge` to start fresh.

## Windows notes

**PowerShell cmdlets** — Sandbox uses bash. PowerShell cmdlets (`Format-List`, `Get-Culture`, etc.) fail with `command not found`. Wrap with `pwsh -NoProfile -Command "..."`.

**Relative paths** — Sandbox CWD is temp dir, not project root. Convert to absolute paths. Ask user to confirm if unknown.

**Windows drive letters** — Sandbox runs Git Bash / MSYS2. `X:\path` → `/x/path` (lowercase, no `/mnt/`). Never emit `/mnt/<letter>/`.

**Quote paths** — Spaces in paths cause splits. Always double-quote: `rg "symbol" "$REPO_ROOT/some dir/Source"`.
