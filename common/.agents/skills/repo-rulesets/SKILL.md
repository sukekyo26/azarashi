---
name: repo-rulesets
description: 'GitHub リポジトリに develop_ruleset / main_ruleset（develop は squash・main は merge の PR 必須、削除・force push 禁止、必須ステータスチェック）を適用する。新規リポジトリの初期設定や既存ルールセットの更新に使う。Triggers: "ルールセット", "ブランチ保護", "ブランチルール", "ruleset", "branch protection", "protect branches".'
---

# repo-rulesets

`develop` / `main` の運用（`pr-create` / `sync-upstream` / `version-bump` スキルが前提にしているもの）を GitHub 側で強制するルールセットを、対象リポジトリに適用する。定義はこのスキルの `develop_ruleset.json` / `main_ruleset.json` が正本で、適用は `apply.sh` が行う。

## 定義

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
~/.agents/skills/repo-rulesets/apply.sh --check '<name>' --dry-run       # ペイロードを表示するだけ
~/.agents/skills/repo-rulesets/apply.sh --repo <owner>/<repo> --check '<name>' ...
```

- `--repo` を省くとカレントディレクトリのリポジトリが対象。
- 同名のルールセットが既にあれば作り直さずスキップする。定義やチェック名を変えて上書きするときだけ `--force` を付ける。
- 非公開リポジトリでルールセットを使うには GitHub Pro（個人）/ Team（Organization）が必要。

### 3. 結果を確認する

```bash
gh api repos/<owner>/<repo>/rulesets --jq '.[].name'
```

## チェックリスト

- [ ] 必須チェック名を実際のチェック実行結果から取った（CI が無ければ渡していない）
- [ ] `--dry-run` で内容を確認した
- [ ] 既存のルールセットを上書きする場合だけ `--force` を付けた
- [ ] 適用後に `develop_ruleset` / `main_ruleset` の 2 つが揃っていることを確認した
