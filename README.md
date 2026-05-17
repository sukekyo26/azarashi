# azarashi

個人用リポジトリ。複数プロジェクトをまたいで使う共通設定・スクリプト・ツールなどを
まとめる。用途は限定せず、必要に応じて広げていく。

現在の主な用途:

- **共通 AI エージェント設定** — 全プロジェクトで共通のルール・スキルを単一の情報源
  として管理し、`install.sh` でホームディレクトリへデプロイする。

## デプロイ (install.sh)

`home/` ディレクトリの中身が `$HOME` へミラーされる（`home/.claude/` → `~/.claude/`、
`home/.agents/` → `~/.agents/` など）。デプロイ対象を `home/` 配下に隔離してあるので、
リポジトリ直下は azarashi 自身のプロジェクト設定に使える。

- ディレクトリは丸ごと symlink される。ただしデプロイ先が既に実ディレクトリとして
  存在する場合は、その中へ入って子要素ごとにデプロイする（既存の状態を壊さない）。
  ファイルも symlink なので、リポジトリでの編集は即反映される。
- `*.fragment.json` は対応する JSON 設定へ deep-merge される（下記参照）。

依存: `git` ・ `jq`

```sh
./install.sh install            # home/ の中身を $HOME へデプロイ
./install.sh install --dry-run  # 計画のみ表示（diff のエイリアス）
./install.sh status             # in-sync / drift / missing を表示
./install.sh uninstall          # 管理 symlink を除去し、空ディレクトリを刈り取る
./install.sh --help             # 全コマンド・フラグ
```

リポジトリを移動すると symlink が切れるので `./install.sh install` を再実行する。

### settings.fragment.json について

`~/.claude/settings.json` は Claude Code 自身が書き込み、認証情報などユーザー固有の
状態を含むため、丸ごと symlink できない。そこで azarashi が管理したい設定キー
（権限の allowlist、`effortLevel` など）だけを `home/.claude/settings.fragment.json`
に書いておくと、`install` 時に既存の `settings.json` へ deep-merge される。

- 衝突時は**既存の値が優先**され、認証情報など保護対象のキーは書き込まれない。
- 中身が空（`{}`）なら何もしない。現状は空 = 管理対象の設定なし。

## 開発

`just check` で shell スクリプトの lint（shellcheck）と整形チェック（shfmt）を実行する。
