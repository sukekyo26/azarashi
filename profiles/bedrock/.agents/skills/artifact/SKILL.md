---
name: artifact
description: 'Artifacts 機能が使えない環境で、表・図・比較・レポートなどを単一 HTML ページとして作り、ローカルサーバー（http://127.0.0.1:4317）で表示する。既存の HTML ファイルもコピーせずその場所のまま登録して表示できる。利用者がページ・HTML・ブラウザでの表示を求めたとき、または表やグラフが端末のテキストでは読みにくい量になるときに使う。Triggers: "ページにして", "HTML にして", "ブラウザで", "artifact", "アーティファクト", "この HTML を開いて", "visualize".'
---

# artifact

単一 HTML ページを書き、`artifacts.sh publish` でローカルサーバーに載せて URL を返す。ネイティブの artifact 公開機能が使える環境ではそちらを使い、このスキルは使わない。管理画面の操作や配信の仕組みは同じディレクトリの `README.md` にある。

## 手順

1. ページを一時ディレクトリに書く。作業中のリポジトリには置かない。
   - **基本は本文だけを書く**。`<!doctype>`・`<html>`・`<head>`・`<body>`・`<title>` を含まない HTML は、`publish` が同梱の雛形（フォント・色の変数・ダークモード・余白・表などの定型 CSS 入り）で包む。下の「雛形のクラス」を使い、定型の CSS は書かない。ページ固有の調整が要るときだけ、本文に `<style>` を足す。
   - 雛形に収まらない独自のデザインが要るときは、完全な HTML を書く。その場合は「ページの規約」をすべて自分で満たす。
2. 作業中のプロジェクトのディレクトリで公開する（実行した場所の git リポジトリ名を生成元として記録する）。

   ```sh
   ~/.agents/skills/artifact/artifacts.sh publish <file.html> --slug <slug> --description '<一文の説明>'
   ```

   - `bun` か `node` が要る。サーバーが止まっていれば裏で起動し、ページの URL（`http://127.0.0.1:4317/a/<slug>/`）を 1 行出す。新しい slug のときはブラウザでページを開く。
   - slug は英小文字・数字・ハイフンで、内容を表す短い名前にする（例: `q3-sales-review`）。同じページを直すときは同じ slug で公開し直す（上書きされ、開いているタブが自動で再読み込みされる）。別のページを作るときは別の slug にする。
   - タイトルは `<title>`、無ければ最初の `<h1>` から取る。`--title` で上書きできる。
   - 管理画面へ戻る見出しバーはサーバーが付ける。戻るリンクやヘッダーを自分では書かない。
3. 出力された URL を利用者に伝える。管理画面は `http://127.0.0.1:4317/`。

## 既存の HTML を表示する（リンク）

すでにある HTML（カバレッジやテストのレポート、プロジェクトで編集中のドキュメントなど）は、コピーせずに登録する。

```sh
~/.agents/skills/artifact/artifacts.sh publish <path/to/file.html> --link --slug <slug> --description '<一文の説明>'
```

- 登録するのはパスだけで、リクエストのたびにファイルを読む。ファイルを保存すれば開いているタブが再読み込みされる。本文だけの HTML は配信時に雛形で包む。
- ファイルのあるディレクトリの配下が丸ごと配信対象になる。登録できるのは `.html` / `.htm` だけで、`/` や `$HOME` 直下、ホーム直下の隠しディレクトリの中は拒否される。専用のディレクトリに置いてから登録する。
- slug を省くとファイル名（`index.html` ならディレクトリ名）になる。名前が内容を表さないときは `--slug` で付ける。保存したページとリンクで同じ slug は使えない。種類を変えるときは `rm` してから登録し直す。
- 制限: ページは sandbox（origin が null）で動くので、`<script type="module" src>` と、同じサーバーへの `fetch` は CORS で失敗する。classic な `<script src>`・CSS・画像は読める。ルート相対の参照（`/assets/...`）は `/a/<slug>/` の外を指すので届かない。

## 雛形のクラス

本文は雛形の `<main>` にそのまま入る。直下に `<header>` と `<section>` を並べる。

```html
<header>
  <span class="eyebrow">2026-10-06 · 対象</span>
  <h1>ページの名前</h1>
  <p class="lead">このページで分かることを 1〜2 文。</p>
</header>
<section>
  <h2>見出し</h2>
  <div class="stats"><div class="stat"><b>183</b><span>テスト</span></div></div>
  <div class="cards"><div class="card"><h3>項目</h3><p>説明</p></div></div>
  <div class="table-wrap"><table>
    <thead><tr><th>名前</th><th class="num">件数</th><th>状態</th></tr></thead>
    <tbody><tr><td>a</td><td class="num">12</td><td><span class="pill good">ok</span></td></tr></tbody>
  </table></div>
  <p class="note warn">注意書き</p>
  <pre><code>コード</code></pre>
</section>
```

| クラス | 用途 |
|:------|:-----|
| `eyebrow` / `lead` / `muted` | 見出し上の小さなラベル / 導入文 / 補足の薄い文字 |
| `cards` > `card` | 横に並び、狭い幅では折り返すカード |
| `stats` > `stat`（`<b>` 値 + `<span>` ラベル） | 目立たせたい数値 |
| `table-wrap` > `table`、`td.num` / `th.num` | 横にはみ出す表を箱の中でスクロールさせる。数値列を右寄せ・桁揃え |
| `pill`（`good` / `warn` / `bad`） | 状態の小さなラベル |
| `note`（`warn` / `bad`） | 注意書きの枠 |

色は CSS 変数 `--accent` `--muted` `--line` `--good` `--warn` `--bad` などで参照でき、ダークモードでは自動で切り替わる。

## ページの規約

雛形で包む場合、色・ダークモード・余白・表のはみ出しは雛形が満たす。残りの規約は本文側で守る。

- **1 ファイルで完結させる**。CSS と JS はインラインで書く。外部スクリプトは cdnjs / jsdelivr / unpkg から、バージョンを固定して読み込む。Web フォントは Google Fonts だけ使い、代替フォントも指定する。Mermaid 図は jsdelivr の mermaid を読み込んで描く。Mermaid は既定で図を表示幅まで縮めて文字が読めなくなるので、使う図の種類ごとに `useMaxWidth: false` を指定し（例: `mermaid.initialize({ sequence: { useMaxWidth: false }, flowchart: { useMaxWidth: false } })`）、図は `overflow-x: auto` の箱に入れる。
- **データはページに埋め込む**。ページから他の URL を fetch しない。
- **タイトル（`<title>` または最初の `<h1>`）はページの名前にする**（2〜4 語の名詞句）。説明は `--description` に書く。
- **ライト・ダーク両方に対応する**。色は `:root` の CSS 変数として定義し、`@media (prefers-color-scheme: dark)` で変数だけを上書きする。`body` には背景色を明示する。
- **スマホ幅（約 400px）でも横スクロールしない**。左右に 16px 以上の余白を取り、幅の広い表・コード・図はそれぞれ `overflow-x: auto` の箱に入れる。
- **読み込んだ時点で全内容が見えるようにする**。スクロールで出現させる演出はしない。`prefers-reduced-motion` を尊重する。
- **実データを使う**。ダミー文字列を置かない。数値の列は `font-variant-numeric: tabular-nums` で揃える。
- ページは sandbox（opaque origin）で配信される。`localStorage` などは例外を投げ得るので try/catch で包み、使えなくても表示が成り立つようにする。

## 管理

| 操作 | コマンド |
|:----|:----|
| 一覧 | `~/.agents/skills/artifact/artifacts.sh list`（更新日時・slug・タイトル・リンク先のパスをタブ区切りで出す。保存したページのパスは空） |
| 削除 | `~/.agents/skills/artifact/artifacts.sh rm <slug>...`。リンクは登録を外すだけで、元のファイルは消さない |
| スキル更新後の反映 | `~/.agents/skills/artifact/artifacts.sh stop` してから `publish` する（動いているサーバーは起動したときのコードとランタイムのまま） |
