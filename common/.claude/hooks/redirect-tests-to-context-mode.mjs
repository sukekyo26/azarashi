#!/usr/bin/env node
// PreToolUse(Bash) hook: 大量出力コマンドを 2 通りに振り分ける。
//  - 専用フィルタが直接効く単一コマンド (pytest / go test / cargo test / vitest run /
//    playwright test) は RTK CLI に透過リライトして allow する。エージェントの挙動は
//    変えず、出力だけインライン圧縮される。rtk は絶対パスで差し込むので PATH 非依存。
//  - 間接実行 (npm/pnpm/yarn/bun スクリプト, make, just) と、複合コマンドや rtk 未導入時は
//    context-mode の ctx_execute へ誘導 (deny)。生出力を会話コンテキストに流さない。
// watch / UI / debug などの対話モードはどちらの対象からも除外（サンドボックス/圧縮で詰まる）。
import { readFileSync } from 'node:fs';
import { execSync } from 'node:child_process';

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

// コマンドを「実際に起動される単位」へ分割する。`&&` `||` `;` `|` `&` 改行で
// 区切るが、クォート内の区切り文字は無視する。これにより
// `foo && make test` の 2 つ目以降のコマンドも検知でき、かつ
// `git commit -m "...make test..."` のようにクォート内へキーワードを含むだけの
// コマンドは 1 セグメントに閉じ込められ、セグメント先頭に来ないため誤検知しない。
function splitSegments(cmd) {
  const segments = [];
  let current = '';
  let quote = null; // "'" or '"'
  for (let i = 0; i < cmd.length; i++) {
    const c = cmd[i];
    if (quote) {
      current += c;
      // ダブルクォート内のみバックスラッシュでエスケープが効く（次の 1 文字を温存）。
      if (c === '\\' && quote === '"' && i + 1 < cmd.length) {
        current += cmd[++i];
      } else if (c === quote) {
        quote = null;
      }
      continue;
    }
    if (c === '"' || c === "'") {
      quote = c;
      current += c;
      continue;
    }
    if (c === '\\' && i + 1 < cmd.length) {
      current += c + cmd[++i];
      continue;
    }
    const two = cmd.slice(i, i + 2);
    if (two === '&&' || two === '||') {
      segments.push(current);
      current = '';
      i++;
      continue;
    }
    if (c === ';' || c === '|' || c === '&' || c === '\n') {
      segments.push(current);
      current = '';
      continue;
    }
    current += c;
  }
  segments.push(current);
  return segments;
}

// 1 セグメントの「先頭」を取り出す。先頭の環境変数代入と sudo/command/env を剥がす。
function commandHead(seg) {
  let s = seg.trim();
  for (;;) {
    const before = s;
    s = s.replace(/^\w+=\S+\s+/, '');
    s = s.replace(/^(?:sudo|command|env)\s+/, '');
    if (s === before) break;
  }
  return s;
}

// 対話・watch・UI モードは退避対象外（プロセスが終了せずサンドボックスで詰まる）。
const EXCLUDE = /(--watch|--watchAll|--ui|--debug|--headed)\b|pytest-watch|\bptw\b/;

// context-mode へ誘導する間接実行系（recipe / script runner）。内側のツールが隠れて
// RTK の専用フィルタが効かないため、丸ごとオフロードする方が削減できる。先頭一致で判定。
const CTX_PATTERNS = [
  /^(npm|pnpm|yarn|bun)\s+(run\s+)?(test|test:[\w:-]+|quality|e2e|lint|ci)\b/,
  /^make\s+(test|e2e|quality|lint|ci|check)\b/,
  /^just\s+(test|e2e|quality|lint|ci|check)\b/,
];

// RTK の専用フィルタが直接効くコマンド。`rtk <cmd>` に透過リライトする。先頭一致で判定。
const RTK_PATTERNS = [
  /^(?:python3?\s+-m\s+)?pytest\b/,
  /^go\s+test\b/,
  /^cargo\s+test\b/,
  /^(?:npx\s+|bunx\s+|pnpm\s+exec\s+|yarn\s+)?vitest\s+run\b/,
  /^(?:npx\s+|bunx\s+|pnpm\s+exec\s+|yarn\s+)?playwright\s+test\b/,
];

function classify(head) {
  if (head === '' || EXCLUDE.test(head)) return null;
  if (CTX_PATTERNS.some((re) => re.test(head))) return 'ctx';
  if (RTK_PATTERNS.some((re) => re.test(head))) return 'rtk';
  return null;
}

const segments = splitSegments(command);
const kinds = segments.map((seg) => classify(commandHead(seg)));

function denyToContextMode() {
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
}

const hasCtx = kinds.includes('ctx');
const hasRtk = kinds.includes('rtk');
if (!hasCtx && !hasRtk) {
  allow();
}

// 透過リライトは「単一コマンドの RTK 対象」だけに限定する。複合コマンド（区切り文字を
// 含む）や ctx 混在は、セグメント単位の安全な再構成が難しいので従来どおり context-mode
// 誘導にフォールバックする（カバレッジは落とさない）。
if (hasCtx || segments.length !== 1 || kinds[0] !== 'rtk') {
  denyToContextMode();
}

// rtk を絶対パスで解決する（PATH を補強）。見つからなければ context-mode 誘導に
// フォールバック。これにより rtk 未導入でも「生出力を会話に流さない」保証は崩れない。
function resolveRtk() {
  const home = process.env.HOME || '';
  const path = `${process.env.PATH || ''}:${home}/.local/bin:${home}/.npm-global/bin`;
  try {
    return execSync('command -v rtk', { env: { ...process.env, PATH: path } })
      .toString()
      .trim();
  } catch {
    return '';
  }
}

const rtk = resolveRtk();
if (rtk === '') {
  denyToContextMode();
}

// env 代入 / sudo を温存しつつ、パッケージランナーの前置き（npx 等）を剥がして
// 解決済みの rtk 絶対パスを差し込む。例: `FOO=1 npx vitest run` -> `FOO=1 <rtk> vitest run`。
function toRtk(seg) {
  let s = seg.trim();
  let prefix = '';
  for (;;) {
    const m = s.match(/^(?:\w+=\S+\s+|(?:sudo|command|env)\s+)/);
    if (!m) break;
    prefix += m[0];
    s = s.slice(m[0].length);
  }
  s = s.replace(/^(?:npx\s+|bunx\s+|pnpm\s+exec\s+|yarn\s+|python3?\s+-m\s+)/, '');
  return `${prefix}${rtk} ${s}`;
}

process.stdout.write(
  JSON.stringify({
    hookSpecificOutput: {
      hookEventName: 'PreToolUse',
      permissionDecision: 'allow',
      updatedInput: { ...payload.tool_input, command: toRtk(segments[0]) },
    },
  }),
);
process.exit(0);
