#!/usr/bin/env node
// PreToolUse(Bash) hook: 大量出力のテスト/品質チェック系コマンドを
// context-mode の ctx_execute 経由に誘導する。生出力を会話コンテキストに
// 流さず、サマリと失敗詳細だけを残すのが狙い。
// watch / UI / debug などの対話モードは除外（サンドボックスで完結しないため）。
import { readFileSync } from 'node:fs';

function allow() {
  process.exit(0);
}

let payload;
try {
  payload = JSON.parse(readFileSync(0, 'utf8'));
} catch {
  allow();
}

const command = payload?.tool_input?.command;
if (typeof command !== 'string' || command.trim() === '') {
  allow();
}

// 実際に起動されるコマンドの「先頭」を取り出す。先頭の `cd <path> &&`、
// 環境変数代入、sudo/env を剥がす。これで `git commit -m "...pytest..."` の
// ように引用符内にキーワードを含むだけのコマンドを誤検知しない。
function commandHead(cmd) {
  let s = cmd.trim();
  for (;;) {
    const before = s;
    s = s.replace(/^cd\s+[^&;|]+(?:&&|;)\s*/, '');
    s = s.replace(/^\w+=\S+\s+/, '');
    s = s.replace(/^(?:sudo|command|env)\s+/, '');
    if (s === before) break;
  }
  return s;
}

const head = commandHead(command);

// 対話・watch・UI モードは退避対象外（プロセスが終了せずサンドボックスで詰まる）。
const EXCLUDE = /(--watch|--watchAll|--ui|--debug|--headed)\b|pytest-watch|\bptw\b/;
if (EXCLUDE.test(head)) {
  allow();
}

// 一括実行で長い出力が出る、退避する価値のあるコマンド群。先頭一致で判定する。
const TEST_PATTERNS = [
  /^(npm|pnpm|yarn|bun)\s+(run\s+)?(test|test:[\w:-]+|quality|e2e|lint|ci)\b/,
  /^(?:npx\s+|bunx\s+|pnpm\s+exec\s+|yarn\s+)?vitest\s+run\b/,
  /^(?:npx\s+|bunx\s+|pnpm\s+exec\s+|yarn\s+)?playwright\s+test\b/,
  /^(?:python3?\s+-m\s+)?pytest\b/,
  /^make\s+(test|e2e|quality|lint|ci|check)\b/,
  /^just\s+(test|e2e|quality|lint|ci|check)\b/,
  /^go\s+test\b/,
  /^cargo\s+test\b/,
];

if (!TEST_PATTERNS.some((re) => re.test(head))) {
  allow();
}

const reason = [
  'このコマンドは大量のテスト/品質チェック出力を生成します。',
  '生出力を会話コンテキストに流さないため、Bash ではなく context-mode の',
  'ctx_execute MCP ツールで実行してください:',
  '',
  `  ctx_execute(language: "shell", code: ${JSON.stringify(command)})`,
  '',
  '実行後は pass/fail のサマリと失敗したテストの詳細だけを報告し、',
  '全文が必要になったら ctx_search で該当箇所を取り出してください。',
].join('\n');

process.stdout.write(
  JSON.stringify({
    hookSpecificOutput: {
      hookEventName: 'PreToolUse',
      permissionDecision: 'deny',
      permissionDecisionReason: reason,
    },
  }),
);
process.exit(0);
