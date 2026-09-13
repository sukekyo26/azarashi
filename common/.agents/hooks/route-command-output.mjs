#!/usr/bin/env node
// PreToolUse(Bash) hook: 重い/冗長な出力を圧縮またはオフロードしてトークンを節約。
//  - 対話/ストリーミング系と git diff/find/ps は素通し
//  - npm/make/just 等の間接実行 (テストランナー) は `rtk test` で包んで失敗行だけに畳む
//  - それ以外は rtk rewrite をセグメント単位で適用 (exit 0/1/2/3 を尊重)
// Claude Code / Codex / Copilot CLI の 3 つから同じファイルを呼ぶ (~/.agents/hooks/)。
// 判定ロジックは共通で、hook の入出力 JSON の形だけ `--client=` で切り替える。
import { readFileSync, existsSync, realpathSync } from 'node:fs';
import { execSync, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

function allow() {
  process.exit(0);
}

export function tokenize(cmd) {
  const tokens = [];
  const flags = { hasHeredoc: false, hasSubshell: false, hasGroup: false, hasProcSub: false };
  let current = '';
  let quote = null;
  let i = 0;
  const pushSeg = () => { tokens.push({ kind: 'seg', text: current }); current = ''; };
  const pushDelim = (text) => { tokens.push({ kind: 'delim', text }); };
  while (i < cmd.length) {
    const c = cmd[i];
    if (quote) {
      current += c;
      if (c === '\\' && quote === '"' && i + 1 < cmd.length) { current += cmd[i + 1]; i += 2; continue; }
      if (c === quote) quote = null;
      i++; continue;
    }
    if (c === '"' || c === "'") { quote = c; current += c; i++; continue; }
    if (c === '\\' && i + 1 < cmd.length) { current += c + cmd[i + 1]; i += 2; continue; }
    if (c === '<' && cmd[i + 1] === '<' && cmd[i + 2] === '<') { current += '<<<'; i += 3; continue; }
    // heredoc は delimiter 形式 (`EOF` / `'EOF'` / `\EOF` 等) を問わず一律 unsafe にする
    if (c === '<' && cmd[i + 1] === '<') { flags.hasHeredoc = true; current += '<<'; i += 2; continue; }
    if ((c === '<' || c === '>') && cmd[i + 1] === '(') {
      flags.hasProcSub = true; current += cmd.slice(i, i + 2); i += 2; continue;
    }
    if (c === '(') { flags.hasSubshell = true; current += c; i++; continue; }
    if (c === '{') {
      // `{ ... ; }` grouping: 直前が行頭/空白/演算子 (`;|&(\n`) + 直後が空白。
      // `${var}` / `{a,b}` (brace 展開) はこの条件で除外される。
      const prev = i === 0 ? '' : cmd[i - 1];
      const next = i + 1 < cmd.length ? cmd[i + 1] : '';
      if ((prev === '' || /[\s;|&(\n]/.test(prev)) && /\s/.test(next)) flags.hasGroup = true;
      current += c; i++; continue;
    }
    const two = cmd.slice(i, i + 2);
    if (two === '&&' || two === '||') { pushSeg(); pushDelim(two); i += 2; continue; }
    if (c === '&') {
      // fd リダイレクト (`2>&1`, `&>file`) はデリミタにしない
      const prev = i === 0 ? '' : cmd[i - 1];
      const next = i + 1 < cmd.length ? cmd[i + 1] : '';
      if (prev === '>' || prev === '<' || next === '>') { current += c; i++; continue; }
    }
    if (c === ';' || c === '|' || c === '&' || c === '\n') { pushSeg(); pushDelim(c); i++; continue; }
    current += c; i++;
  }
  pushSeg();
  return { tokens, flags };
}

// wrapper のフラグは body 側に残す。`sudo -u <user>` の値が rtk 対応コマンド名と
// 衝突したときの致命的な誤書き換え (`sudo -u rtk cmd` 化) を防ぐため。
export function splitPrefix(seg) {
  let s = seg;
  const lead = s.match(/^\s*/)[0];
  s = s.slice(lead.length);
  let prefix = lead;
  for (;;) {
    const m1 = s.match(/^\w+=(?:'[^']*'|"(?:[^"\\]|\\.)*"|\S*)\s+/);
    if (m1) { prefix += m1[0]; s = s.slice(m1[0].length); continue; }
    const m2 = s.match(/^(?:sudo|command|env|nice|nohup|time)\s+/);
    if (m2) { prefix += m2[0]; s = s.slice(m2[0].length); continue; }
    break;
  }
  return { prefix, body: s };
}

export function commandHead(seg) {
  return splitPrefix(seg).body.trimStart();
}

const CONTROL_HEADS = new Set([
  'for', 'while', 'until', 'if', 'case', 'do', 'done',
  'then', 'else', 'elif', 'fi', 'esac', 'select', 'function',
]);
const FORBIDDEN_HEADS = new Set(['eval', 'exec']);

export function isUnsafeSeg(segText) {
  const { body } = splitPrefix(segText);
  const trimmed = body.trimStart();
  if (trimmed === '') return false;
  if (/^[A-Za-z_]\w*\s*\(\s*\)/.test(trimmed)) return true;
  if (/^function\b/.test(trimmed)) return true;
  const head = trimmed.split(/\s+/)[0];
  if (CONTROL_HEADS.has(head)) return true;
  if (FORBIDDEN_HEADS.has(head)) return true;
  return false;
}

export function hasUnsafeShape(tokens, flags) {
  if (flags.hasHeredoc || flags.hasSubshell || flags.hasGroup || flags.hasProcSub) return true;
  for (const t of tokens) {
    if (t.kind === 'seg' && isUnsafeSeg(t.text)) return true;
  }
  return false;
}

const EXCLUDE =
  /(--watch|--watchAll|--ui|--debug|--headed|--interactive|--tty|--follow)\b|\s-(it|ti)\b|\battach\b|pytest-watch|\bptw\b/;

// git diff: 精読 / find: rtk フィルタが GNU find 構文を誤解釈 /
// ps: rtk 0.42 系は rewrite を返すが subcommand 表に無く実行時に死ぬ
const FORCE_PASSTHROUGH = [/^git\s+diff\b/, /^find\b/, /^ps\b/];

// テストランナー系は内側ツールが隠れて rtk rewrite が効かないため、`rtk test` で
// 実行ごと包んで失敗行だけに畳む。
// `npm ci` (clean install) と区別するため `ci` は `run ci` のみ拾う。
const TEST_RUNNER_PATTERNS = [
  /^(npm|pnpm|yarn|bun)\s+(run\s+)?(test|test:[\w:-]+|quality|e2e|lint|check)\b/,
  /^(npm|pnpm|yarn|bun)\s+run\s+ci\b/,
  /^make\s+(test|e2e|quality|lint|ci|check)\b/,
  /^just\s+(test|e2e|quality|lint|ci|check)\b/,
];

// Playwright は `rtk playwright test` に確定的に書き換える。rtk rewrite に任せると同じ
// 結果を exit 3 (ask) で返して毎回権限確認になり、汎用 `rtk test` は末尾 5 行しか残さず
// 失敗内容が落ちる。専用パーサーは JSON レポーターで走らせて PASS/FAIL と失敗詳細だけに畳む。
// ランナー接頭辞 (npx/bunx/pnpm/yarn [exec]) は落とす: rtk 側が `npx --no-install` で
// 起動し、ローカル・グローバルどちらの playwright にも解決できる。
// test 以外 (install/codegen/show-report) はパーサーが効かず [RTK:PASSTHROUGH] の
// ノイズが増えるだけなので rtk rewrite に渡さず素通し。playwright-cli は rtk が知らない
// (exit 1) のでここでは扱わない。
const PLAYWRIGHT_TEST = /^(?:(?:npx|bunx|pnpm|yarn)\s+(?:exec\s+)?)?playwright\s+test\b/;
const PLAYWRIGHT_ANY = /^(?:(?:npx|bunx|pnpm|yarn)\s+(?:exec\s+)?)?playwright\b/;

function resolveRtk() {
  const home = process.env.HOME || '';
  const candidates = [];
  if (home) candidates.push(`${home}/.local/bin/rtk`, `${home}/.npm-global/bin/rtk`);
  candidates.push('/usr/local/bin/rtk', '/usr/bin/rtk');
  for (const p of candidates) {
    if (existsSync(p)) return p;
  }
  try {
    const path = `${process.env.PATH || ''}:${home}/.local/bin:${home}/.npm-global/bin`;
    return execSync('command -v rtk', { env: { ...process.env, PATH: path } }).toString().trim();
  } catch {
    return '';
  }
}

// rtk rewrite の exit code 規約: 0=ok / 1=N/A / 2=deny / 3=ask
export function rewriteSegmentBody(rtk, body) {
  if (!body.trim()) return { action: 'keep' };
  // テストランナーは内側ツールが隠れて rtk rewrite が効かない (exit 3 を返す) ので、
  // `rtk test` で実行ごと包んで失敗行だけに畳む。exit code は透過される。
  const head = commandHead(body);
  if (TEST_RUNNER_PATTERNS.some((re) => re.test(head))) {
    return { action: 'replace', body: `${rtk} test ${body}` };
  }
  const pw = head.match(PLAYWRIGHT_TEST);
  if (pw) return { action: 'replace', body: `${rtk} playwright test${head.slice(pw[0].length)}` };
  if (PLAYWRIGHT_ANY.test(head)) return { action: 'keep' };
  const res = spawnSync(rtk, ['rewrite', body], { encoding: 'utf8' });
  const out = (res.stdout || '').trim();
  switch (res.status) {
    case 0:
      return out === '' || out === body ? { action: 'keep' } : { action: 'replace', body: out };
    case 1:
      return { action: 'keep' };
    case 2:
      return { action: 'deny' };
    case 3:
      return out === '' || out === body ? { action: 'keep' } : { action: 'replace-ask', body: out };
    default:
      return { action: 'keep' };
  }
}

// sudo の secure_path 経由でも rtk を見つけられるよう、書き換え後の裸 `rtk` は絶対パス化
function absInBody(rtk, body) {
  if (body === 'rtk') return rtk;
  if (body.startsWith('rtk ')) return `${rtk} ${body.slice(4)}`;
  return body;
}

// クライアントごとの hook 入出力スキーマ。判定ロジックはこの外に出さない。
//  - claude-code: tool_input / hookSpecificOutput.updatedInput。ask は permissionDecision を
//    omit して通常の権限フローに委ねる。
//  - codex: 形式は claude-code と同じだが、`updatedInput` を `permissionDecision: "allow"` と
//    併記した形しか受け付けず、それ以外は hook 実行失敗として書き換えごと捨てられる。
//  - copilot: toolArgs / modifiedArgs のフラットな形。
// 既定は claude-code。
const CLIENT_IO = {
  'claude-code': {
    command: (p) => p?.tool_input?.command,
    deny: (reason) => ({
      hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'deny', permissionDecisionReason: reason },
    }),
    rewrite: (p, cmd, allowed) => ({
      hookSpecificOutput: {
        hookEventName: 'PreToolUse',
        ...(allowed && { permissionDecision: 'allow', permissionDecisionReason: 'RTK auto-rewrite' }),
        updatedInput: { ...p.tool_input, command: cmd },
      },
    }),
  },
  copilot: {
    command: (p) => p?.toolArgs?.command,
    deny: (reason) => ({ permissionDecision: 'deny', permissionDecisionReason: reason }),
    rewrite: (p, cmd, allowed) => ({ ...(allowed && { permissionDecision: 'allow' }), modifiedArgs: { command: cmd } }),
  },
};
CLIENT_IO.codex = CLIENT_IO['claude-code'];

function detectClient() {
  const arg = process.argv.slice(2).find((a) => a.startsWith('--client='));
  const client = arg ? arg.slice('--client='.length) : 'claude-code';
  return CLIENT_IO[client] ? client : 'claude-code';
}

function main() {
  const client = detectClient();
  const io = CLIENT_IO[client];
  let payload;
  try { payload = JSON.parse(readFileSync(0, 'utf8')); } catch { allow(); }
  const command = io.command(payload);
  if (typeof command !== 'string' || command.trim() === '') allow();

  const { tokens, flags } = tokenize(command);
  const segs = tokens.filter((t) => t.kind === 'seg');
  const heads = segs.map((s) => commandHead(s.text));

  // 0. `rtk init` はブロック（複合の一部でも）。`--help` は何も書き込まないので通す。
  if (heads.some((h) => /^rtk\s+init\b/.test(h) && !/\s(-h|--help)\b/.test(h))) {
    process.stdout.write(JSON.stringify(io.deny(
      'rtk init は禁止。この環境は rtk を CLI 専用で使う方針です（init すると RTK 純正の PreToolUse フックと指示ファイルが入り、このフックと二重に走る）。出力圧縮は route-command-output.mjs が自動で行うので init は不要です。',
    )));
    process.exit(0);
  }

  // 1. 対話/ストリーミング・常時 passthrough 対象 → 素通し
  if (heads.some((h) => EXCLUDE.test(h) || FORCE_PASSTHROUGH.some((re) => re.test(h)))) allow();

  // 2. 分割で壊れる shell 構文 (heredoc / 制御構文 / サブシェル等) → 全体 passthrough
  if (hasUnsafeShape(tokens, flags)) allow();

  // 3. rtk 解決 (未導入なら passthrough)
  const rtk = resolveRtk();
  if (rtk === '') allow();

  // 4. セグメント数の上限 (fork コスト保護)
  const MAX_SEGS = 16;
  if (segs.length > MAX_SEGS) allow();

  // 5. セグメント単位で rewrite し、結果を組み立てる
  let needsAsk = false;
  let denyHit = false;
  let anyReplace = false;
  const pieces = [];
  for (const tok of tokens) {
    if (tok.kind === 'delim') { pieces.push(tok.text); continue; }
    const { prefix, body } = splitPrefix(tok.text);
    // rtk rewrite が trim した結果を返すため、末尾 whitespace を別途保持して再結合
    const tail = body.match(/\s*$/)[0];
    const trimmedBody = tail ? body.slice(0, -tail.length) : body;
    const r = rewriteSegmentBody(rtk, trimmedBody);
    if (r.action === 'deny') { denyHit = true; pieces.push(tok.text); continue; }
    if (r.action === 'keep') { pieces.push(tok.text); continue; }
    anyReplace = true;
    if (r.action === 'replace-ask') needsAsk = true;
    pieces.push(prefix + absInBody(rtk, r.body) + tail);
  }

  // 6. いずれかのセグメントが deny → クライアントの native deny rule に委ねる
  if (denyHit) allow();

  // 7. 書き換え対象なし → 素通し
  if (!anyReplace) allow();

  const newCommand = pieces.join('');

  // 8. ask: permissionDecision を omit して通常の権限フローに委ねる。
  //    Codex はこの形を受け付けない (ask 未サポート・allow 以外の updatedInput はエラー) ので
  //    allow に落とす。Codex の allow は PreToolUse の結果を「書き換えた入力で継続」と
  //    解釈するだけで、後段の権限判定・サンドボックスは通常どおり動く。
  // 9. 通常: 書き換えて allow
  const allowed = !(needsAsk && client !== 'codex');
  process.stdout.write(JSON.stringify(io.rewrite(payload, newCommand, allowed)));
  process.exit(0);
}

// 直接実行のときだけ main() を起動。symlink 経由起動と直接起動の両対応のため両辺を realpath で正規化
function isMain() {
  try {
    const here = realpathSync(fileURLToPath(import.meta.url));
    const invoked = process.argv[1] ? realpathSync(process.argv[1]) : '';
    return invoked === here;
  } catch {
    return false;
  }
}

if (isMain()) main();
