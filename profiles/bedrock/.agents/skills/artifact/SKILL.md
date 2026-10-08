---
name: artifact
description: 'Artifacts 機能が使えない環境で、単一 HTML ページを作るか既存の HTML ファイルを登録し、ローカルサーバー（http://127.0.0.1:4317）で表示する。利用者がページ・HTML・ブラウザでの表示を求めたとき、または表やグラフが端末のテキストでは読みにくい量になるときに使う。Triggers: "ページにして", "HTML にして", "ブラウザで", "artifact", "アーティファクト", "この HTML を開いて", "visualize".'
---

# artifact

ネイティブの artifact 公開機能が使える環境ではそちらを使う。

管理画面の操作・リンクの配信範囲・保存先やポートの設定を利用者に聞かれたとき、または publish がエラーで理由が分からないときだけ、同じディレクトリの `README.md` を読む。

## 手順

1. ページを一時ディレクトリに書く（作業中のリポジトリには置かない）。**基本は本文だけを書く**。`<!doctype>`・`<html>`・`<head>`・`<body>`・`<title>` を含まない HTML は、色・ダークモード・余白・表の定型 CSS を持つ雛形で包まれる。雛形に収まらないデザインが要るときだけ完全な HTML を書く。
2. 作業中のプロジェクトのディレクトリで公開する（そのリポジトリ名が生成元として記録される）。

   ```sh
   ~/.agents/skills/artifact/artifacts.sh publish <file.html> --slug <slug> --description '<一文の説明>'
   ```

   - slug は内容を表す英小文字・数字・ハイフン（例: `q3-sales-review`）。同じページを直すときは同じ slug で公開し直す（開いているタブが再読み込みされる）。別のプロジェクトから公開された slug は断られるので、別の slug にする。利用者がそのページを置き換えてよいと言ったときだけ `--force` を付ける。
   - タイトルは `<title>`、無ければ最初の `<h1>` から取る。`--title` で上書きできる。利用者が管理画面で変えたタイトルは公開し直しても保たれ、`--title` だけがそれを上書きする。
   - 戻るリンクやヘッダーは書かない（サーバーが付ける）。
3. 出力された URL を利用者に伝える。管理画面は `http://127.0.0.1:4317/`。

## 既存の HTML を表示する（リンク）

レポートや編集中のドキュメントなど既にある HTML は、`publish <path/to/file.html> --link --slug <slug> --description '…'` でコピーせずに登録する。

- ファイルのあるディレクトリの配下が丸ごと配信対象になる。`$HOME` 直下などは拒否されるので、専用のディレクトリに置いてから登録する。
- ページは sandbox（origin が null）で動く。`<script type="module" src>` と同じサーバーへの `fetch` は CORS で失敗し、ルート相対の参照（`/assets/...`）は届かない。classic な `<script src>`・CSS・画像は読める。

## 雛形のクラス

本文は雛形の `<main>` に入る。直下に `<header>`（`<h1>` を含む）と `<section>`（`<h2>` から始める）を並べる。

| クラス | 用途 |
|:------|:-----|
| `eyebrow` / `lead` / `muted` | 見出し上の小さなラベル / 導入文 / 補足の薄い文字 |
| `cards` > `card` | 横に並び、狭い幅では折り返すカード |
| `stats` > `stat`（`<b>` 値 + `<span>` ラベル） | 目立たせたい数値 |
| `table-wrap` > `table`、`td.num` / `th.num` | はみ出す表を箱の中でスクロールさせる / 数値列を右寄せ・桁揃え |
| `pill` / `note`（`good` / `warn` / `bad`） | 状態の小さなラベル / 注意書きの枠（`note` は `warn` / `bad` のみ） |

色は CSS 変数 `--accent` `--muted` `--line` `--good` `--warn` `--bad` などで参照する。ページ固有の調整だけ本文に `<style>` で足す。

## ページの規約

- **1 ファイルで完結させる**。CSS と JS はインライン。外部スクリプトは cdnjs / jsdelivr / unpkg からバージョンを固定して読み込み、データは埋め込む（他の URL を fetch しない）。
- **タイトルはページの名前にする**（2〜4 語の名詞句）。説明は `--description` に書く。
- **実データを使い、読み込んだ時点で全内容を見せる**（ダミー文字列やスクロールで出現させる演出を使わない）。
- 図（構成図・フロー・シーケンスなど）は Mermaid などの描画ライブラリを使わず inline SVG で描く。描く前に `diagram/guide.md` を読む。データのグラフはこの限りでない。
- `localStorage` などは sandbox で例外を投げ得るので try/catch で包む。
- 完全な HTML を書くときは加えて: 色は `:root` の CSS 変数で定義し `prefers-color-scheme: dark` で上書きする、`body` に背景色を明示する、左右 16px 以上の余白を取り幅約 400px でも横スクロールさせない、Web フォントは Google Fonts と代替フォント、数値列は `tabular-nums`、`prefers-reduced-motion` を尊重する。

## 管理

`~/.agents/skills/artifact/artifacts.sh` の `list`（更新日時・slug・タイトル・リンク先をタブ区切り）、`rm <slug>...`（リンクは登録を外すだけ）、`stop`。
