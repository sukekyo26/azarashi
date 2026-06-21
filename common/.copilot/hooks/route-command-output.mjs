#!/usr/bin/env node
// preToolUse(bash) hook for GitHub Copilot CLI: RTK で出力を圧縮する。
// Copilot は MCP 非対応のため context-mode 誘導は行わない（rtk rewrite のみ）。
// それ以外の rtk 部分のロジック（複合コマンドのセグメント単位 rewrite / unsafe
// shape ガード / wrapper prefix 退避 / exit code 規約 等）は Claude Code 版
// (common/.claude/hooks/route-command-output.mjs) と同一を維持する。
// Copilot 固有の差分は入出力スキーマ（toolArgs.command / modifiedArgs /
// permissionDecision、hookSpecificOutput ラッパー無し）のみ。
//
// セグメント分割／prefix 退避／unsafe shape 検出の設計意図は Claude 版の
// 該当関数コメントを参照（実装は意図的に同一を保つ）。
import { readFileSync, existsSync, realpathSync } from 'node:fs';
import { execSync, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

function allow() {
  process.exit(0);
}

// --- 字句分割: セグメントとデリミタを保持して交互に並べる ----------------------
export function tokenize(cmd) {
  const tokens = [];
  const flags = {
    hasHeredoc: false,
    hasSubshell: false,
    hasGroup: false,
    hasProcSub: false,
  };
  let current = '';
  let quote = null;
  let i = 0;
  const pushSeg = () => {
    tokens.push({ kind: 'seg', text: current });
    current = '';
  };
  const pushDelim = (text) => {
    tokens.push({ kind: 'delim', text });
  };
  while (i < cmd.length) {
    const c = cmd[i];
    if (quote) {
      current += c;
      if (c === '\\' && quote === '"' && i + 1 < cmd.length) {
        current += cmd[i + 1];
        i += 2;
        continue;
      }
      if (c === quote) quote = null;
      i++;
      continue;
    }
    if (c === '"' || c === "'") {
      quote = c;
      current += c;
      i++;
      continue;
    }
    if (c === '\\' && i + 1 < cmd.length) {
      current += c + cmd[i + 1];
      i += 2;
      continue;
    }
    // here-string `<<<` は heredoc ではないので unsafe にしない
    if (c === '<' && cmd[i + 1] === '<' && cmd[i + 2] === '<') {
      current += '<<<';
      i += 3;
      continue;
    }
    // heredoc は delimiter 形式 (`EOF` / `'EOF'` / `"EOF"` / `\EOF`) を問わず unsafe
    if (c === '<' && cmd[i + 1] === '<') {
      flags.hasHeredoc = true;
      current += '<<';
      i += 2;
      continue;
    }
    if ((c === '<' || c === '>') && cmd[i + 1] === '(') {
      flags.hasProcSub = true;
      current += cmd.slice(i, i + 2);
      i += 2;
      continue;
    }
    if (c === '(') {
      flags.hasSubshell = true;
      current += c;
      i++;
      continue;
    }
    if (c === '{') {
      const prev = i === 0 ? '' : cmd[i - 1];
      const next = i + 1 < cmd.length ? cmd[i + 1] : '';
      if ((prev === '' || /\s/.test(prev)) && /\s/.test(next)) {
        flags.hasGroup = true;
      }
      current += c;
      i++;
      continue;
    }
    const two = cmd.slice(i, i + 2);
    if (two === '&&' || two === '||') {
      pushSeg();
      pushDelim(two);
      i += 2;
      continue;
    }
    if (c === '&') {
      // file descriptor リダイレクト (`2>&1` / `&>file`) はデリミタではなく seg に含める
      const prev = i === 0 ? '' : cmd[i - 1];
      const next = i + 1 < cmd.length ? cmd[i + 1] : '';
      if (prev === '>' || prev === '<' || next === '>') {
        current += c;
        i++;
        continue;
      }
    }
    if (c === ';' || c === '|' || c === '&' || c === '\n') {
      pushSeg();
      pushDelim(c);
      i++;
      continue;
    }
    current += c;
    i++;
  }
  pushSeg();
  return { tokens, flags };
}

// --- セグメント先頭の prefix 退避 ----------------------------------------------
// wrapper のフラグは値付きフラグ (`sudo -u user`) の引数が rtk 対応コマンド名と
// 衝突した時の誤書き換えを避けるため吸収しない (body 側に残す)。
export function splitPrefix(seg) {
  let s = seg;
  const lead = s.match(/^\s*/)[0];
  s = s.slice(lead.length);
  let prefix = lead;
  for (;;) {
    const m1 = s.match(/^\w+=(?:'[^']*'|"(?:[^"\\]|\\.)*"|\S*)\s+/);
    if (m1) {
      prefix += m1[0];
      s = s.slice(m1[0].length);
      continue;
    }
    const m2 = s.match(/^(?:sudo|command|env|nice|nohup|time)\s+/);
    if (m2) {
      prefix += m2[0];
      s = s.slice(m2[0].length);
      continue;
    }
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
  if (flags.hasHeredoc || flags.hasSubshell || flags.hasGroup || flags.hasProcSub) {
    return true;
  }
  for (const t of tokens) {
    if (t.kind === 'seg' && isUnsafeSeg(t.text)) return true;
  }
  return false;
}

// --- 早期判定パターン ---------------------------------------------------------
const EXCLUDE =
  /(--watch|--watchAll|--ui|--debug|--headed|--interactive|--tty|--follow)\b|\s-(it|ti)\b|\battach\b|pytest-watch|\bptw\b/;

// git diff は精読、find は rtk フィルタが GNU find 構文を誤解釈、ps は rtk 0.42 系
// の rewrite と subcommand 表の不整合で `[rtk: No such file or directory]` で死ぬ。
const FORCE_PASSTHROUGH = [/^git\s+diff\b/, /^find\b/, /^ps\b/];

// --- rtk バイナリ解決 ---------------------------------------------------------
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
    return execSync('command -v rtk', { env: { ...process.env, PATH: path } })
      .toString()
      .trim();
  } catch {
    return '';
  }
}

// --- セグメント単位 rewrite ---------------------------------------------------
// rtk rewrite の exit code 規約: 0=ok / 1=N/A / 2=deny / 3=ask
export function rewriteSegmentBody(rtk, body) {
  if (!body.trim()) return { action: 'keep' };
  const res = spawnSync(rtk, ['rewrite', body], { encoding: 'utf8' });
  const out = (res.stdout || '').trim();
  switch (res.status) {
    case 0:
      return out === '' || out === body
        ? { action: 'keep' }
        : { action: 'replace', body: out };
    case 1:
      return { action: 'keep' };
    case 2:
      return { action: 'deny' };
    case 3:
      return out === '' || out === body
        ? { action: 'keep' }
        : { action: 'replace-ask', body: out };
    default:
      return { action: 'keep' };
  }
}

// 書き換え後 body の先頭が裸の `rtk` なら絶対パス化（sudo の secure_path 経由でも
// rtk を見つけられるようにするため、コンテキスト依存の PATH 解決に頼らない）。
function absInBody(rtk, body) {
  if (body === 'rtk') return rtk;
  if (body.startsWith('rtk ')) return `${rtk} ${body.slice(4)}`;
  return body;
}

// --- main ---------------------------------------------------------------------
function main() {
  let payload;
  try {
    payload = JSON.parse(readFileSync(0, 'utf8'));
  } catch {
    allow();
  }
  const command = payload?.toolArgs?.command;
  if (typeof command !== 'string' || command.trim() === '') {
    allow();
  }

  const { tokens, flags } = tokenize(command);
  const segs = tokens.filter((t) => t.kind === 'seg');
  const heads = segs.map((s) => commandHead(s.text));

  // 0. `rtk init` はブロック
  if (heads.some((h) => /^rtk\s+init\b/.test(h))) {
    process.stdout.write(
      JSON.stringify({
        permissionDecision: 'deny',
        permissionDecisionReason:
          'rtk init は禁止。この環境は rtk を CLI 専用で使う方針です（init すると RTK 純正フック/RTK.md が入り既存フックと競合）。出力圧縮は route-command-output.mjs が自動で行うので init は不要です。',
      }),
    );
    process.exit(0);
  }

  // 1. 対話/ストリーミング・FORCE_PASSTHROUGH → 素通し
  if (heads.some((h) => EXCLUDE.test(h) || FORCE_PASSTHROUGH.some((re) => re.test(h)))) {
    allow();
  }

  // 2. 触ると壊れる shell 構文 → 全体 passthrough
  if (hasUnsafeShape(tokens, flags)) allow();

  // 3. rtk 解決（未導入なら passthrough）
  const rtk = resolveRtk();
  if (rtk === '') allow();

  // 4. セグメント数の上限（fork コスト保護）
  const MAX_SEGS = 16;
  if (segs.length > MAX_SEGS) allow();

  // 5. セグメント単位で rewrite
  let needsAsk = false;
  let denyHit = false;
  let anyReplace = false;
  const pieces = [];
  for (const tok of tokens) {
    if (tok.kind === 'delim') {
      pieces.push(tok.text);
      continue;
    }
    const { prefix, body } = splitPrefix(tok.text);
    const tail = body.match(/\s*$/)[0];
    const trimmedBody = tail ? body.slice(0, -tail.length) : body;
    const r = rewriteSegmentBody(rtk, trimmedBody);
    if (r.action === 'deny') {
      denyHit = true;
      pieces.push(tok.text);
      continue;
    }
    if (r.action === 'keep') {
      pieces.push(tok.text);
      continue;
    }
    anyReplace = true;
    if (r.action === 'replace-ask') needsAsk = true;
    pieces.push(prefix + absInBody(rtk, r.body) + tail);
  }

  // 6. deny → Copilot CLI 側の native deny に委ねる（hook は exit 0）
  if (denyHit) allow();

  // 7. 書き換え対象なし → 素通し
  if (!anyReplace) allow();

  const newCommand = pieces.join('');

  // 8. ask: permissionDecision を omit してユーザー確認に委ねる（modifiedArgs だけ返す）
  if (needsAsk) {
    process.stdout.write(JSON.stringify({ modifiedArgs: { command: newCommand } }));
    process.exit(0);
  }

  // 9. 通常: 書き換えて allow
  process.stdout.write(
    JSON.stringify({
      permissionDecision: 'allow',
      modifiedArgs: { command: newCommand },
    }),
  );
  process.exit(0);
}

// エントリポイント保護: 直接実行のときだけ main() を走らせる（symlink 経由でも
// 両辺 realpath で正規化すれば一致する）。
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
