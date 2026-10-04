---
name: repo-setup
description: 'GitHub リポジトリに共通のリポジトリ設定（マージ方法・既定のコミットメッセージ・マージ後のブランチ自動削除）と develop_ruleset / main_ruleset（develop は squash・main は merge の PR 必須、削除・force push 禁止、必須ステータスチェック）を適用する。新規リポジトリの初期設定や既存設定の更新に使う。Triggers: "リポジトリ設定", "ルールセット", "ブランチ保護", "ブランチルール", "repo setup", "ruleset", "branch protection", "protect branches".'
---

# repo-setup

`develop` / `main` の運用（`pr-create` / `sync-upstream` / `version-bump` スキルが前提にしているもの）に合わせたリポジトリ設定とルールセットを、対象リポジトリに適用する。定義はこのスキルの `repo_settings.json` / `develop_ruleset.json` / `main_ruleset.json` が正本で、適用は `apply.sh` が行う。

## 定義

### リポジトリ設定（`repo_settings.json`）

| 設定 | 値 |
|:----|:---|
| squash マージ | 許可。既定のコミットメッセージは PR タイトル |
| マージコミット | 許可。既定のコミットメッセージは PR タイトル |
| rebase マージ | 不許可（どちらの保護ブランチも使わない） |
| マージ後の head ブランチ自動削除 | ON |

### ルールセット

| ルール | develop_ruleset | main_ruleset |
|:------|:---------------|:------------|
| 削除の禁止 | ✓ | ✓ |
| force push の禁止 | ✓ | ✓ |
| PR 必須（直接 push 禁止・承認数 0・会話の解決必須） | ✓ | ✓ |
| 許可するマージ方法 | squash | merge |
| 必須ステータスチェック | ✓ | ✓ |
| マージ前にブランチを最新にする | ✓ | ✗ |
| bypass | なし | なし |

`main` で「最新にする」を外しているのは、`develop` → `main` の merge で `main` にだけマージコミットが残り、有効にすると毎回のリリース PR が「`develop` が古い」で止まるため。

## 実行手順

### 1. 必須チェック名を決める

必須チェックはリポジトリごとに違う。推測で書かず、直近の PR か `develop` の HEAD に実際に付いたチェック名をそのまま使う:

```bash
gh pr checks <number> --json name -q '.[].name'
gh api repos/<owner>/<repo>/commits/develop/check-runs --jq '.check_runs[].name'
```

CI が無いリポジトリではチェック名を渡さない。`required_status_checks` ルールを外して適用する（報告されないチェックを必須にすると全 PR がマージ不能になる）。CI を足したらチェック名付きで `--force` で再適用する。

### 2. 内容を確認してから適用する

```bash
~/.agents/skills/repo-setup/apply.sh --check '<name>' --dry-run       # ペイロードを表示するだけ
~/.agents/skills/repo-setup/apply.sh --repo <owner>/<repo> --check '<name>' ...
```

- `--repo` を省くとカレントディレクトリのリポジトリが対象。
- リポジトリ設定は毎回書き込む（値が固定なので何度実行しても同じ結果になる）。
- 同名のルールセットが既にあれば作り直さずスキップする。定義やチェック名を変えて上書きするときだけ `--force` を付ける。
- 非公開リポジトリでルールセットを使うには GitHub Pro（個人）/ Team（Organization）が必要。

### 3. 結果を確認する

```bash
gh api repos/<owner>/<repo> --jq '{allow_squash_merge, allow_merge_commit, allow_rebase_merge, squash_merge_commit_title, merge_commit_title, delete_branch_on_merge}'
gh api repos/<owner>/<repo>/rulesets --jq '.[].name'
```

## チェックリスト

- [ ] 必須チェック名を実際のチェック実行結果から取った（CI が無ければ渡していない）
- [ ] `--dry-run` で内容を確認した
- [ ] 既存のルールセットを上書きする場合だけ `--force` を付けた
- [ ] 適用後にリポジトリ設定と `develop_ruleset` / `main_ruleset` の 2 つが揃っていることを確認した
