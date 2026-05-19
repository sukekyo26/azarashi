---
name: branch-start
description: 'develop から作業ブランチ（feature/* ・ fix/* 等）を規約通りに切る。最新の develop を取得し、変更種別に応じた prefix のブランチを作成する。Triggers: "ブランチを切る", "作業ブランチ作成", "featureブランチ", "fixブランチ", "branch start", "new branch", "create branch", "start branch".'
---

# branch-start

`develop` から作業ブランチを切る。ブランチ名の prefix・起点を規約通りに決め、最新の `develop` を起点に作成する。`sync-upstream` と対になる「作業開始」スキル。

## 大原則

- **`develop` / `main` に直接コミットしない** — 作業は必ず専用ブランチで行う。
- **1 ブランチ = 1 つの変更** — 1 機能追加・1 バグ修正・1 リファクタリングを 1 ブランチに対応させる。複数の独立した変更を混ぜない。
- **常に最新の `origin/develop` から切る** — 現在どのブランチに居ても、起点は `origin/develop`。

## ブランチ命名

`<prefix>/<short-kebab-name>` 形式。prefix は変更の種別に対応させる。

| 変更種別 | prefix | 例 |
|:---------|:-------|:---|
| 機能追加 | `feature/` | `feature/order-api-base-path` |
| バグ修正 | `fix/` | `fix/null-deref-on-empty-config` |
| リファクタリング | `refactor/` | `refactor/extract-validator` |
| 雑務・ビルド・CI | `chore/` | `chore/bump-actions` |
| ドキュメント | `docs/` | `docs/readme-scope` |
| テスト | `test/` | `test/add-merge-cases` |

`<short-kebab-name>` は変更内容が分かる短い英語の kebab-case にする。

## 実行手順

### 1. ブランチ情報の決定

- 依頼内容から変更種別（feature / fix / ...）とブランチ名を推定する。
- 推定した `<prefix>/<name>` をユーザーに提示して確認する。

### 2. 未コミット変更の確認

未コミットの変更がある状態で `git switch -c` すると、その変更は新ブランチへ持ち越される。意図した挙動か（作業を始めてからブランチを切り忘れていた等）をユーザーに確認する。意図しないなら commit / stash を促す。

### 3. ブランチ作成

```bash
git fetch origin develop
git switch -c <prefix>/<name> origin/develop
```

- 現在のブランチに関わらず、必ず `origin/develop` を起点に作成する。
- 同名のブランチが既に存在する場合は **エラーで中断**する（既存ブランチを壊さない）。別名をユーザーに確認する。

### 4. 報告

作成したブランチ名と起点（`origin/develop` の最新コミット）を報告する。

## チェックリスト

- [ ] ブランチ名の prefix が変更種別と一致している
- [ ] 起点が最新の `origin/develop`
- [ ] 同名ブランチが存在しないことを確認した
- [ ] 未コミット変更がある場合、持ち越しの意図をユーザーに確認した
