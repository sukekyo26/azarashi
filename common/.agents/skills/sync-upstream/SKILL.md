---
name: sync-upstream
description: '上流ブランチを merge で取り込む。作業ブランチには develop、develop には main（hotfix 対応）を取り込み、main では何もしない。Triggers: "develop取り込み", "上流取り込み", "ブランチ最新化", "developを取り込む", "mainを取り込む", "rebase", "sync upstream", "update branch", "merge develop".'
---

# sync-upstream

ブランチを上流に追従させる。作業ブランチ（`feature/*`・`fix/*` 等）には `develop` を、`develop` には `main` を取り込む。

## 大原則

- **上流ブランチ判定は機械的に** — `main` は最上流なので何もしない。`develop` の上流は `main`（hotfix で先行しうる）、それ以外のブランチの上流は `develop`。
- **merge で取り込む（rebase しない）** — PR は squash マージされ、ブランチ内のコミット履歴は 1 コミットに潰れて develop に届く。ブランチ側の履歴が線形かどうかは誰も観測しないので、rebase して履歴を書き換える理由が無い。merge なら push 済みブランチでも force-push が不要で、取り込みのマージコミットも squash 時に消える。
- **squash 済みブランチで rebase しない** — PR が squash マージされた後も同じブランチで作業を続けている場合、`git rebase origin/develop` は既に develop へ入った変更を再生しようとして衝突する。取り込みは常に merge、マージ済みの作業を続けるなら develop から新しいブランチを切る。
- **clean な作業ツリーを要求** — 未コミットの変更があれば中断する。取り込み前に commit するか退避させる。
- **衝突は自動解決しない** — 衝突したら停止し、ユーザーに解決方針を仰ぐ。

## 上流ブランチ

| 現在のブランチ | 上流 | 動作 |
|:-------------|:-----|:-----|
| `main` | なし | 何もしない（最上流） |
| `develop` | `main` | `main` が先行していれば取り込む（hotfix が main に直接入ったケース）。先行していなければ何もしない |
| それ以外（`feature/*`・`fix/*` 等） | `develop` | `develop` を merge で取り込む |

`develop` はブランチ保護で直接 push できないことが多い。その場合は取り込み結果を `sync/main-to-develop` のようなブランチに載せ、`develop` 宛の PR として出す（`pr-create` スキル）。

## 実行手順

### 1. 事前チェック

- `git status` が clean。clean でなければ中断し、commit / stash をユーザーに促す。
- 現在のブランチが `main` なら「上流なし」と報告して終了する。
- 上流を決め（`develop` なら `main`、それ以外なら `develop`）、`git rev-list --count HEAD..origin/<upstream>` が 0 なら「取り込むものなし」と報告して終了する。

### 2. 上流を取り込む

```bash
git fetch origin <upstream>
git merge origin/<upstream>
```

### 3. 衝突時の対応

衝突で停止したら**自動解決しない**。

- 衝突ファイル一覧（`git diff --name-only --diff-filter=U`）を提示する。
- ユーザーに方針を確認する:
  - 解決して続行 → 解決後 `git add <files>` → `git merge --continue`
  - 取り込みを中止 → `git merge --abort`（ブランチは取り込み前の状態に戻る）

### 4. 取り込み後

- 取り込んだ上流側のコミット数を報告する。
- push 済みブランチなら通常の `git push` で反映する（履歴を書き換えないので force は不要）。
- ブランチ状態が変わっているため、CI がグリーンであることを確認する。

## チェックリスト

- [ ] 作業ツリーが clean
- [ ] 上流を判定した（`main` なら終了、`develop` なら上流は `main`）
- [ ] 上流が先行しているか確認し、`origin/<upstream>` を fetch して merge（rebase していない）
- [ ] 衝突した場合、自動解決せずユーザーに方針を確認した
- [ ] 取り込み後に push し、CI のグリーンを確認した（`develop` が保護されている場合は PR 経由にした）
