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

## 削除方法

Claude Code / Codex を使う環境（ホストと `workspace/*` の各コンテナ）ごとに 1 回行う。
このリポジトリが Serena を外したコミット以降をチェックアウトしている状態で実行する。

### 1. 設定から消す

```sh
cd ~/work/azarashi
./dotfiles install --force
claude mcp remove serena --scope user
```

- `./dotfiles install --force` で次が消える。`--force` は手で変えた値もリポジトリ側で上書きする点に注意。
  - Claude Code の `~/.claude/settings.json`: `outputStyle: "Serena"`（`Lean` に置き換わる）、`serena-hooks` の hook、
    `mcp__serena` の allow
  - Codex の `~/.codex/config.toml`: `developer_instructions`、`[mcp_servers.serena]`
  - `~/.claude/output-styles/serena.md` と `~/.serena/modes/claude-code-tools.yml` の symlink（配布元が無くなったため掃除される）
- 3-way 削除の対象は、前回 `--force` で適用した fragment（`~/.claude/settings.fragment.base.json` /
  `~/.codex/config.fragment.base.json`）に記録済みのキーだけ。`--force` を一度も通していない環境では消えずに残るので、
  手順 3 の確認で残っていたら手で消す。
- `~/.claude.json` の MCP 定義は fragment ごと無くなったため 3-way 削除の対象にならない。`claude mcp remove` で消す
  （`jq 'del(.mcpServers.serena)' ~/.claude.json` でもよい）。

### 2. 本体とデータを消す

```sh
uv tool uninstall serena-agent   # workspace/*/post-start.sh が入れていた serena / serena-hooks
rm -rf ~/.serena                 # ログ・言語サーバーのキャッシュ・グローバル設定
rm -f ~/.claude.fragment.base.json  # 消えた .claude.fragment.json の前回適用記録（もう参照されない）
```

各リポジトリの `.serena/`（プロジェクト設定とキャッシュ）も不要なら消す。グローバル gitignore
（`common/.config/git/ignore`）の `.serena/` は、消し忘れた `.serena/` が未追跡として出ないよう残している
（`project.yml` も含めて丸ごと無視する。git 管理下に置いたリポジトリでは、そのリポジトリ側で `git rm` する）。

プラグイン版（`serena@claude-plugins-official`）を使ったことがある環境では、`~/.claude.json` に使用回数の記録が残る。
実害は無いが消すなら次のとおり（Claude Code は動作中もこのファイルを書き換えるので、`mv` ではなく中身を書き戻して
パーミッション 600 を保つ）:

```sh
jq 'del(.pluginUsage["serena@claude-plugins-official"])' ~/.claude.json > /tmp/claude.json &&
  cat /tmp/claude.json > ~/.claude.json && rm /tmp/claude.json
```

### 3. 確認する

```sh
jq '.mcpServers | has("serena")' ~/.claude.json                # => false
jq '.outputStyle' ~/.claude/settings.json                      # => "Lean"
grep -c 'serena' ~/.claude/settings.json                       # => 0
grep -c -i 'serena' ~/.claude.json                             # => 0（pluginUsage の記録も消した場合）
python3 -c 'import tomllib;c=tomllib.load(open("'"$HOME"'/.codex/config.toml","rb"));print("developer_instructions" in c, "serena" in c.get("mcp_servers",{}))'
                                                               # => False False
command -v serena serena-hooks                                 # => 何も出ない
```

起動中の Claude Code / Codex は再起動する（MCP サーバーと output style はセッション開始時にしか読み直さない）。

## 戻すとき

外した PR（#72）を revert すると、直前の構成（#71）に戻る。Claude Code には読み取り・リネーム・削除の 9 ツールだけを
公開して編集は組み込み Edit に寄せ、Codex には Serena を全ツール（メモリ系を除く）で登録した状態。

## 出典

- Serena 公式（クライアント別の設定）: <https://oraios.github.io/serena/02-usage/030_clients.html>
