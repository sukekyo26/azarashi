# Claude Code に Serena を使わせる設定

Claude Code が Serena のシンボル操作ツール（`find_symbol` 等）を無視して
`Read` / `Grep` / `Bash` で済ませてしまう問題への対処。3 層で構成される。

| 層 | 何をするか | 設定場所 | 配布 |
| --- | --- | --- | --- |
| システムプロンプト | output style で Serena のツール選択ルールを追加する | `common/.claude/output-styles/serena.md` + fragment の `outputStyle` | `install.sh` |
| ツールのロード | MCP ツールを遅延ロードさせず常時ロードさせる | `common/.claude/settings.fragment.json` の `env` | `install.sh` |
| システムプロンプト | Bash 優先の指示を無効化する | 同上 | `install.sh` |

すべて `install.sh` で配布されるため、**新しいコンテナでの手作業は無い**。

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

### 2. output style が有効か確認する

```sh
jq '.outputStyle' ~/.claude/settings.json   # => "Serena"
ls -l ~/.claude/output-styles/serena.md      # => common/ への symlink
```

`common/.claude/output-styles/serena.md` は Serena 公式の system prompt override
（`serena prompts print-cc-system-prompt-override`）から `# Tool selection` の節だけを
抜き出したもの。frontmatter の `keep-coding-instructions: true` により
Claude Code 組み込みの指示を残したまま、ツール選択ルールだけを system prompt に上乗せする。

- **`outputStyle` の値は frontmatter の `name`**（ファイル名ではない）。
- `settings.local.json` の `outputStyle` は user settings より優先される。効かないときはまずそこを見る。
- 反映はセッション開始時のみ。`/clear` か再起動が必要。
- output style は**メインの会話にのみ**適用され、subagent には効かない。

Serena 側の override が更新されたら、以下で追従する:

```sh
cd ~/work/azarashi
{ sed -n '1,5p' common/.claude/output-styles/serena.md; echo; \
  serena prompts print-cc-system-prompt-override |
    sed -n '/^# Tool selection/,/^# Doing tasks/p' | sed '$d'; } > /tmp/serena.md
mv /tmp/serena.md common/.claude/output-styles/serena.md
```

### 3. 動作確認

新しいセッションを開いて Claude に聞く:

- Serena のツールが deferred でなく標準ツールとして載っているか
- システムプロンプトに `# Tool selection` の節（Serena 優先ルール）が入っているか
- 「Do your work through the Bash tool …」の指示が消えているか

## 注意点

- **SessionStart hook で「Serena を使え」と流しても効かない。** serena の activate hook は既に
  同種の警告を毎回注入しており、CLAUDE.md にも同じ規約が書いてあるが、どちらも守られなかった。
  会話に注入される層は CLAUDE.md と同じ重みしか無く、Serena 公式も CLAUDE.md への追記について
  *"the effect may be insufficient"* と認めている。効かせたいならシステムプロンプト層に置く。
- `CLAUDE_CODE_THRIFTY_SONIC=0` は output style 導入後も**消さない**。Bash 優先の指示は
  組み込みシステムプロンプト側にあり、output style はそれを置換しないため。
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

## 効かなかった場合: システムプロンプトの完全置換

output style でも Serena が使われないなら、Serena 公式が推奨する完全置換に上げる。
組み込みプロンプトを丸ごと捨てるため、動的セクション（cwd / git status / 日付 / platform /
scratchpad パス）が失われ、**使い続けても復活しない**ので `# Environment` として自前で連結する。
CLI フラグなので settings.json では指定できず、シェル関数で起動を包む必要がある。
`~/.cocoon/.shellrc` はワークスペースごとに別ボリュームなので、**コンテナごとに手作業**になる。

```sh
cat >> ~/.cocoon/.shellrc <<'SHRC'

claude() {
  local sp
  case "$1" in
    ''|-*)
      if command -v serena >/dev/null 2>&1 &&
        sp=$(serena prompts print-cc-system-prompt-override 2>/dev/null) && [ -n "$sp" ]; then
        sp="$sp

# Environment
cwd: $PWD
today: $(date +%F)
platform: $(uname -sro)
"
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

この場合 `outputStyle` は不要になる（同じ内容が override 本文に含まれるため）。
override 本文は `Co-Authored-By: Claude Opus 4.7 (1M context)` をハードコードしている点にも注意。

## 出典

- Serena 公式（override の推奨）: <https://oraios.github.io/serena/02-usage/030_clients.html>
- `CLAUDE_CODE_THRIFTY_SONIC` の発見元: <https://kawasin73.hatenablog.com/entry/2026/09/05/092056>
