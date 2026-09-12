---
name: pr-create
description: '現在のブランチから PR を作成する。develop 上なら main、それ以外は develop をベースにする。ローカル CI 実行・未push なら push・CHANGELOG 同時更新を強制し、PR テンプレートに沿った本文を生成して gh pr create を実行する。Triggers: "PR作成", "プルリク作成", "プルリクエスト作成", "PRを作って", "create PR", "open pull request", "make pr".'
---

# pr-create

現在のブランチから PR を作成する。ベースブランチの自動判定・ローカル CI グリーン確認・未 push なら push・CHANGELOG 更新の確認をワークフローに織り込む。

## プロジェクト固有情報の判定

設定ファイルに頼らずリポジトリから判定する。判定できなければユーザーに確認する。

- **CI コマンド** — `justfile` の `ci` レシピ、`Makefile` の `ci` / `test`、`package.json` の `scripts` など、リポジトリの規約から判定する。
- **コード変更** — ソースコードファイルの変更を指す。テスト・CI 設定・ドキュメント・lint / フォーマット設定のみの変更は含めない。CI 実行要否と CHANGELOG 判定に使う。
- **CHANGELOG ファイル** — `changelog` スキルと同じ方法で検出する（`CHANGELOG.md`、`docs/CHANGELOG*.md` 等）。無ければ CHANGELOG 関連の手順は丸ごとスキップする（新規作成しない）。

## 大原則

- **本文はベースとの差分の事実だけを書く** — `git diff origin/<base>...HEAD` に現れる内容だけを書く。作業中の試行錯誤・撤回した実装・「一度入れて消した」経緯や、差分に存在しないツール・機能の名前を持ち込まない。レビュアーが読むのは最終的な差分なので、そこに無い話は誤解にしかならない。
- **テンプレート遵守** — `.github/pull_request_template.md` があればセクション構成・順序を維持し、空欄を残さない（該当が無ければ `なし` / `None` と明示）。無ければ「概要 / 変更点 / 動作確認」の簡潔な本文を生成する。
- **スコープを超えない** — PR 作成時に見つけた別件の修正・リファクタを混ぜない。
- **ローカル CI を必ず通す** — コード変更を含むなら CI コマンドをローカルでグリーンにしてから PR を出す。

## ベースブランチ

| 現在のブランチ | ベース | 用途 |
|:-------------|:------|:-----|
| `develop` | `main` | リリース PR |
| `main` | **エラー（PR を作らない）** | — |
| それ以外 (`feature/*` 等) | `develop` | 通常の開発 PR |

## 実行手順

### 1. 事前チェック

- `git status` が clean、現在のブランチが `main` でない
- `git fetch origin <base>` でベースを最新化
- `git diff origin/<base>...HEAD --name-only` で変更ファイル一覧を取得

### 2. ローカル CI（コード変更を含む場合）

判定した CI コマンド（例 `just ci`）を実行する。失敗したら PR 作成を中断し、内容をユーザーに報告する。

### 3. CHANGELOG 判定

CHANGELOG があり、コード変更を含むのに未更新なら、`changelog` スキルの「記載対象 ✓ / 記載しない ✗」を引用してユーザーに確認する。記載対象なら `changelog` スキルで先に更新し、対象外ならそのまま進む。

### 4. push

upstream が無ければ `git push -u origin <current>`、ahead なら `git push`。

### 5. タイトル（Conventional Commits）

| 状況 | タイトル |
|:-----|:--------|
| 単一コミット | そのコミットメッセージ |
| 複数コミット | `feat(scope): summary` 形式に集約 |
| `develop → main` でバージョンアップあり | `develop` のリリースコミットと同一タイトル（`chore: release vX.Y.Z` 等。プロジェクト規約から取り、ハードコードしない） |
| `develop → main` でバージョンアップなし | コミット内容を集約した通常タイトル |

`git log origin/main..HEAD --pretty=format:'%s'` でリリースコミットの有無を確認する。

### 6. 本文の生成

テンプレートを読み込んで各セクションを埋める。リリース PR でリリース専用テンプレート（`.github/PULL_REQUEST_TEMPLATE/release.md` 等）があればそちらを優先し、その節構成に従う（例: 「Released changes」に当該リリースの CHANGELOG セクションを転記）。

- **概要 / Summary**: この差分が何をするかを 1〜2 文。変更後の状態を書き、そこに至った経緯・背景の物語は書かない。
- **変更点 / Changes**: `git diff origin/<base>...HEAD --stat` で実際に変わったファイルを確認し、その差分だけを外部から見える単位で整理する。コミットログは補助に留める — 途中で入れて撤回した変更はログに残っていても差分には無い。
- **関連 issue**: `Closes #N` / `Refs #N`、なければ `なし`。
- **動作確認 / Test plan**: 実行済みの項目だけ `[x]`。
- **CHANGELOG**: 更新済み or 対象外を明示。

#### 変更の種別チェックボックス

`git log origin/<base>..HEAD --pretty=format:'%s%n%b'` から判定し、該当する物すべてを `[x]` にする。

| プレフィックス / マーカー | チェック対象 |
|:-----------------------|:-----------|
| `feat:` | 新機能 (feat) — 下記注記を参照 |
| `fix:` | バグ修正 (fix) |
| `feat!:` / `fix!:` / 本文に `BREAKING CHANGE:` | 破壊的変更 (BREAKING) |
| `security:` または CHANGELOG の `Security` に追記 | セキュリティ修正 (security) |
| `perf:` | パフォーマンス改善 (perf) |
| `refactor:` | リファクタリング (refactor) |
| `docs:` | ドキュメント (docs) |
| `test:` | テスト (test) |
| `chore:` / `ci:` / `build:` | ビルド / CI / 雑務 (chore) |

- **全項目を残す** — 該当しない物も `[ ]` のまま残す。レビュアーが「何に該当しないか」を確認できることがテンプレートの目的なので、間引くと意図が消える。
- **`feat` の注記** — プレフィックスが `feat:` でも CHANGELOG 記載対象外（内部 API 追加などエンドユーザーの動作が変わらないもの）なら `feat` にはチェックせず、実態に合わせて `refactor` / `chore` にする。
- **破壊的変更にチェックが入ったら `破壊的変更の詳細` を必ず埋める**（`なし` で出さない）。移行手順・影響範囲をユーザーに確認する。

### 7. PR 作成

**本文は `Write` ツールで一時ファイルに書き出し `--body-file` で渡す**。markdown はバックティック・`$`・`|` が頻出し heredoc では引用を誤りやすいため、shell heredoc は使わない。**新規パス**を指定すること（`mktemp` で空ファイルを先に作ると `Write` が Read を要求して二度手間になる）。

```bash
gh pr create --base "$base" --head "$current" --title "<タイトル>" --body-file /tmp/pr-body-<branch>.md
```

作成後は本文ファイルを `rm` し、`gh pr view <number> --json url -q .url` で URL を取得してユーザーに表示する。Draft はユーザーが指定したときだけ `--draft` を付ける。作成済み PR の本文差し替えも同じ流儀で `gh pr edit <number> --body-file <path>`。

### 8. 完了報告

PR の URL と番号 / ベースブランチ / 自動判定した種別 / ローカル CI の結果 / CHANGELOG 更新の有無 を報告する。

## self-check

- [ ] 現在のブランチが `main` でなく、`git status` clean
- [ ] (コード変更を含む場合) ローカル CI グリーン
- [ ] CHANGELOG 判定済み（更新 or 対象外を明示）
- [ ] upstream に push 済み
- [ ] 本文が `git diff origin/<base>...HEAD` の事実だけで構成され、撤回した実装・差分に無いツール名・作業経緯が混ざっていない
- [ ] テンプレートの全セクションを埋め、空欄なし
- [ ] (`変更の種別` 節がある場合) 全項目を残し、該当する物だけ `[x]`、最低 1 つは `[x]`
- [ ] 破壊的変更にチェックが入っているなら `破壊的変更の詳細` が埋まっている
- [ ] タイトルが Conventional Commits 形式、ベースブランチが意図通り
- [ ] 本文は `Write` した一時ファイルを `--body-file` で渡した（heredoc を使っていない）
