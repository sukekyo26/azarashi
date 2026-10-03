# Serena を使わない理由と戻し方

Serena（シンボル単位の読み取り・参照追跡・リネームを提供する MCP サーバー）は、以前は Claude Code と Codex に
登録していたが、どちらからも外した。Claude Code は公式 LSP プラグインと組み込みツール、Codex は組み込みの shell と
`apply_patch` で作業する。

## 外した理由

- **Claude Code では公式 LSP プラグインでほぼ代替できる。** `enabledPlugins` の gopls / pyright / rust-analyzer /
  typescript で LSP ツール（`goToDefinition` / `findReferences` / `goToImplementation` / `documentSymbol` /
  `workspaceSymbol` / 呼び出し階層）が使える。Serena 固有なのは「シンボル名で本体を 1 回で読む」ことと
  参照を理解したリネームだけ。
- **Serena の編集は診断が返らない。** Claude Code は自分の Edit / Write の後にしか LSP の自動診断を返さず、
  Serena の編集はディスクを直接書き換えるので、入れた型エラーが後の Edit まで表面化しない（`gopls-lsp` で実測）。
  それでも記録上は Serena の編集（`replace_content` 等）が約 1700 回と Edit（1008 回）を上回っていた。
- **Vue でも実際の出番は小さかった。** 公式 LSP プラグインは `.vue` に対応しない（typescript-lsp の対象は
  `.ts` / `.tsx` / `.js` 系のみ）ので Vue では Serena が唯一の手段だが、2026-09 以降の Vue プロジェクトの記録では
  `.vue` への読み取りは Read 264 回に対し Serena の `find_symbol` / `get_symbols_overview` が 27 回、
  `find_referencing_symbols` は 0 回だった。
- **常時コストがかかる。** ツール定義と output style で毎リクエスト 5k トークン前後、`initial_instructions` を
  呼ぶたびに長いマニュアルが文脈に入る、全ツール呼び出しに `serena-hooks remind` の起動（約 40 ms）、言語サーバーの
  二重起動。加えて上流の system prompt override との差分追従、context / mode の調整といった保守が要った。
- **指示を効かせるのが難しい。** SessionStart hook や CLAUDE.md で「Serena を使え」と流しても守られず、
  Claude Code では output style、Codex では `developer_instructions` という system / developer 層に置く必要があった。

## 移行（各環境で 1 回）

```sh
./dotfiles install --force
claude mcp remove serena --scope user
uv tool uninstall serena-agent
```

- `--force` で Claude Code の `settings.json`（`outputStyle`・`serena-hooks`・`mcp__serena` の allow）と、Codex の
  `config.toml`（`developer_instructions`・`[mcp_servers.serena]`）から消える。いずれも前回 `--force` で適用した
  fragment（`*.fragment.base.json`）に記録済みのキーだけが 3-way 削除の対象になる。
- `~/.claude.json` の MCP 定義は fragment ごと無くなったため 3-way 削除の対象にならず、`claude mcp remove` で消す。
- `uv tool uninstall` は `workspace/*/post-start.sh` が入れていた Serena 本体を消す。`~/.serena/`（ログ・設定）は
  不要なら手で消す。

## 戻すとき

外した PR（#72）を revert すると、直前の構成（#71）に戻る。Claude Code には読み取り・リネーム・削除の 9 ツールだけを
公開して編集は組み込み Edit に寄せ、Codex には Serena を全ツール（メモリ系を除く）で登録した状態。

## 出典

- Serena 公式（クライアント別の設定）: <https://oraios.github.io/serena/02-usage/030_clients.html>
