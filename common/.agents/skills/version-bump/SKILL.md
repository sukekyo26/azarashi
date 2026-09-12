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
- **リリースコミットの表記** — `git log --oneline --grep='release v'` で前例を見て揃える。前例が無ければ `chore: release vX.Y.Z`。

## バージョン決定基準（SemVer）

`## [Unreleased]` の内容から決める。

| Unreleased の内容 | バージョン |
|:--|:--|
| 破壊的変更（`**BREAKING**:`）を含む | **major** (X.0.0) |
| 新機能（`Added`）を含む | **minor** (x.Y.0) |
| `Changed` / `Fixed` / `Removed` のみ | **patch** (x.y.Z) |

**pre-1.0（0.x）の例外**: SemVer §4「初期開発版はいつでも変更してよい」に該当する。破壊的変更があっても `1.0.0` には上げず **minor で吸収する**（0.4.0 → 0.5.0）。`1.0.0` は安定版リリースの意思表示なので、プロジェクトが 0.x 方針を続ける限り `0.y.z` に留める。上げるかどうかはユーザーに確認する。

## 実行手順

### 1. Unreleased の精査

`## [Unreleased]` は前回リリースからの**正味の差分**を表す。バージョンを決める前に `changelog` スキルの「同一バージョン内の整理」「記載対象」に従って見直す。

- **相殺の削除** — 同一 Unreleased 内で追加→削除されて元に戻った変更は、リリース前後で差分ゼロなのでエントリごと削除する。A→B→C と変遷したものは最終状態（A→C）だけを残す。
- **対象外エントリの除去** — 内部リファクタ・テスト追加・CI 設定変更など、エンドユーザーの操作・設定・動作が変わらない項目を削除する。
- 二言語の CHANGELOG を持つプロジェクトでは、整理を全ロケールに同じ内容で適用する。

### 2. バージョンを決定

精査後の Unreleased から SemVer で決める。pre-1.0 の破壊的変更はユーザーに確認する。

### 3. バージョン表記を一斉更新

「プロジェクト固有情報の判定」で洗い出した箇所を**すべて**新バージョンに更新する。1 箇所でも取り残すと、表示バージョンとリリース実体がずれる。

### 4. CHANGELOG をリリース節に切り出す

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

### 5. develop へリリースコミットを載せる

`develop` は保護されていて直接 push できないことが多い。`chore/release-vX.Y.Z` のようなブランチを切り、リリースコミット（表記どおりのメッセージ）1 つにまとめて `develop` 宛の PR を出し、**squash マージ**する。squash なので develop 上のコミットメッセージがそのまま PR タイトルになる。

### 6. develop → main のリリース PR

`pr-create` スキルの手順で作成する。リリース PR 固有の要点:

- **タイトルは `develop` 上のリリースコミットと同一**にする。
- 本文はリリース専用テンプレート（`.github/PULL_REQUEST_TEMPLATE/release.md`、無ければ `~/.github/` の既定）に従い、`Released changes` に今回追加した `## [X.Y.Z]` 節の内容をそのまま転記する。
- **マージ方式は merge commit**。ここを squash すると `main` が `develop` の履歴から分岐し、次のリリースで全ファイルが衝突する。通常の開発 PR（→ `develop`）が squash なのと対照的なので取り違えない。
- マージ後にリリース自動化（タグ・成果物・公開）が走るなら、その前提が満たされているか確認する。

## チェックリスト

- [ ] Unreleased を精査した（相殺・対象外エントリを除去、全ロケール同期）
- [ ] SemVer でバージョンを決定した（pre-1.0 の破壊的変更はユーザーに確認）
- [ ] 現行バージョン文字列を全文検索し、ヒットした表記をすべて更新した
- [ ] `## [X.Y.Z] - YYYY-MM-DD` を追加し、`[Unreleased]` は見出しだけ残した（全ロケール）
- [ ] compare リンクを更新した（全ロケール）
- [ ] リリースコミットを PR 経由で `develop` に squash マージした
- [ ] `develop` → `main` のリリース PR をリリーステンプレートで作成し、**merge commit** でマージする旨を確認した
- [ ] CI がグリーン
