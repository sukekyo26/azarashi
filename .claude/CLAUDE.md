# CLAUDE.md

このリポジトリで作業するときのルール。構成・仕組み・コマンド一覧は `README.md` を参照。

## 検証

- コード変更後は `just ci`（= `just check` + `sh test/run.sh`）をグリーンにしてからコミットする。CI と同一内容。
- `test/run.sh` は単一ランナーで個別実行の仕組みはない。常に全件実行する。
- fragment やレイヤーの挙動を確認するときは使い捨て `HOME` に `./dotfiles install` する。ただし `--profile` 付きの `install` はこのリポジトリの `git config --local dotfiles.profile` を書き換える（`workspace/*` のコンテナともホストとも共有される）ので、`--dry-run` を使うか、終わったら `git config --local --unset-all dotfiles.profile` で戻す。

## レイヤー

- レイヤーの知識は `resolve_layers` が組み立てる `LAYERS` / `LAYERS_REV` / `ALL_LAYERS` の 3 変数の外に散らさない。優先順位を決めるのは `layer_src` 1 箇所だけで、他の走査はすべてそれに委ねる。
- レイヤー名は `valid_layer_name` で検証する。3 変数は未クォートの IFS 分割リストなので、空白を含む名前（2 つに割れる）と glob メタ文字 `* ? [ ]` を含む名前（走査のたびに cwd に対して展開される）は拒否される。生の入力（`DOTFILES_PROFILE`、git config の記憶値）は検証前に展開され得るので、その分割ループだけ `set -f` で囲む。
- ディレクトリ全体の symlink は作らない。ディレクトリは常に実体として作成し、葉だけを symlink する（設計の中核制約）。

## fragment

- 配列は追記マージなので、位置に意味がある配列（`mcpServers.<name>.args` 等）を上位レイヤーで差し替えることはできない。差し替えが必要なら fragment ではなく単一勝者のファイルにする。
- `credentials|token|api[_-]?key|secret|password|firstLaunchAt` に完全一致するキーは fragment から除去される。それ以外の名前（`ANTHROPIC_AUTH_TOKEN` 等）は通る。
- profile の fragment には common と重複する項目を書かない。deep-merge で合成されるので、profile 側は差分だけを持つ。
- 単一勝者ファイル（`hooks.json` 等）を profile で上書きすると common の内容が丸ごと消える。追記したいなら fragment 化する。

## リント / フォーマットの分割

shellcheck と shfmt は **POSIX sh** と **bash** で別扱い。新規スクリプトを足すときはどちらのレイヤーかで対象パスが変わる:

- **POSIX sh**: `dotfiles` と `lib/*.sh`（shellcheck `-s sh`、shfmt `-ln posix`）。
- **bash**: それ以外の `*.sh`（shebang 駆動）。shfmt の対象は `common/` と `profiles/`。

`dotfiles` は拡張子を持たず `*.sh` glob に掛からないので、`justfile` と `.pre-commit-config.yaml` の POSIX sh 側でファイル名を明示列挙する必要がある。漏らすとエラーにならず黙ってリント対象外になる。スクリプトやディレクトリを追加したら両方の対象 glob を確認する。

## workspace/

- `workspace/<name>/.devcontainer/` は cocoon の生成物。`cocoon.toml` を編集して `cocoon gen` で再生成する。手で編集してよいのは `post-start.sh` だけ。
