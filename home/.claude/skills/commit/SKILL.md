---
name: commit
description: '作業中の変更を Conventional Commits 形式で論理単位に分割してコミットする。git status 確認・.gitignore 対象の除外・関連する変更ごとのコミット分割を行う。Triggers: "コミット", "commit", "コミットして", "コミット分割", "変更をコミット", "git commit".'
---

# commit

作業中の変更を Conventional Commits 形式で、論理的にまとまった単位に分割してコミットする。

## 大原則

- **関連する修正単位でコミットを分ける** — 1 タスクで複数の変更がある場合、論理的にまとまった単位（機能とそのテスト、設定とドキュメント等）でコミットを分割する。
- **Conventional Commits 形式・英語 1 文** — `feat:` / `fix:` / `docs:` / `chore:` / `refactor:` / `test:` 等の prefix を付ける。
- **`.gitignore` 対象はコミットしない** — `git add` で明示的に追加しない。`git add -A` での無差別追加を避け、関連ファイルだけを add する。
- **スコープを超えない** — 依頼された作業と無関係な別件の変更が混ざっていないか点検する。混ざっていれば別コミット・別ブランチに切り出すか、ユーザーに報告する。
- **`develop` / `main` に直接コミットしない** — 作業ブランチ上であることを確認する（`branch-start` スキル参照）。

## 実行手順

### 1. 変更の把握

```bash
git status
git diff              # unstaged
git diff --staged     # staged
git status --ignored  # ignore 対象の混入確認
```

`.gitignore` 対象のファイルが紛れていないか、add 予定に含めていないかを確認する。

### 2. ブランチの確認

現在のブランチが `develop` / `main` でないことを確認する。直コミットになる場合はユーザーに警告し、`branch-start` でブランチを切ることを促す。

### 3. 変更のグルーピング

変更を論理単位にまとめる。無関係な変更・別件は別コミットに分ける。各コミットが 1 つの意味を持つようにする。

### 4. グループごとにコミット

```bash
git add <関連パスのみ>
git commit -m "<type>: <subject>"
```

- `<type>` は変更の実態に合わせる（コミット prefix と実態がズレないこと）。
- `<subject>` は英語 1 文、命令形で簡潔に。

### 5. CHANGELOG 判定

コード変更を含む場合、`changelog` スキルの基準で CHANGELOG 更新の要否を判定する。記載対象なら CHANGELOG を更新してからコミットする（変更と同じ単位のコミットに含める）。

### 6. 完了確認

全コミット後に `git status` を実行し、`working tree clean`（コミット漏れがない）を確認してから完了を報告する。

## チェックリスト

- [ ] `.gitignore` 対象を add していない
- [ ] 現在ブランチが `develop` / `main` でない
- [ ] 変更が論理単位に分割されている
- [ ] 各コミットメッセージが Conventional Commits 形式・英語 1 文
- [ ] prefix と変更の実態が一致している
- [ ] スコープ外の別件が混ざっていない
- [ ] CHANGELOG の更新要否を判定した
- [ ] `git status` が clean
