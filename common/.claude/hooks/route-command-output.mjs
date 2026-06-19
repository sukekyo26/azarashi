#!/usr/bin/env node
// PreToolUse(Bash) hook: 重い/冗長なコマンドの出力を圧縮またはオフロードしてトークンを節約する。
//  1. 対話/ストリーミング (`-it` / `--follow` / `--watch` / attach 等) と `git diff` は素通し。
//     対話はサンドボックス/圧縮で詰まる。git diff はコード理解のため精読するので生のまま残す。
//  2. 間接実行 (npm/pnpm/yarn/bun テストスクリプト, make, just) は context-mode の ctx_execute へ
//     誘導 (deny)。内側のツールが隠れて圧縮が効かないため、丸ごとオフロードする方が削減できる。
//  3. それ以外は RTK の公式 API `rtk rewrite`（フック用の単一の真実源）に委ね、rtk が圧縮できる
//     コマンドなら `rtk <cmd>` に透過リライトして allow する。複合/パイプ/env 前置きは rtk が解決。
//     rtk が非対応のコマンド・rtk 未導入時は素通し。rtk は絶対パスで差し込むので PATH 非依存。
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

// 対話・watch・UI・ストリーミングモード。詰まるのでどちらの対象からも外して素通しする。
// docker/kubectl の `-it` 対話シェルや `--follow` ログ追従も含む。
const EXCLUDE =
  /(--watch|--watchAll|--ui|--debug|--headed|--interactive|--tty|--follow)\b|\s-(it|ti)\b|\battach\b|pytest-watch|\bptw\b/;

// rtk に渡すと精読できない/壊れるコマンドは常に素通しにする。
//   git diff … エージェントがコード理解のため精読する（圧縮で必要な文脈が欠ける）。
//   find     … rtk の find フィルタが GNU find の `<path> -type f` 構文を誤解釈し、
//              ファイル一覧の代わりに `0 for '*'` のような誤出力を返す（正確性のバグ）。
const FORCE_PASSTHROUGH = [/^git\s+diff\b/, /^find\b/];

// context-mode へ誘導する間接実行系（recipe / script runner）。内側のツールが隠れて rtk の
// 専用フィルタが効かないため、丸ごとオフロードする方が削減できる。先頭一致で判定。
// `ci` は `npm ci`(clean install) と衝突するので、ここでは `run ci`(スクリプト) のみ heavy 扱い。
const CTX_PATTERNS = [
  /^(npm|pnpm|yarn|bun)\s+(run\s+)?(test|test:[\w:-]+|quality|e2e|lint|check)\b/,
  /^(npm|pnpm|yarn|bun)\s+run\s+ci\b/,
  /^make\s+(test|e2e|quality|lint|ci|check)\b/,
  /^just\s+(test|e2e|quality|lint|ci|check)\b/,
];

const heads = splitSegments(command).map(commandHead);

// 0. `rtk init` はブロックする（複合コマンドの一部でも）。この環境は rtk を CLI 専用で使う方針で、
//    init すると RTK 純正の PreToolUse フック / RTK.md が入り、context-mode やこのフックと競合する。
if (heads.some((h) => /^rtk\s+init\b/.test(h))) {
  process.stdout.write(
    JSON.stringify({
      hookSpecificOutput: {
        hookEventName: 'PreToolUse',
        permissionDecision: 'deny',
        permissionDecisionReason:
          'rtk init は禁止。この環境は rtk を CLI 専用で使う方針です（init すると RTK 純正フック/RTK.md が入り context-mode と競合）。出力圧縮は route-command-output.mjs が自動で行うので init は不要です。',
      },
    }),
  );
  process.exit(0);
}

// 1. 対話/ストリーミング、または常時素通し対象（git diff / find）が含まれる → 素通し（最優先）。
if (heads.some((h) => EXCLUDE.test(h) || FORCE_PASSTHROUGH.some((re) => re.test(h)))) {
  allow();
}

function denyToContextMode() {
  // モデルは context-mode を既知なので、要点（実行方法＋報告方針）だけを簡潔に伝える。
  const reason = [
    '大量出力のため Bash ではなく context-mode で実行:',
    `  ctx_execute(language: "shell", code: ${JSON.stringify(command)})`,
    '要約と失敗のみ報告、詳細は ctx_search で。',
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

// 2. 間接実行系が含まれる → context-mode へ誘導（単一・複合どちらでも）。
if (heads.some((h) => CTX_PATTERNS.some((re) => re.test(h)))) {
  denyToContextMode();
}

// 3. rtk rewrite に委譲。まず rtk を絶対パスで解決する（既知パスを優先し subprocess を避ける）。
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
  allow(); // rtk 未導入: 圧縮できないので素通し（heavy な間接実行は上で context-mode 済み）。
}

// `rtk rewrite <cmd>` は対応コマンドを `rtk <cmd>` に変換（exit 3）、非対応は空出力（exit 1）。
// 成功時も非ゼロ終了なので throw する execSync ではなく spawnSync で stdout を取る。
const res = spawnSync(rtk, ['rewrite', command], { encoding: 'utf8' });
const rewritten = (res.stdout || '').trim();
if (rewritten === '' || rewritten === command) {
  allow(); // rtk が対応しないコマンド → 素通し。
}

// rtk rewrite は wrapper を裸の `rtk` として出力する。コマンド位置（行頭 / パイプ・`&&`・`;` の後、
// 任意の env 代入を挟む）に現れる `rtk ` だけを絶対パスへ置換し、引数中の `rtk` は温存する。
const spliced = rewritten.replace(
  /(^|[|&;\n(]\s*)((?:\w+=\S+\s+)*)rtk(\s)/g,
  (_m, pre, env, post) => `${pre}${env}${rtk}${post}`,
);

process.stdout.write(
  JSON.stringify({
    hookSpecificOutput: {
      hookEventName: 'PreToolUse',
      permissionDecision: 'allow',
      updatedInput: { ...payload.tool_input, command: spliced },
    },
  }),
);
process.exit(0);
