# Claude Code の output style と組み込み指示の調整

Claude Code 固有の作法を system prompt 層に載せる設定。AGENTS.md / CLAUDE.md（会話に注入される層）より
強く効き、他のエージェントにも漏れない。

| 何をするか | 設定場所 | 配布 |
| --- | --- | --- |
| output style `Lean` を system prompt に追記する | `common/.claude/output-styles/lean.md` + fragment の `outputStyle` | `dotfiles` |
| 「Read/Edit ではなく Bash で作業しろ」という組み込み指示を消す | fragment の `env.CLAUDE_CODE_THRIFTY_SONIC=0` | `dotfiles` |

## output style（`lean.md`）

`Denied paths` 節だけを持つ。`Read(...)` deny の対象（依存・キャッシュディレクトリ）を、必要なときだけ Bash の `cat`
（hook が `rtk read` に書き換え、Read deny の対象外）で意図的に読んでよいこと、秘密情報のパスは Bash でも読めないことを伝える。
この説明が無いと、deny を「読んではいけない」方針と受け取ってライブラリ内のスタックトレースを追えずに止まり得る。
Edit の作法（`replace_all`・既存ファイルを Write で上書きしない）は組み込みのツール説明にあるので書かない。

frontmatter の `keep-coding-instructions: true` により、Claude Code 組み込みの指示を残したまま上乗せする。

- **`outputStyle` の値は frontmatter の `name`**（ファイル名ではない）。
- `settings.local.json` の `outputStyle` は user settings より優先される。効かないときはまずそこを見る。
- 反映はセッション開始時のみ。`/clear` か再起動が必要。
- output style は**メインの会話にのみ**適用され、subagent には効かない。

## `CLAUDE_CODE_THRIFTY_SONIC=0`

組み込み system prompt の「Do your work through the Bash tool …」という指示を消し、標準の Read / Edit / Grep を
使わせる。Edit の後にだけ返る LSP の自動診断と、`Read(...)` の deny ルールを効かせるのに要る。
output style はこの指示を置換しないので、output style とは別に必要。

## 反映確認

```sh
jq '{env, outputStyle}' ~/.claude/settings.json
# => { "env": { "CLAUDE_CODE_THRIFTY_SONIC": "0" }, "outputStyle": "Lean" }
ls -l ~/.claude/output-styles/lean.md   # => common/ への symlink
```

新しいセッションで、system prompt に `Denied paths` 節があり、
「Do your work through the Bash tool …」が無いことを確認する。

## 出典

- `CLAUDE_CODE_THRIFTY_SONIC` の発見元: <https://kawasin73.hatenablog.com/entry/2026/09/05/092056>
