# Codex に Serena を使わせる設定

Serena（シンボル単位の読み取り・参照追跡・リネームを提供する MCP サーバー）は **Codex にだけ** 登録している。
Claude Code には登録しない（理由は「Claude Code で使わない理由」）。

設定場所は `common/.codex/config.fragment.toml`、配布は `dotfiles`。
Serena 本体は `uv tool install` で tag 固定したものを使う（`workspace/*/post-start.sh`）。

## 構成

| 何をするか | 設定 |
| --- | --- |
| Serena の MCP サーバーを登録する | `[mcp_servers.serena]`（`--context codex --project-from-cwd`） |
| Codex の組み込み prompt に Serena 優先のツール選択ルールを追記する | トップレベルの `developer_instructions = '''...'''` |
| 使わないツール（メモリ系 6 つと `onboarding`）を一覧から外す | `[mcp_servers.serena]` の `disabled_tools` |

- `developer_instructions` は `developer` ロールのメッセージとして組み込み prompt に追記される。
  AGENTS.md（`user_instructions`）より強く効く（Codex 自身の prompt.md が「system / developer 指示は
  AGENTS.md より常に優先」と明記）。AGENTS.md に書いただけでは Serena が使われなかった。
- `model_instructions_file = "path"` / `instructions = "..."` は組み込み prompt を丸ごと置換するので使わない。
- 中身は Serena 公式の Claude Code 向け system prompt override（`serena prompts print-cc-system-prompt-override`）の
  `# Tool selection` 節を Codex 向けに書き換えたもの。ツール名が違う（shell の `cat` / `sed` / `grep` / `rg` と
  `apply_patch`）のと、`--context codex` では `replace_content` / `read_file` / `find_file` / `list_dir` /
  `execute_shell_command` が外れて `search_for_pattern` / `replace_in_files` が残るので、対応表はそれに合わせてある。
  Serena に Codex 用の override 出力コマンドは無いので、公式追従は手動。

## 注意点

- **ツールの除外は Serena の `--add-mode` ではなく Codex の `disabled_tools` で行う。** `--add-mode` で足した mode の
  `excluded_tools` は、`single_project: true` の context でしか一覧から消えない（それ以外は「後で解除できる弱い除外」で、
  一覧に残したまま呼び出しを拒否する）。`codex` context は `single_project` でないので効かない。
  反映確認は `codex mcp get serena` に `disabled_tools` が出ること。

- **`developer_instructions` はトップレベルキーなので `[features]` 等のテーブルヘッダより前に書く。**
  後ろに置くとそのテーブルの子キー（`features.developer_instructions`）になり、黙って無視される。
- 追記型でもファイル参照はできない（ファイル参照の `model_instructions_file` は置換型）。
  そのため fragment に文字列をインラインで持つ。tomlkit のマージ後は `~/.codex/config.toml` 上で
  1 行のエスケープ文字列になるが、TOML として正しく Codex は読める。
- `mcp_servers` と `developer_instructions` は `hooks.json` ではないので、変更しても Codex の再承認は不要。
- Codex は MCP ツールを遅延ロードしないので、Claude Code の `alwaysLoad` に相当する設定は要らない。
- 反映確認: `./dotfiles install` 後に
  `python3 -c 'import tomllib;print(tomllib.load(open("'"$HOME"'/.codex/config.toml","rb"))["developer_instructions"][:60])'`
  でトップレベルに入っていること。効き具合を確かめる手段は無いので、実際に `codex` を動かして
  Serena ツールが選ばれるか観察する。

## Claude Code で使わない理由

以前は Claude Code にも登録し、output style・`alwaysLoad`・`serena-hooks` で使わせていたが外した。

- **公式 LSP プラグインでほぼ代替できる。** `enabledPlugins` の gopls / pyright / rust-analyzer / typescript で
  LSP ツール（`goToDefinition` / `findReferences` / `goToImplementation` / `documentSymbol` / `workspaceSymbol` /
  呼び出し階層）が使える。Serena 固有なのは「シンボル名で本体を 1 回で読む」ことと参照を理解したリネームだけ。
- **Serena の編集は診断が返らない。** Claude Code は自分の Edit / Write の後にしか LSP の自動診断を返さず、
  Serena の編集はディスクを直接書き換えるので、入れた型エラーが後の Edit まで表面化しない（`gopls-lsp` で実測）。
  結局編集は Edit に寄せることになり、Serena の役割は読み取りだけに縮んでいた。
- **常時コストがかかる。** ツール定義と output style で毎リクエスト 5k トークン前後、全ツール呼び出しに
  `serena-hooks remind` の起動（約 40 ms）、言語サーバーが LSP プラグインと二重に起動する。
  加えて上流 override との差分追従、context / mode の調整といった保守が要った。
- **Vue でも実際の出番は小さかった。** 公式 LSP プラグインは `.vue` に対応しない（typescript-lsp の対象は
  `.ts` / `.tsx` / `.js` 系のみ）ので Vue では Serena が唯一の手段だが、2026-09 以降の Vue プロジェクトの記録では
  `.vue` への読み取りは Read 264 回に対し Serena の `find_symbol` / `get_symbols_overview` が 27 回、
  `find_referencing_symbols` は 0 回だった。
- **会話層への注入は効かない。** SessionStart hook や CLAUDE.md で「Serena を使え」と流しても守られず、
  効かせるにはシステムプロンプト層（output style）に置く必要があった。

戻すときは、Serena を外した PR を revert する。Claude Code に公開するツールを読み取り・リネーム・削除の 9 つに絞り、
編集は組み込み Edit に寄せた構成（#71）に戻る。

### 移行（Claude Code から Serena を外す）

`./dotfiles install --force` で `settings.json` 側（`outputStyle`・`serena-hooks`・`mcp__serena` の allow）は消える。
`~/.claude.json` の MCP 定義は fragment ごと無くなったため `--force` の 3-way 削除の対象にならず、手で消す:

```sh
claude mcp remove serena --scope user
```

## 出典

- Serena 公式（クライアント別の設定）: <https://oraios.github.io/serena/02-usage/030_clients.html>
