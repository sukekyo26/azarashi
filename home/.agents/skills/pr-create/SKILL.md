---
name: pr-create
description: '現在のブランチから PR を作成する。develop 上なら main、それ以外は develop をベースにする。ローカル CI 実行・未push なら push・CHANGELOG 同時更新を強制し、PR テンプレートに沿った本文を生成して gh pr create を実行する。Triggers: "PR作成", "プルリク作成", "プルリクエスト作成", "PRを作って", "create PR", "open pull request", "make pr".'
---

# pr-create

現在のブランチから PR を作成する。ベースブランチは現在のブランチによって自動判定する。ローカル CI グリーン確認・未 push なら push・CHANGELOG 同時更新の確認をワークフローに織り込む。

## プロジェクト固有情報の判定

プロジェクト依存の事実は設定ファイルに頼らず、リポジトリから判定する。判定できない場合はユーザーに確認する。

- **CI コマンド** — ローカルで実行する全テスト・リント一式。`justfile` に `ci` レシピがあれば `just ci`、`Makefile` の `ci` / `test` ターゲット、`package.json` の `scripts`（`npm test` 等）など、リポジトリの規約から判定する。不明ならユーザーに確認。
- **コード変更の判定** — 「コード変更」とはソースコードファイル（各言語のソース・設定スキーマ等）の変更を指す。テスト・CI 設定・ドキュメント・lint / フォーマット設定のみの変更は含めない。CI 実行要否と CHANGELOG 判定に使う。
- **CHANGELOG ファイル** — `changelog` スキルと同じ方法でリポジトリ内から検出する（`CHANGELOG.md`、`docs/CHANGELOG*.md` 等）。

## 大原則

- **ベースブランチ判定は機械的に** — 現在のブランチが `develop` なら `main`、それ以外は `develop`。`main` 上での実行は禁止 (即エラー)。
- **テンプレート遵守** — `.github/pull_request_template.md` があればそのセクション構成・順序を維持する。空欄を残さない (`関連 issue` / `破壊的変更の詳細` がなければ "なし" と明示)。テンプレートが無ければ「概要 / 変更点 / 動作確認」の簡潔な本文を生成する。
- **タイトルは Conventional Commits** — `feat(scope): ...` / `fix(scope): ...` / `chore: ...` 等。`develop → main` の PR でも、バージョンアップを含む場合は `chore: release vX.Y.Z`、含まない場合（リファクタ・chore のみ）はコミット内容を集約した通常タイトルにする。
- **スコープを超えない** — PR 作成時に発見した別件の修正を混ぜない。指摘されていない箇所のリファクタを織り込まない。
- **ローカル CI を必ず通す** — コード変更を含む PR は、プロジェクトの CI コマンドをローカルで実行しグリーンを確認してから PR を出す。

## ベースブランチ決定ロジック

| 現在のブランチ | ベースブランチ | 用途 |
|:-------------|:-------------|:-----|
| `develop` | `main` | リリース PR |
| `main` | **エラー** | main からは PR を作らない |
| それ以外 (`feature/*`, `fix/*` 等) | `develop` | 通常の開発 PR |

```bash
current=$(git rev-parse --abbrev-ref HEAD)
case "$current" in
  main)    echo "ERROR: main ブランチからは PR を作れません" >&2; exit 1 ;;
  develop) base=main ;;
  *)       base=develop ;;
esac
```

## 実行手順

### 1. 事前チェック

すべて pass してから次に進む。

- `git status` が clean (未コミット変更がない)
- `git rev-parse --abbrev-ref HEAD` で現在のブランチを取得し、`main` でないことを確認
- `git fetch origin <base>` でベースを最新化
- `git diff origin/<base>...HEAD --name-only` で変更ファイル一覧を取得

### 2. ローカル CI の実行 (コード変更を含む場合)

変更ファイルにコード変更が含まれるなら（「プロジェクト固有情報の判定」のコード変更の定義に従う）**必ず実行**する。

```bash
<判定した CI コマンド>   # 例: just ci
```

失敗したら PR 作成を中断し、失敗内容をユーザーに報告する。

### 3. CHANGELOG 判定

CHANGELOG ファイルがリポジトリに存在しないプロジェクトでは、判定・確認をせずそのまま次へ進む（CHANGELOG を新規作成しない）。

CHANGELOG ファイルがあり、変更ファイルにコード変更が含まれるのに未更新なら、ユーザーに次を確認する:

> CHANGELOG が更新されていません。この変更は CHANGELOG 記載対象ですか?
> 記載対象 (エンドユーザーの操作・設定・動作が変わる) → `changelog` スキルで先に更新してください
> 記載対象外 (テスト・CI・リファクタ・lint 設定など) → このまま PR を作成します

判断基準は `changelog` スキルの「記載対象 ✓ / 記載しない ✗」を引用する。

### 4. 未 push の場合の自動 push

```bash
upstream=$(git rev-parse --abbrev-ref --symbolic-full-name @{u} 2>/dev/null || true)

if [ -z "$upstream" ]; then
  git push -u origin "$current"
elif git status -sb | grep -q '\[ahead'; then
  git push
fi
```

### 5. PR タイトルのドラフト

**`develop → main` のタイトル判定ロジック:**

`git log origin/main..HEAD --pretty=format:'%s'` を取得し、リリースコミット（`chore: release vX.Y.Z` を基本とするが、プロジェクト規約により `feat: release vX.Y.Z` / `bump version` 等の場合もある）が含まれるかを確認する。

| 状況 | タイトル例 |
|:-----|:----------|
| 単一コミット | コミットメッセージをそのまま採用 |
| 複数コミット (同一スコープ) | `feat(scope): summary` 形式に集約 |
| `develop → main` かつバージョンアップあり | `chore: release vX.Y.Z`（バージョンはプロジェクトのバージョンソースから取得） |
| `develop → main` かつバージョンアップなし | コミット内容を集約した通常タイトル (例: `refactor: consolidate internal modules`) |

### 6. PR 本文の生成

`.github/pull_request_template.md` があれば読み込み、各セクションを埋めて生成する。

#### 6.1 「変更の種別」チェックボックスの自動判定

**重要 — テンプレートの全項目を残す**: PR テンプレートに列挙されているチェックボックスは、
該当しない物も含めて **すべてそのまま残す**。チェックされない項目を削除してはいけない。
レビュアーが「この変更が何に該当しないか」「他のカテゴリも検討した上で選ばれたか」
を一目で確認できることがテンプレートの目的なので、項目を間引くと意図が消える。

`git log origin/<base>..HEAD --pretty=format:'%s%n%b'` でコミットメッセージとボディを取得し、以下のルールで該当箇所を `[x]` にする (該当しない物は `[ ]` のまま残す)。複数該当する場合はすべてチェック。

| プレフィックス / マーカー | チェック対象 |
|:-----------------------|:-----------|
| `feat:` / `feat(...)` | 新機能 (feat) — ただし後述の注記を参照 |
| `fix:` / `fix(...)` | バグ修正 (fix) |
| `feat!:` / `fix!:` / 本文に `BREAKING CHANGE:` | 破壊的変更 (BREAKING) |
| `security:` または CHANGELOG の `Security` カテゴリに追記 | セキュリティ修正 (security) |
| `perf:` | パフォーマンス改善 (perf) |
| `refactor:` | リファクタリング (refactor) |
| `docs:` | ドキュメント (docs) |
| `test:` | テスト (test) |
| `chore:` / `ci:` / `build:` | ビルド / CI / 雑務 (chore) |

**`feat` の判定注記** — コミットプレフィックスが `feat:` でも、**CHANGELOG 記載対象外**の変更 (内部パッケージ追加・内部 API 追加など、エンドユーザーの操作・設定・動作が変わらないもの) は `feat` にチェックを付けない。その場合は実態に合わせて `refactor` / `chore` のみにチェックを付ける。

**破壊的変更にチェックが入った場合は `破壊的変更の詳細` セクションを必ず埋める** (空のまま `なし` で出さない)。具体的な移行手順・影響範囲をユーザーに確認する。

#### 6.2 各セクションの埋め方

- **概要**: PR の目的を 1〜2 文。コミットメッセージから推定し、ユーザーに最終確認を取ると良い。
- **変更点**: `git log origin/<base>..HEAD --pretty=format:'- %s'` の結果をベースに、外部から見える差分中心に整理。
- **関連 issue**: 該当があれば `Closes #N` / `Refs #N`、なければ `なし`。
- **破壊的変更の詳細**: 破壊的変更チェック時のみ記入。なければ `なし`。
- **動作確認**: 実行済みの項目のみ `[x]` にする (CI がグリーンだったら該当項目を `[x]`)。
- **CHANGELOG**: 更新済み or 対象外を明示。

### 7. PR 作成 (`gh pr create --body-file`)

**本文は必ず `Write` ツールで一時ファイルに書き出し、`--body-file` で渡す**。
shell heredoc (`--body "$(cat <<EOF ... EOF)"`) は使わない。

理由: markdown 本文はバックティック・`$`・`|` が頻出し、heredoc に埋めると引用・展開の
判断を誤りやすい。`Write` は内容をそのままディスクに書くので確実にリテラル保存できる。

手順:

1. `Write` ツールで一時ファイル (例: `/tmp/pr-body-<branch>.md`) に
   markdown 本文を書く。**新規パス**を指定すること — `mktemp` で先に空ファイル
   を作ると `Write` が「Read してから書け」と拒否するので二度手間になる。
2. 本文ファイルの内容を `gh pr create --body-file <path>` に渡す:

   ```bash
   gh pr create \
     --base "$base" \
     --head "$current" \
     --title "<生成タイトル>" \
     --body-file /tmp/pr-body-<branch>.md
   ```

3. PR 作成後、本文ファイルは `rm` で片付ける。
4. 作成された PR の URL を `gh pr view <number> --json url -q .url` で取得しユーザーに表示する。

その他:

- Draft オプションは既定では付けない。ユーザーが「Draft で」と指定したときのみ `--draft` を付与。
- 既に PR を作成済みで本文だけ差し替える場合も同じ流儀で `gh pr edit <number> --body-file <path>` を使う。

### 8. 完了報告

ユーザーに以下を報告する:

- 作成した PR の URL と番号
- ベースブランチ (`develop` or `main`)
- チェックボックスで自動判定した種別の一覧
- ローカル CI の結果 (実行した場合)
- CHANGELOG 更新の有無

## チェックリスト (実行末尾の self-check)

- [ ] 現在のブランチが `main` でない
- [ ] `git status` clean
- [ ] (コード変更を含む場合) ローカル CI グリーン
- [ ] CHANGELOG 判定済み (更新 or 対象外を明示)
- [ ] upstream に push 済み
- [ ] テンプレートがある場合、全セクションを埋め空欄なし
- [ ] `変更の種別` のチェックボックスは **全項目を残し**、該当する物だけ `[x]` にしている (チェックされない項目を削除していない)
- [ ] `変更の種別` に最低 1 つ `[x]` が付いている
- [ ] 破壊的変更にチェックが入っている場合、`破壊的変更の詳細` が埋まっている
- [ ] PR タイトルが Conventional Commits 形式
- [ ] (`develop → main` の場合) バージョンアップの有無を確認し、タイトルを適切に判定した
- [ ] ベースブランチが意図通り (`develop` or `main`)
- [ ] PR 本文は `Write` で書き出した一時ファイルを `--body-file` で渡した (shell heredoc を使っていない)
