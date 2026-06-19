#!/usr/bin/env node
// preToolUse(bash) hook for GitHub Copilot CLI: RTK で出力を圧縮する。
// Copilot は MCP 非対応のため context-mode 誘導は行わず、RTK のみ。
// Claude Code 版 (common/.claude/hooks/route-command-output.mjs) の RTK 部分を抽出。
import { readFileSync, existsSync } from 'node:fs';
import { execSync, spawnSync } from 'node:child_process';

function allow() {
  process.exit(0);
}

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

function splitSegments(cmd) {
  const segments = [];
  let current = '';
  let quote = null;
  for (let i = 0; i < cmd.length; i++) {
    const c = cmd[i];
    if (quote) {
      current += c;
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

const EXCLUDE =
  /(--watch|--watchAll|--ui|--debug|--headed|--interactive|--tty|--follow)\b|\s-(it|ti)\b|\battach\b|pytest-watch|\bptw\b/;

const FORCE_PASSTHROUGH = [/^git\s+diff\b/, /^find\b/];

const heads = splitSegments(command).map(commandHead);

// rtk init → deny
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

// 対話/ストリーミング、または精読が必要なコマンド → 素通し
if (heads.some((h) => EXCLUDE.test(h) || FORCE_PASSTHROUGH.some((re) => re.test(h)))) {
  allow();
}

// rtk rewrite に委譲
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

const rtk = resolveRtk();
if (rtk === '') {
  allow();
}

const res = spawnSync(rtk, ['rewrite', command], { encoding: 'utf8' });
const rewritten = (res.stdout || '').trim();
if (rewritten === '' || rewritten === command) {
  allow();
}

const spliced = rewritten.replace(
  /(^|[|&;\n(]\s*)((?:\w+=\S+\s+)*)rtk(\s)/g,
  (_m, pre, env, post) => `${pre}${env}${rtk}${post}`,
);

process.stdout.write(
  JSON.stringify({
    permissionDecision: 'allow',
    modifiedArgs: { command: spliced },
  }),
);
process.exit(0);
