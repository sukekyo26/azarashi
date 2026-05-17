# azarashi

個人用リポジトリ。複数プロジェクトをまたいで使う共通設定・スクリプト・ツールなどを
まとめる。用途は限定せず、必要に応じて広げていく。

現在の主な用途:

- **共通 AI エージェント設定** — 全プロジェクトで共通のルール・スキルを単一の情報源
  として管理し、`install.sh` でホームディレクトリへデプロイする。

## デプロイ (install.sh)

リポジトリ直下の `.<name>/` ディレクトリがデプロイ対象。その中身が `~/.<name>/` へ
配置される（`.claude/` → `~/.claude/` など）。対象は自動検出されるので、新しい
`.<name>/` を追加するだけで増やせる。

- ファイル・ディレクトリは symlink（リポジトリでの編集が即反映される）。
- `*.fragment.json` は既存の JSON 設定へ deep-merge（既存値が優先され、認証情報・
  既存設定は破壊しない）。

依存: `git` ・ `jq`

```sh
./install.sh install                  # 全対象をホームへデプロイ
./install.sh install --dry-run         # 計画のみ表示（diff のエイリアス）
./install.sh install --target claude   # 対象を限定（カンマ/スペース区切りで複数可）
./install.sh status                    # in-sync / drift / missing を表示
./install.sh uninstall                 # 管理 symlink を除去し backup を復元
./install.sh --help                    # 全コマンド・フラグ
```

リポジトリを移動すると symlink が切れるので `./install.sh install` を再実行する。

## 開発

`just check` で shell スクリプトの lint（shellcheck）と整形チェック（shfmt）を実行する。
