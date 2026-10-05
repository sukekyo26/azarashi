---
name: artifact
description: 'Artifacts 機能が使えない環境で、表・図・比較・レポートなどを単一 HTML ページとして作り、ローカルサーバー（http://localhost:4317）で表示する。過去のページは管理画面で一覧・削除できる。端末のテキストよりページの方が読みやすい内容や、利用者がページ・HTML・可視化を求めたときに使う。Triggers: "ページにして", "HTML にして", "artifact", "アーティファクト", "可視化して", "図にして", "レポートにまとめて", "make a page", "visualize".'
---

# artifact

単一 HTML ページを書き、`artifacts.mjs publish` でローカルサーバーに載せて URL を返す。ネイティブの artifact 公開機能が使える環境ではそちらを使い、このスキルは使わない。

## 手順

1. ページを一時ディレクトリに書く。作業中のリポジトリには置かない。
2. 公開する。

   ```sh
   node ~/.agents/skills/artifact/artifacts.mjs publish <file.html> --slug <slug> --description '<一文の説明>'
   ```

   - サーバーが止まっていれば裏で起動し、ページの URL（`http://localhost:4317/a/<slug>/`）を 1 行出す。
   - 新しい slug のときはブラウザでページを開く（`$BROWSER` → `wslview` → `xdg-open`、macOS は `open`）。開く手段が無い環境では URL を出すだけになる。
   - slug は英小文字・数字・ハイフン。内容を表す短い名前にする（例: `q3-sales-review`）。
   - 同じ slug で公開し直すと上書きされ、URL は変わらない。同じページを直すときは同じ slug を使い、別のページを作るときは別の slug にする。公開し直してもブラウザは開かないので、開いているタブを再読み込みするよう利用者に伝える。
   - タイトルは `<title>` から取る。`--title` で上書きできる。
3. 出力された URL を利用者に伝える。管理画面は `http://localhost:4317/`。

## ページの規約

- **1 ファイルで完結させる**。CSS と JS はインラインで書く。外部スクリプトは cdnjs / jsdelivr / unpkg から、バージョンを固定して読み込む。Web フォントは Google Fonts だけ使い、代替フォントも指定する。Mermaid 図は jsdelivr の mermaid を読み込んで描く。
- **データはページに埋め込む**。ページから他の URL を fetch しない。
- **`<title>` はページの名前にする**（2〜4 語の名詞句）。説明は `--description` に書く。
- **ライト・ダーク両方に対応する**。色は `:root` の CSS 変数として定義し、`@media (prefers-color-scheme: dark)` で変数だけを上書きする。`body` には背景色を明示する。
- **スマホ幅（約 400px）でも横スクロールしない**。左右に 16px 以上の余白を取り、幅の広い表・コード・図はそれぞれ `overflow-x: auto` の箱に入れる。
- **読み込んだ時点で全内容が見えるようにする**。スクロールで出現させる演出はしない。`prefers-reduced-motion` を尊重する。
- **実データを使う**。ダミー文字列を置かない。数値の列は `font-variant-numeric: tabular-nums` で揃える。
- ページは sandbox（opaque origin）で配信される。`localStorage` などは例外を投げ得るので try/catch で包み、使えなくても表示が成り立つようにする。

## 管理

| 操作 | 方法 |
|:----|:----|
| 一覧 | 管理画面、または `artifacts.mjs list`（更新日時・slug・タイトルをタブ区切りで出す） |
| 削除 | 管理画面の削除ボタン、または `artifacts.mjs rm <slug>...` |
| サーバー停止 | `artifacts.mjs stop`。次の `publish` で再び起動する |
| スキル更新後の反映 | `stop` してから `publish` する（動いているサーバーは古いコードのまま） |

- 保存先は `~/.local/share/artifacts/<slug>/`（`ARTIFACTS_DIR` で変更）。ポートは `ARTIFACTS_PORT` で変更できる。
- サーバーは 127.0.0.1 だけで待ち受ける。コンテナの中で動かす場合は、ホストへのポート転送が必要。
