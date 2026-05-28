# dotfiles

チーム共通設定・スクリプト置き場。共通レイヤーに各メンバーの個人レイヤーを重ねられる。
リポジトリ名は自由に変更してよい（ブランド名に依存しない）。

## install.sh

`common/` 配下を `$HOME` にミラーする。さらに `users/<name>/` があればその上に重ねる。依存: `git`, `jq`（`gh` は任意）。

```sh
./install.sh install              # デプロイ + orphan 刈り取り
./install.sh install --user alice # users/alice/ を common/ に重ねる
./install.sh install --dry-run    # 計画のみ
./install.sh install --no-prune   # 刈り取り抑止
./install.sh status               # in-sync / drift / missing / orphan
./install.sh uninstall            # 管理 symlink を除去
./install.sh --help
```

### レイヤー構成

```
common/           # チーム共通（全員にデプロイ）
users/<name>/     # 個人レイヤー（common/ と同構造、競合時に優先）
```

- **ユーザーの解決順**: `--user <name>` → `git config dotfiles.user` → `gh api user` → いずれも無ければ共通のみ。`users/<name>/` が無い場合も共通のみ。
- 片方のレイヤーにしか無いディレクトリは丸ごと symlink。両レイヤーが寄与する（または既に実ディレクトリがある）場合は子要素を個別 symlink し、同名はユーザー側が優先。
- 個人レイヤーがある相対パスに**ファイル**を置くと、共通側の同パスのサブツリー全体を隠す（型はユーザー側が勝つ）。
- `*.fragment.json` は対応する JSON へ deep-merge。優先度は既存値 > ユーザー fragment > 共通 fragment。
- バックアップは上書き前に `*.dotfiles-bak.<UTC timestamp>` として作られる。
- リポジトリを移動したら再 install。

## 開発

devcontainer 内:

```sh
just hooks-install   # 初回のみ: pre-commit hook を git に配線
just hooks-run       # 全ファイルに shellcheck / shfmt / gitleaks を流す
just check           # CI と同じ shellcheck + shfmt のみ
```
