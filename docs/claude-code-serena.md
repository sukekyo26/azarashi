# Claude Code に Serena を使わせる設定

Claude Code が Serena のシンボル操作ツール（`find_symbol` 等）を無視して
`Read` / `Grep` / `Bash` で済ませてしまう問題への対処。3 層で構成される。

| 層 | 何をするか | 設定場所 | 配布 |
| --- | --- | --- | --- |
| システムプロンプト | Serena 公式の override で built-in ツール優先のバイアスを打ち消す | `~/.cocoon/.shellrc` の `claude` ラッパ | **手動**（コンテナごと） |
| ツールのロード | MCP ツールを遅延ロードさせず常時ロードさせる | `common/.claude/settings.fragment.json` の `env` | `install.sh` |
| システムプロンプト | Bash 優先の指示を無効化する | 同上 | `install.sh` |

## 新しいコンテナ / ワークスペースでの手順

### 1. dotfiles を配布する（env 2 つが入る）

```sh
cd ~/work/azarashi && ./install.sh install
```

反映確認:

```sh
jq '.env' ~/.claude/settings.json
# => { "CLAUDE_CODE_THRIFTY_SONIC": "0", "ENABLE_TOOL_SEARCH": "false" }
```

- `CLAUDE_CODE_THRIFTY_SONIC=0` — 「Read/Edit ではなく Bash で作業しろ」というシステムプロンプトを消す。
  `"0"` は数値 0 と解釈されて **有効化** されるフラグ（`ENABLE_TOOL_SEARCH`）とは別物なので取り違えないこと。
- `ENABLE_TOOL_SEARCH=false` — MCP ツールの遅延ロード（Tool Search）を止める。
  これを入れないと Serena の 22 ツールはスキーマが読み込まれず、`ToolSearch` を挟まないと呼べない。
  **`"0"` は逆に有効化される**（`aEn(e) === 0` が `tst` を返す）ので必ず `"false"`。

### 2. `claude` ラッパを入れる（cocoon ボリュームごとに必要）

`~/.cocoon/.shellrc` は Docker の名前付きボリューム
（`${COMPOSE_PROJECT_NAME}_${CONTAINER_SERVICE_NAME}_cocoon`）なので、
コンテナ再作成では消えないが **ワークスペースごとに別ボリューム**。
`main` に入れても `android` には無い。

```sh
cat >> ~/.cocoon/.shellrc <<'SHRC'

claude() {
  local sp
  case "$1" in
    ''|-*)
      if command -v serena >/dev/null 2>&1 &&
        sp=$(serena prompts print-cc-system-prompt-override 2>/dev/null) && [ -n "$sp" ]; then
        command claude --system-prompt "$sp" --system-prompt-snapshot on "$@"
      else
        command claude "$@"
      fi
      ;;
    *) command claude "$@" ;;
  esac
}
SHRC
exec zsh
```

- 静的コピーではなく毎回 `serena prompts print-cc-system-prompt-override` を展開するので
  Serena の更新に自動追従する。
- サブコマンド（`claude mcp list` 等）は素通し。素の起動が必要なときは `command claude`。
- `--system-prompt` を渡すとプロンプトスナップショットが off になるため
  `--system-prompt-snapshot on` を併用してキャッシュを効かせる。

### 3. 動作確認

新しいセッションを開いて Claude に聞く:

- Serena のツールが deferred でなく標準ツールとして載っているか
- システムプロンプトが Serena の override になっているか
- 「Do your work through the Bash tool …」の指示が消えているか

## 注意点

- override 本文は `Co-Authored-By: Claude Opus 4.7 (1M context)` をハードコードしている。
  コミット trailer を変えたい場合は CLAUDE.md 側で上書き指示を書く。
- `serena-hooks remind` は **強制ではなく nudge**。3 回に 1 回しか発火せず、
  発火後 120 秒は完全に沈黙し、メッセージ自体が「続けてよい」と明言している
  （`_MIN_DENY_INTERVAL_SECONDS = 120`）。これに強制力を期待しない。
- Bash 経由の `cat` / `grep` は remind hook が **意図的に無視** する（claude-code クライアントでは
  ツール名 `Read` / `Grep` しか見ない）。シェル文字列を見る分岐は codex / grok 専用。
- どうしても強制したい場合の最終手段は Claude Code の `permissions.deny`。
  hook と違いモデル側に迂回の余地が無い。対象リポジトリの `.claude/settings.json` に:

  ```json
  "permissions": { "deny": ["Read(//**/*.py)", "Read(//**/*.ts)", "Read(//**/*.tsx)"] }
  ```

## 出典

- Serena 公式（override の推奨）: <https://oraios.github.io/serena/02-usage/030_clients.html>
- `CLAUDE_CODE_THRIFTY_SONIC` の発見元: <https://kawasin73.hatenablog.com/entry/2026/09/05/092056>
