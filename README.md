# azarashi

設定・スクリプト置き場。

## install.sh

`common/` 配下を `$HOME` にミラーする。さらに `users/<name>/` があればその上に重ねる。依存: `git`, `jq`（`gh` は任意）。

```sh
./install.sh install              # デプロイ + orphan 刈り取り
./install.sh install --user alice # users/alice/ を common/ に重ねる
./install.sh install --dry-run    # 計画のみ
./install.sh install --no-prune   # 刈り取り抑止
./install.sh status               # in-sync / drift / missing / orphan
./install.sh uninstall            # 管理 symlink を除去
./install.sh clean-backups        # *.dotfiles-bak.* を一覧（削除しない）
./install.sh clean-backups --keep 3   # 各元ファイルにつき最新 3 件を残して削除
./install.sh doctor               # 壊れた / 移動跡の管理 symlink を検査（read-only）
./install.sh --help
```

### レイヤー構成

```
common/           # チーム共通（全員にデプロイ）
users/<name>/     # 個人レイヤー（common/ と同構造、競合時に優先）
```

- **ユーザーの解決順**: `--user <name>` → `git config dotfiles.user` → `gh api user` → いずれも無ければ共通のみ。`users/<name>/` が無い場合も共通のみ。
- ディレクトリは常に実ディレクトリとして作成し、葉（ファイル）だけを個別 symlink する。`~/.claude` などが丸ごと symlink にならないので、ツールがそこへ書き込んでもリポジトリを汚さず、symlink ディレクトリも残らない。同名ファイルはユーザー側が優先。
- 個人レイヤーがある相対パスに**ファイル**を置くと、共通側の同パスのサブツリー全体を隠す（型はユーザー側が勝つ）。
- `*.fragment.json` は対応する JSON へ deep-merge。優先度は既存値 > ユーザー fragment > 共通 fragment（`--force` 時はリポジトリ fragment が既存値に勝つ。保護キー（credentials/token 等）は常に温存）。
- `--force` 時は **3-way 削除** も行う: 前回適用した fragment を `<settings>.fragment.base.json`（適用先の隣・`$HOME` 側）に記録し、新しい fragment から消えたキーを、現 settings.json がその時点の値のままなら削除して同期する。手動変更したキー・保護キー・base が無い初回は削除しない。`--dry-run` で削除予定キーを表示。この base 状態ファイルは uninstall でも settings.json と同様に残る。
- リポルートの `mirror.conf` で、1 つの正典ファイルを複数の配布先へ symlink としてミラーできる（例: `.agents/AGENTS.md` を `.claude/CLAUDE.md` と `.copilot/copilot-instructions.md` へ）。各行は `target source`（レイヤ相対・`#` はコメント）。source はレイヤ解決を通るのでユーザー上書きにも追従する。ファイルは file symlink、ディレクトリは **1 本の dir symlink**（`~/.claude` 等のドットディレクトリは常に実体なので、`skills` のような中間ディレクトリのみが対象）。
- ユーザーを切り替える / 解除すると、前ユーザー由来の葉 symlink と空になったディレクトリは prune で除去される。
- バックアップは上書き前に `*.dotfiles-bak.<UTC timestamp>` として作られる。
- リポジトリを移動したら再 install。

## 開発

devcontainer 内:

```sh
just hooks-install   # 初回のみ: pre-commit hook を git に配線
just hooks-run       # 全ファイルに shellcheck / shfmt / gitleaks を流す
just check           # CI と同じ shellcheck + shfmt のみ
```
