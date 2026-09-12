# azarashi

個人用 dotfiles。`common/` を `$HOME` へ symlink でデプロイし、任意で `profiles/<name>/`（環境）と `users/<name>/`（個人）を重ねる。本体は POSIX sh の `dotfiles` と `lib/`。依存: `git`, `jq`、`*.fragment.toml` のマージに `python3` >= 3.9（`tomlkit` は同梱）、`gh` は任意。

## コマンド

```sh
./dotfiles install                   # デプロイ + orphan symlink 刈り取り
./dotfiles install --user alice      # users/alice/ を重ねる
./dotfiles install --profile bedrock # profiles/bedrock/ を重ねる（選択は git config に記憶）
./dotfiles install --force           # fragment がリポジトリ側優先で再マージ + 3-way 削除
./dotfiles config                    # 解決された user / profiles / レイヤー順
./dotfiles config --unset-profile    # 記憶したプロファイル選択を解除
./dotfiles diff                      # = install --dry-run
./dotfiles status                    # in-sync / drift / missing / orphan
./dotfiles doctor                    # 壊れた / 移動跡の管理 symlink を検査（read-only）
./dotfiles uninstall                 # 管理 symlink を除去（マージ済み JSON は残す）
./dotfiles clean-backups             # *.dotfiles-bak.* を一覧（--keep / --older-than で削除）
```

```sh
just ci             # check + test（CI と同一）
just check          # shellcheck + shfmt-check
just test           # sh test/run.sh
just shfmt          # フォーマット適用
just hooks-install  # pre-commit hook 配線（初回のみ）
just hooks-run      # 全ファイルに shellcheck / shfmt / gitleaks
just gitleaks-scan  # git 履歴全体のシークレットスキャン
```

## 構成

- `dotfiles` — エントリポイント（POSIX sh）。
- `mirror.conf` — 1 つの正典ファイルを複数配布先へ symlink するミラー宣言。
- `common/` — 全環境共通の配布ペイロード
  - `.agents/AGENTS.md`, `.agents/skills/` — エージェント共通指示とスキル（mirror.conf で `.claude/` `.codex/` `.copilot/` へ展開）
  - `.claude/settings.fragment.json`, `.claude.fragment.json`（MCP: serena）, `.claude/hooks/`, `.claude/statusline.sh`, `.claude/output-styles/`
  - `.codex/config.fragment.toml`, `.codex/hooks.json`
  - `.copilot/settings.fragment.json`, `.copilot/hooks/`, `.copilot/statusline.sh`
  - `.config/git/ignore`, `.config/starship.toml`
  - `.github/pull_request_template.md` — プロジェクトに PR テンプレートが無いときの既定（`pr-create` スキルが参照）
- `profiles/<name>/` — 環境レイヤー（`--profile` で選択）
- `workspace/<name>/` — cocoon で生成する devcontainer 一式（`cocoon.toml` が正典、`.devcontainer/` は生成物、`post-start.sh` だけ手書き）

## 仕組み

### レイヤー

- 優先度の低い順に `common/` → `profiles/<name>/` → `users/<name>/`。全レイヤー同一構造、競合時は上位が勝つ。
- ユーザー解決: `--user` → `git config dotfiles.user` → `gh api user` → 無ければユーザーレイヤー無し。
- プロファイル解決: `--profile`（繰り返し可、後勝ち）→ 環境変数 `DOTFILES_PROFILE`（空白区切り、後勝ち。記憶されない）→ `git config dotfiles.profile` → 無ければ無し。`install` は `--profile` の選択だけを `git config --local dotfiles.profile` に記憶する（`--dry-run` と参照系は書かない）。git config は checkout に置かれホストと `workspace/*` のコンテナで共有されるので、1 環境だけの選択は `DOTFILES_PROFILE` を使う。
- `resolve_layers` が `LAYERS`（高→低）/ `LAYERS_REV`（fragment のマージ順、低→高）/ `ALL_LAYERS`（選択に依らない全レイヤー。prune / uninstall / doctor / clean-backups の走査範囲）を組み立て、優先順位は `layer_src` が決める。
- ディレクトリは実ディレクトリとして作成し、葉（ファイル）だけを symlink する。`~/.claude` 等が丸ごと symlink にならないので、ツールの書き込みでリポジトリが汚れない。

### fragment

- `*.fragment.json` → 対応する JSON へ deep-merge。優先度は 既存値 > user > profile > common（`--force` 時のみリポジトリ側が既存値に勝つ）。
- 配列は上書きではなく追記（完全一致は重複排除）。`hooks` のような集合的配列で下位レイヤーの要素を消さないため。裏返しに `mcpServers.<name>.args` のような位置に意味がある配列は上位から差し替えられない。
- `credentials|token|api[_-]?key|secret|password|firstLaunchAt` に完全一致するキーは fragment から除去され、既存値が常に残る。
- `--force` は前回適用 fragment を `<target>.fragment.base.json` に記録し、fragment から消えたキーを（手動変更が無ければ）3-way で削除する。
- `*.fragment.toml` も同じマージ頭脳。変更キーだけを差し込み、触れないキーはコメント・型・書式ごと保持。fragment 由来の date/time は文字列になる。非標準の `[projects./path]` は取り込み時にクォートし、出力は `[projects."/path"]`。

### mirror.conf

- 各行 `target source`（レイヤ相対、`#` はコメント）。source はレイヤ解決を通るのでユーザー上書きに追従する。ソースが無い行は警告してスキップ。
