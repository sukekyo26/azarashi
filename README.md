# azarashi

個人用の AI エージェント設定リポジトリ。全プロジェクトで共通して使う
AI エージェント向けルール・スキルを **単一の情報源** としてここで管理し、
軽量スクリプトでホームディレクトリ (`~/.claude/` ・ `~/.copilot/`) へデプロイする。

リポジトリ単位 (`<repo>/.claude/`) で同じルールを重複管理する必要をなくし、
編集が全プロジェクトに即反映される状態を目指す。

## 構成

```
.claude/        → ~/.claude/  へデプロイされる内容
  CLAUDE.md       共通ルール (設計原則・コミット規約・ワークフロー)
  skills/         汎用スキル群
  *.fragment.json ~/.claude/<name>.json へ deep-merge される設定断片
.copilot/       → ~/.copilot/ へデプロイされる内容
install.sh      デプロイスクリプト (POSIX sh)
lib/            install.sh のヘルパ
```

`.claude/` と `.copilot/` の中身はデプロイ先と同じ構造になっている。

## 依存

- `git`
- `jq` — JSON 設定のマージに使用

両方とも未導入なら `install.sh` が導入ヒント付きで停止する。

## 使い方

```sh
./install.sh install            # ~/.claude/ ・ ~/.copilot/ へデプロイ
./install.sh install --dry-run  # 実行せず計画のみ表示 (diff のエイリアス)
./install.sh status             # エントリ毎に in-sync / drift / missing を表示
./install.sh uninstall          # azarashi 管理 symlink を除去・backup を復元
./install.sh sync-instructions  # .claude/CLAUDE.md を .copilot/ へ反映
```

デプロイ方式:

- ルール・スキル等のファイル/ディレクトリは **symlink**。リポジトリでの編集が即反映される。
- `*.fragment.json` は既存の `settings.json` 等へ **deep-merge** (既存値優先)。
  ユーザーの既存設定・認証情報は破壊しない。

リポジトリを移動した場合は symlink が切れるので `./install.sh install` を再実行する。
