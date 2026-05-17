---
name: version-bump
description: 'Bump project version following Semantic Versioning. Use when asked to: (1) Release a new version, (2) Bump major/minor/patch version, (3) Move Unreleased changelog entries to a new release. Triggers: "version bump", "bump version", "release", "バージョンアップ", "バージョン上げ", "リリース", "semver".'
---

# バージョンアップ手順

セマンティックバージョニングに基づきプロジェクトバージョンを更新する。

## プロジェクト固有情報の参照

バージョンを記載するファイルと bump 後の同期コマンドはプロジェクト依存。
リポジトリ root の `.claude/project.json` から読む。形式:

```json
{
  "versionFiles": ["VERSION", "internal/version/version.go"],
  "postBumpCommands": [],
  "changelogFiles": ["CHANGELOG.md", "docs/CHANGELOG.ja.md"]
}
```

- `versionFiles` — バージョン文字列を持つファイル群（すべて新バージョンに書き換える）
- `postBumpCommands` — bump 後に実行する同期コマンド（lockfile 更新・スキーマ再生成等。無ければ空配列）
- `changelogFiles` — CHANGELOG ファイル群

`.claude/project.json` が無い場合は、上記をユーザーに確認してから進める。

## バージョン決定基準（SemVer）

| 変更内容 | バージョン |
|:---------|:-----------|
| 破壊的変更（BREAKING） | **major** (X.0.0) |
| 新機能追加（Added） | **minor** (x.Y.0) |
| バグ修正のみ（Fixed/Changed/Removed without BREAKING） | **patch** (x.y.Z) |

> **pre-1.0（0.x）の例外**: メジャー 0 系は SemVer §4「初期開発用、いつでも変更してよい」に該当する。BREAKING があっても major（1.0.0）には上げず **minor で吸収する**（0.4.0 → 0.5.0）。1.0.0 は安定版リリースの意思表示なので、プロジェクトの alpha v0.x 方針が続く限り `0.y.z` に留める。

> CHANGELOG のカテゴリは `Added` → `Changed` → `Fixed` → `Removed` の 4 種類のみ。詳細は `changelog` スキル参照。

CHANGELOG の `## [Unreleased]` セクションの内容から判断する。

## 手順

1. CHANGELOG の `## [Unreleased]` の内容を確認し、SemVer に従いバージョンを決定する。

2. **CHANGELOG 精査（リリース前の必須チェック）**: `## [Unreleased]` は前回リリースからの**正味の差分**を表す。リリース確定前に、`changelogFiles` 全ファイルの `## [Unreleased]` を `changelog` スキルの基準で見直し、最終的に残すべきエントリだけにする。
   - **相殺の削除**: 同一 Unreleased 内で追加→削除されて元に戻った変更は、リリース前後で見ると差分ゼロなのでログ自体が不要 → エントリを両方とも削除する。
     - Added した機能を同バージョン内で Removed した → 両方削除
     - A→B→A と元に戻った → 削除
     - A→B→C と変遷した → 最終状態のみ（A→C）を記載
   - **対象外エントリの除去**: エンドユーザーの操作・設定・動作が変わらない項目（内部ロジックのリファクタリング、内部関数のリネーム、ファイル移動、テスト追加、CI/lint 設定変更等）が紛れていないか精査し、見つけたら削除する。判断基準と除外リストは `changelog` スキルの「記載対象」節に従う。
   - 整理は二言語の CHANGELOG を持つ場合、両方に同じ内容を適用する。

3. `versionFiles` の各ファイルのバージョン文字列を新バージョンに書き換える。

4. CHANGELOG を更新する: `## [Unreleased]` の直下に `## [x.y.z] - YYYY-MM-DD` 見出しを追加し、Unreleased の内容を新バージョン側へ移す。`## [Unreleased]` 見出しは残す（次の開発用）。見出しの下は空にする。`changelogFiles` 全ファイルに適用する。

5. `postBumpCommands` を順に実行する（lockfile 更新・生成物の再同期等）。

6. プロジェクトのテスト・リントを実行してグリーンを確認する（`versionFiles` 変更で test 影響がないか保険的に）。

7. コミット: `feat: release vX.Y.Z` を **`develop` ブランチに直接コミット**する（version bump は「機能単位で feature/ ブランチを切る」ルールの例外。`feature/release-vX.Y.Z` は作らない）。その後 `develop` を push し、`develop` → `main` のリリース PR を出す。

## CHANGELOG フォーマット

```markdown
## [Unreleased]

## [x.y.z] - YYYY-MM-DD

### Added
- ...

### Changed
- ...

### Fixed
- ...

### Removed
- ...
```

`## [Unreleased]` と `## [x.y.z]` の間に空行を 1 つ入れる。

ファイル末尾の比較リンク参照も更新する（二言語なら両ファイル）。`[Unreleased]` の比較元を新バージョンに差し替え、新バージョンの行を 1 つ追加する:

```markdown
[Unreleased]: https://github.com/<owner>/<repo>/compare/vX.Y.Z...HEAD
[X.Y.Z]: https://github.com/<owner>/<repo>/compare/v<前バージョン>...vX.Y.Z
```
