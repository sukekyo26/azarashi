# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## 概要

`azarashi` は dotfiles 管理リポジトリ。`common/` 配下を `$HOME` へ symlink でデプロイし、任意で `profiles/<name>/`（環境レイヤー）と `users/<name>/`（個人レイヤー）を重ねる。本体は POSIX sh の `dotfiles` と `lib/` のライブラリのみ。依存は `git` と `jq`、`*.fragment.toml` のマージに `python3` >= 3.9（`tomlkit` は `lib/vendor/` に同梱、`gh` は任意）。

## コマンド

開発は devcontainer 内で `just` を使う（`just` 単体でレシピ一覧）。

```sh
just ci             # ローカル全スイート = check + test（CI と同一）
just check          # shellcheck + shfmt-check のみ
just test           # lib のユニットテスト（sh test/run.sh、jq に依存。TOML テストは python3 が無ければ skip）
just shfmt          # shfmt でフォーマット適用（in-place）
just hooks-install  # 初回のみ: pre-commit hook を git に配線
just hooks-run      # 全ファイルに shellcheck / shfmt / gitleaks
just gitleaks-scan  # git 履歴全体のシークレットスキャン
```

単一テストの実行: `test/run.sh` は lib 全体を検査する単一ランナー。個別ケースだけを走らせる仕組みはないので、`sh test/run.sh` で全件実行する。

`./dotfiles` の主要サブコマンド:

```sh
./dotfiles install                 # デプロイ + orphan symlink 刈り取り
./dotfiles install --user alice    # users/alice/ を重ねる
./dotfiles install --profile bedrock # profiles/bedrock/ を重ねる（選択は git config に記憶される）
./dotfiles config                  # 解決された user / profiles / レイヤー順を表示
./dotfiles config --unset-profile  # 記憶したプロファイル選択を解除
./dotfiles diff                 # = install --dry-run（計画のみ）
./dotfiles status               # in-sync / drift / missing / orphan を報告
./dotfiles doctor               # 壊れた / 移動跡の管理 symlink を検査（read-only、異常時 nonzero）
./dotfiles uninstall            # 管理 symlink を除去（マージ済み JSON は残す）
./dotfiles clean-backups        # *.dotfiles-bak.* を一覧（--keep / --older-than 指定時のみ削除）
```

## アーキテクチャ

**N レイヤーのミラーリング**: 優先度の低い順に `common/`（全員）→ `profiles/<name>/`（実行環境ごと。例: Bedrock 版と subscription 版で `env` や `statusLine.command` を変える）→ `users/<name>/`（個人）を重ねる。全レイヤーが同一構造で、競合時は上位が勝つ。

- ユーザー解決順: `--user` → `git config dotfiles.user` → `gh api user` → いずれも無ければユーザーレイヤー無し。
- プロファイル解決順: `--profile`（繰り返し指定可、後勝ち）→ 環境変数 `DOTFILES_PROFILE`（空白区切り、後勝ち。**記憶されない**。git config は checkout に置かれホストと複数コンテナで共有されるため、1 環境だけの選択はこちらを使う）→ `git config dotfiles.profile` → 無ければプロファイル無し。`install` は `--profile` の選択を `git config --local dotfiles.profile` に記憶するので、以後はフラグ不要。`--dry-run` と参照系コマンドは記憶を書き換えない。解除は `config --unset-profile`。
- レイヤーのリストは `resolve_layers` が `LAYERS`（優先度高→低）/ `LAYERS_REV`（fragment のマージ順、低→高）/ `ALL_LAYERS`（選択に依らない全レイヤー。prune / uninstall / doctor / clean-backups の走査範囲）の 3 変数に組み立てる。**レイヤー知識をこの 3 変数の外に散らさないこと。** 優先順位を決めるのは `layer_src` 1 箇所だけで、他の走査はすべてそれに委ねる。
- レイヤー名は `valid_layer_name` で検証する。3 変数は IFS 分割されるリストなので、空白を含む名前は拒否される。

**ディレクトリは実体・葉だけ symlink**: ディレクトリは常に実ディレクトリとして作成し、ファイル（葉）のみを個別 symlink する。`~/.claude` などが丸ごと symlink にならないため、ツールがそこへ書き込んでもリポジトリを汚さない。これが設計の中核制約 — ディレクトリ全体の symlink は作らない。

**`*.fragment.json` の deep-merge**: fragment は対応する settings JSON へ deep-merge される。優先度は 既存値 > ユーザー fragment > プロファイル fragment > 共通 fragment（`--force` 時のみリポジトリ fragment が既存値に勝つ）。fragment だけが全レイヤーを合成し、他の走査はすべて単一勝者である点に注意。**配列は上書きではなく追記**で、下位レイヤーの要素を残したまま上位レイヤーの新規要素を後ろに足す（完全一致は重複排除）。`hooks` のような集合的な配列で、プロファイルに 1 件足しただけで common の全 hook が消える事故を防ぐため。裏返しに、`mcpServers.<name>.args` のような**位置に意味がある配列は上位レイヤーから差し替えられず追記のみ**になる。credentials/token 等の保護キーは常に温存。`--force` では **3-way 削除** を行い、前回適用 fragment を `<settings>.fragment.base.json` に記録して、fragment から消えたキーを（手動変更が無ければ）同期削除する。

**`*.fragment.toml` の deep-merge**: TOML fragment（例 `.codex/config.toml`）も同じ JSON マージ頭脳を再利用する。境界の TOML↔JSON 変換と書き戻しは同梱 `tomlkit` 経由（`lib/toml_merge.py`）で行い、**変更キーだけ**を差し込む。fragment が触れないキーはコメント・型・書式ごとそのまま保持される。一方、fragment が新規追加/変更する値は JSON 境界（date/time 型を持たない）を通るため、fragment 由来の date/time は文字列として書き戻る（既存の未変更値は影響なし）。非標準の `[projects./path]`（仕様違反の裸キー `/`）が混ざっていてもパース前にクォートして取り込み、出力は codex のリーダーが要求する仕様準拠のクォート形 `[projects."/path"]` で書く（入力に寛容・出力は valid）。

**`mirror.conf`**（リポルート）: 1 つの正典ファイルを複数配布先へ symlink でミラーする宣言。各行は `target source`（レイヤ相対、`#` はコメント）。source はレイヤ解決を通るのでユーザー上書きに追従する。例: `.agents/AGENTS.md` を `.claude/CLAUDE.md` と `.copilot/copilot-instructions.md` へ。ソースが見つからない行は警告してスキップ（fatal にしない）。

### 主要ファイル

- `dotfiles` — エントリポイント。POSIX sh。`lib/common.sh` と `lib/json_merge.sh` を source。
- `lib/common.sh` — ログ（`log`/`info`/`warn`/`err`/`die`）、`backup`、`newest_backup`、symlink ヘルパー（`is_our_link` / `is_managed_link` / `link_path`）。
- `lib/json_merge.sh` — fragment マージのコア（`merge_json` ほか）。
- `lib/toml_merge.sh` — TOML fragment マージ（`merge_toml`）。境界変換と書き戻しを `lib/toml_merge.py` に委譲し、頭脳は `json_merge.sh` を再利用。
- `lib/toml_merge.py` — 同梱 `tomlkit`（`lib/vendor/tomlkit/`, MIT）を使う TOML↔JSON ブリッジ。フォーマット保持の書き戻しと codex 方言の正規化を担う。
- `test/run.sh` — `lib/` のユニットテスト。グローバルはハーネスがケースごとに所有。
- `common/` — 配布ペイロード（`.agents/`, `.claude/`, `.copilot/` の設定・statusline・hooks）。
- `profiles/bedrock/` — Bedrock 環境レイヤー。`env.CLAUDE_CODE_USE_BEDROCK` のみを上書きする。`common/.claude/statusline.sh` は Bedrock と Anthropic API 直の**どちらもトランスクリプトのモデル ID から実行時に判定**するため、statusline はプロファイルで分けていない。

## リント / フォーマットの分割（重要）

shellcheck と shfmt は **POSIX sh** と **bash** で別扱い。新規スクリプトを足すときはどちらのレイヤーかで対象パスが変わる:

- **POSIX sh** 扱い: `dotfiles` と `lib/*.sh`（shellcheck `-s sh`、shfmt `-ln posix`）。
- **bash** 扱い: それ以外の `*.sh`（特に `common/`、shebang 駆動）。

**エントリポイント `dotfiles` は拡張子を持たない。** `*.sh` glob には**絶対に掛からない**ので、リント対象に含めるには `justfile` と `.pre-commit-config.yaml` の POSIX sh 側でファイル名を明示的に列挙する必要がある。ここから漏らすと、エラーにならず黙ってリント対象外になる。

`.pre-commit-config.yaml` と `justfile` の両方にこの分割が反映されている。スクリプト追加時は対象 glob を両方で確認すること。

## CI

`.github/workflows/ci.yml` が `just check`（lint）、`sh test/run.sh`（lib テスト）、`dotfiles` の E2E（クリーン HOME での install / status / 冪等性 / `--force` 再マージと 3-way 削除 / prune 安全性 / clean-backups / doctor / uninstall / per-user overlay / per-profile overlay と選択の記憶・解除）を実行する。`just ci` がローカルでこの中核を再現する。
