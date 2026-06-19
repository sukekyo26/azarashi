# azarashi

個人用の dotfiles 置き場。`common/`（+ 任意の `users/<name>/`）を `$HOME` へ symlink で配る。依存: `git`, `jq`（`*.fragment.toml` のマージに `python3` >= 3.9。`tomlkit` は同梱）。

```sh
./install.sh            # デプロイ（= install）
./install.sh status     # in-sync / drift / missing / orphan
./install.sh doctor     # 壊れ / 移動跡リンクを検査（--fix で修復）
./install.sh uninstall  # 管理 symlink を除去
./install.sh --help     # 全コマンド / フラグ
```

## 仕組み

- ディレクトリは実体、**葉（ファイル）だけ symlink**。`~/.claude` 等が丸ごと symlink にならないので、ツールが書き込んでもリポジトリを汚さない。
- `users/<name>/` は `common/` と同構造で、競合時に優先（解決順: `--user` → `git config dotfiles.user` → `gh api user`）。
- `*.fragment.json` は対応する JSON へ deep-merge（既存値を温存。`--force` で fragment 優先 + 消えたキーの 3-way 削除。`credentials`/`token` 等の保護キーは常に残す）。
- `mirror.conf` で 1 つの正典ファイルを複数先へミラー（例: `.agents/AGENTS.md` → `.claude/CLAUDE.md`, `.copilot/copilot-instructions.md`）。
- リポジトリを移動したら再 install（または `doctor --fix`）。

devcontainer では `postStartCommand`（`workspace/main/.devcontainer/post-start.sh`）が起動時に `install.sh` を流す。

開発時のチェックは `just`（`just ci` でローカル全スイート）。
