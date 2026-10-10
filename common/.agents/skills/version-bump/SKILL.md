---
name: version-bump
description: 'セマンティックバージョニングに従ってプロジェクトのバージョンを上げ、CHANGELOG の Unreleased をリリース節に切り出し、リリース PR まで繋ぐ。Triggers: "バージョンアップ", "バージョン上げ", "リリース", "リリース準備", "version bump", "bump version", "release", "semver".'
---

# version-bump

バージョン表記の更新と CHANGELOG のリリース節切り出しを行い、`develop` → `main` のリリース PR まで繋ぐ。CHANGELOG の記載ルール（カテゴリ・記載対象・整理）は `changelog` スキル、PR の作成は `pr-create` スキルに委ねる。

## プロジェクト固有情報の判定

設定ファイルに頼らずリポジトリから判定する。判定できなければユーザーに確認する。

- **現行バージョン** — `VERSION` / `package.json` / `pyproject.toml` / `Cargo.toml` / CHANGELOG の最新リリース節などから読む。
- **バージョン表記の所在** — 現行バージョン文字列で全文検索し、**ヒットした箇所をすべて洗い出す**（`git grep -nF "$current_version"` — CHANGELOG の履歴行やロックファイルは除外）。ビルド時に注入される値とソース内のリテラルが二重に存在する言語（Go の ldflags + `version.go` など）は両方を lockstep で更新する。片方だけ直すとインストール経路によって表示が食い違う。
- **リリース自動化** — `.github/workflows/` にタグ・リリース公開のワークフローがあるか、そのトリガー条件（タグ push / 特定ファイルの変更 / 手動）を確認する。
- **タイトルの表記** — `develop` への準備 PR とそのコミットは `chore: prepare release vX.Y.Z` に固定する。中身は CHANGELOG とバージョン表記の更新だけなので、`main` へのリリース PR と名前を分け、PR 一覧と `git log` で見分けられるようにする。`main` へのリリース PR は `git log origin/main --first-parent --oneline --grep='release v'` で前例を見て揃え（`feat:` / `chore:` などの型）、前例が無ければ `chore: release vX.Y.Z`。
- **CHANGELOG ファイル** — `changelog` スキルと同じ方法で検出する。**無ければ新規作成せず、CHANGELOG 関連の手順（下記 1 と 4）を丸ごとスキップする**。以降「CHANGELOG がある場合」と書かれた手順はすべてこの判定に従う。

## バージョン決定基準（SemVer）

CHANGELOG があれば `## [Unreleased]` の内容から、無ければ前回リリース以降のコミット（`git log <前回タグ or main>..HEAD`）の Conventional Commits プレフィックスから決める。

| 内容 | バージョン |
|:--|:--|
| 破壊的変更（`**BREAKING**:` / `feat!:` / `BREAKING CHANGE:`） | **major** (X.0.0) |
| 新機能（`Added` / `feat:`） | **minor** (x.Y.0) |
| それ以外（`Changed` / `Fixed` / `Removed` / `fix:` 等のみ） | **patch** (x.y.Z) |

**pre-1.0（0.x）の例外**: SemVer §4「初期開発版はいつでも変更してよい」に該当する。破壊的変更があっても `1.0.0` には上げず **minor で吸収する**（0.4.0 → 0.5.0）。`1.0.0` は安定版リリースの意思表示なので、プロジェクトが 0.x 方針を続ける限り `0.y.z` に留める。上げるかどうかはユーザーに確認する。

## 実行手順

最新の `develop` の上で始める（`git fetch origin && git switch --detach origin/develop`）。ブランチはバージョンが決まる手順 5 で切る。

### 1. Unreleased の精査（CHANGELOG がある場合）

`## [Unreleased]` は前回リリースからの**正味の差分**を表す。バージョンを決める前に `changelog` スキルの「同一バージョン内の整理」「記載対象」に従って見直す。

- **相殺の削除** — 同一 Unreleased 内で追加→削除されて元に戻った変更は、リリース前後で差分ゼロなのでエントリごと削除する。A→B→C と変遷したものは最終状態（A→C）だけを残す。
- **対象外エントリの除去** — 内部リファクタ・テスト追加・CI 設定変更など、エンドユーザーの操作・設定・動作が変わらない項目を削除する。
- 二言語の CHANGELOG を持つプロジェクトでは、整理を全ロケールに同じ内容で適用する。

### 2. バージョンを決定

精査後の Unreleased（無ければコミット履歴）から SemVer で決める。pre-1.0 の破壊的変更はユーザーに確認する。

精査後の Unreleased が空（CHANGELOG が無ければ、前回リリース以降に外部から見える変更が無い）なら、リリースするものが無い。ここで中止してユーザーに伝える。

### 3. バージョン表記を一斉更新

「プロジェクト固有情報の判定」で洗い出した箇所を**すべて**新バージョンに更新する。1 箇所でも取り残すと、表示バージョンとリリース実体がずれる。

### 4. CHANGELOG をリリース節に切り出す（CHANGELOG がある場合）

```markdown
## [Unreleased]

## [X.Y.Z] - YYYY-MM-DD

### Added
- ...
```

- 日付は `date +%F` で取得する（推測しない）。
- `## [Unreleased]` 見出しは**残して中身を空にする**（次の開発用）。見出しとの間に空行を 1 つ入れる。
- 実在するカテゴリだけを残し、空カテゴリは書かない。
- ファイル末尾の compare リンクを更新する。`[Unreleased]` の比較元を新バージョンに差し替え、新バージョンの行を 1 つ追加する。

```markdown
[Unreleased]: https://github.com/<owner>/<repo>/compare/vX.Y.Z...HEAD
[X.Y.Z]: https://github.com/<owner>/<repo>/compare/v<前バージョン>...vX.Y.Z
```

- 全ロケールの CHANGELOG に同じ構造を適用する。

### 5. develop へ準備 PR を出す

`develop` は保護されていて直接 push できないことが多い。`chore/release-vX.Y.Z` のようなブランチを切り、`chore: prepare release vX.Y.Z` のコミット 1 つにまとめて `develop` 宛の PR（同じタイトル）を出し、**squash マージ**する。squash なので develop 上のコミットメッセージがそのまま PR タイトルになる。

### 6. develop → main のリリース PR

マージ後に `git switch develop && git pull --ff-only` で準備コミットを手元の `develop` に取り込んでから、`pr-create` スキルの手順で作成する。古い `develop` から作ると準備コミットが PR に入らない。リリース PR 固有の要点:

- **タイトルは「タイトルの表記」で決めた `main` 側の表記**（例: `chore: release vX.Y.Z`）。準備 PR の `chore: prepare release vX.Y.Z` とは別の名前にする。
- 本文はリリース専用テンプレート（`.github/PULL_REQUEST_TEMPLATE/release.md`、無ければ `~/.github/` の既定）に従う。`Released changes` には今回追加した `## [X.Y.Z]` 節の内容をそのまま転記する。CHANGELOG が無いプロジェクトでは、前回リリース以降のコミットから外部に見える変更を同じカテゴリ（Added / Changed / Fixed / Removed）で書き起こす。
- **マージ方式は merge commit**。ここを squash すると `main` が `develop` の履歴から分岐し、次のリリースで全ファイルが衝突する。通常の開発 PR（→ `develop`）が squash なのと対照的なので取り違えない。
- マージ後にリリース自動化（タグ・成果物・公開）が走るなら、その前提が満たされているか確認する。

## チェックリスト

- [ ] 最新の `origin/develop` の上で始めた
- [ ] (CHANGELOG がある場合) Unreleased を精査した（相殺・対象外エントリを除去、全ロケール同期）
- [ ] SemVer でバージョンを決定した（pre-1.0 の破壊的変更はユーザーに確認。リリースするものが無ければ中止した）
- [ ] 現行バージョン文字列を全文検索し、ヒットした表記をすべて更新した
- [ ] (CHANGELOG がある場合) `## [X.Y.Z] - YYYY-MM-DD` を追加し、`[Unreleased]` は見出しだけ残し、compare リンクを更新した（全ロケール）
- [ ] `chore: prepare release vX.Y.Z` を PR 経由で `develop` に squash マージした
- [ ] 手元の `develop` を pull してから、`develop` → `main` のリリース PR を `main` 側の表記のタイトルとリリーステンプレートで作成し、**merge commit** でマージする旨を確認した
