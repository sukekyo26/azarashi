---
name: sync-upstream
description: '現在の作業ブランチへ上流ブランチ（develop）を rebase で取り込む。現在のブランチが develop / main の場合は上流が無いので何もしない。Triggers: "develop取り込み", "上流取り込み", "ブランチ最新化", "developを取り込む", "rebase", "sync upstream", "update branch", "rebase onto develop".'
---

# sync-upstream

現在の作業ブランチ（`feature/*`・`fix/*` 等）へ最新の `develop` を **rebase** で取り込み、ブランチを上流に追従させる。

## 大原則

- **上流ブランチ判定は機械的に** — 現在のブランチが `develop` / `main` なら上流は無く、何もしない。それ以外のブランチは `develop` を取り込む。
- **rebase で取り込む** — マージコミットを作らず履歴を線形に保つ。
- **clean な作業ツリーを要求** — 未コミットの変更があれば中断する。取り込み前に commit するか退避させる。
- **衝突は自動解決しない** — 衝突したら停止し、ユーザーに解決方針を仰ぐ。

## 上流ブランチ決定ロジック

| 現在のブランチ | 上流 | 動作 |
|:-------------|:-----|:-----|
| `develop` | なし | 何もしない（develop は取り込み対象を持たない） |
| `main` | なし | 何もしない（最上流） |
| それ以外（`feature/*`・`fix/*` 等） | `develop` | `develop` を rebase で取り込む |

```bash
current=$(git rev-parse --abbrev-ref HEAD)
case "$current" in
  develop | main) echo "上流ブランチなし: $current — 何もしません"; exit 0 ;;
esac
```

## 実行手順

### 1. 事前チェック

- `git status` が clean（未コミット変更がない）。clean でなければ中断し、commit / stash をユーザーに促す。
- `git rev-parse --abbrev-ref HEAD` で現在のブランチを取得。`develop` / `main` なら「上流なし」と報告して終了する。

### 2. develop を最新化して rebase

```bash
git fetch origin develop
git rebase origin/develop
```

### 3. 衝突時の対応

rebase が衝突で停止したら、**自動解決しない**。

- 衝突ファイル一覧（`git diff --name-only --diff-filter=U`）を提示する。
- ユーザーに方針を確認する:
  - 解決して続行 → 解決後 `git add <files>` → `git rebase --continue`
  - 取り込みを中止 → `git rebase --abort`（ブランチは取り込み前の状態に戻る）

### 4. 取り込み後

- 取り込んだ develop 側のコミット数を報告する。
- **push 済みブランチは force-with-lease が必要** — rebase で履歴が書き換わるため、リモートに同名ブランチがあると通常の push は弾かれる。`git push --force-with-lease` の実行可否をユーザーに確認する（自動では force-push しない）。
- 取り込みでブランチ状態が変わっているため、プロジェクトの CI（テスト・リント一式）をローカルで実行して green を確認することを推奨する。CI コマンドの判定方法は `pr-create` スキルに従う。

## チェックリスト

- [ ] 作業ツリーが clean
- [ ] 現在ブランチが `develop` / `main` でない（該当なら何もせず終了）
- [ ] `origin/develop` を fetch して rebase
- [ ] 衝突した場合、自動解決せずユーザーに方針を確認した
- [ ] push 済みなら `--force-with-lease` の要否をユーザーに確認した
- [ ] 取り込み後の CI 実行を案内した
