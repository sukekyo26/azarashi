# azarashi

個人用の共通設定・スクリプト置き場。

## install.sh

`home/` 配下を `$HOME` にミラーする。依存: `git`, `jq`。

```sh
./install.sh install            # デプロイ + orphan 刈り取り
./install.sh install --dry-run  # 計画のみ
./install.sh install --no-prune # 刈り取り抑止
./install.sh status             # in-sync / drift / missing / orphan
./install.sh uninstall          # 管理 symlink を除去
./install.sh --help
```

- ディレクトリは丸ごと symlink。既に実ディレクトリがあれば子要素を個別 symlink。
- `*.fragment.json` は対応する JSON へ deep-merge（既存値優先）。
- リポジトリを移動したら再 install。
