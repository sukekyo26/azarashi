#!/usr/bin/env node
// PreToolUse(Bash) hook: 重い/冗長なコマンドの出力を圧縮またはオフロードしてトークンを節約する。
//  1. 対話/ストリーミング (`-it` / `--follow` / `--watch` / attach 等) と `git diff` / `find` は素通し。
//  2. 間接実行 (npm/pnpm/yarn/bun テストスクリプト, make, just) は context-mode の ctx_execute へ
//     誘導 (deny)。内側のツールが隠れて圧縮が効かないため、丸ごとオフロードする方が削減できる。
//  3. それ以外は RTK の公式 API `rtk rewrite` をセグメント単位で適用する（複合コマンド対応）。
//     `cd /foo && aws s3 ls` のような複合の中で rtk が対応する部分だけ `rtk <cmd>` に置換し、
//     非対応セグメント・デリミタ・ヒアドキュメント等の構文は原文を維持する。
//     rtk 公式の exit code 規約 (0=ok, 1=N/A, 2=deny, 3=ask) を尊重し、ask の場合は
//     permissionDecision を omit して Claude Code のユーザー確認に委ねる。
import {
  readFileSync,
  existsSync,
  writeFileSync,
  mkdirSync,
  realpathSync,
} from 'node:fs';
import { execSync, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

// --- 共通ヘルパー -------------------------------------------------------------

function allow() {
  process.exit(0);
}

// --- 字句分割: セグメントとデリミタを保持して交互に並べる ----------------------
//
// `&&` `||` `;` `|` `&` 改行で区切るが、クォート内の区切り文字は無視する。
// 戻り値は { tokens, flags } の組:
//   tokens: [{ kind: 'seg' | 'delim', text }] — 連結すれば原文に戻る
//   flags : 危険なシェル構文を含むかの集計（heredoc / subshell / grouping / process substitution）
//
// 既存実装の `splitSegments` から発展。再構築のためにデリミタを保持し、
// クォート外で出現するメタ文字を 1 パスで集計する。
export function tokenize(cmd) {
  const tokens = [];
  const flags = {
    hasHeredoc: false,
    hasSubshell: false,
    hasGroup: false,
    hasProcSub: false,
  };
  let current = '';
  let quote = null; // "'" or '"'
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
      // ダブルクォート内のみバックスラッシュエスケープが効く（次の 1 文字を温存）。
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
    // ヒアドキュメント開始: `<<` or `<<-` + 任意のクォート + ワード
    const here = cmd.slice(i).match(/^<<-?\s*['"]?\w+['"]?/);
    if (here) {
      flags.hasHeredoc = true;
      current += here[0];
      i += here[0].length;
      continue;
    }
    // プロセス置換: `<(` `>(`
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
      // bash の `{ ... ; }` グルーピングは前後が空白／行頭で囲まれる。
      // `${var}` や `{a,b}` (brace 展開) は対象外なので区別する。
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
      // file descriptor リダイレクトの `&` はデリミタではなくセグメントに含める。
      //   `2>&1` `>&2` `<&-` … 直前が `>` または `<` の `&`
      //   `&>file` `&>>file` … 直後が `>` の `&`（bash 拡張）
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
//
// `sudo FOO=bar aws s3 ls` のようなセグメントから「先頭の空白 / env 代入 / wrapper」を剥がし、
// rtk rewrite に渡す本体 body と、後で再貼り付ける prefix に分割する。
//
// wrapper には sudo / command / env / nice / nohup / time を含める。直後の `-X` /
// `--long` どちらのフラグも 1 個ずつ吸収する（例: `sudo -E aws ...`）。順序は env と
// wrapper のどちらでも来うるのでループで交互に剥がす。
//
// env 代入の値はクォート (`FOO='a b'` / `FOO="a b"`) を 1 トークンとして扱う。
// 裸の値は空白で止まる（`FOO=$(echo x)` のように展開や `$(..)` を含む場合は
// 退避を諦めて rtk rewrite 側に丸投げする — そういう値は元々 hook が綺麗に
// 切れないので、ここで頑張らない）。
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
    const m2 = s.match(/^(?:sudo|command|env|nice|nohup|time)\s+(?:-\S+\s+)*/);
    if (m2) {
      prefix += m2[0];
      s = s.slice(m2[0].length);
      continue;
    }
    break;
  }
  return { prefix, body: s };
}

// --- 既存互換: セグメント先頭の「コマンド名以降」を取り出す ---------------------
//
// 早期判定（rtk init / EXCLUDE / CTX_PATTERNS など）は body 全体に対する regex で行うので、
// 末尾の trailing whitespace は気にしなくてよい。
export function commandHead(seg) {
  return splitPrefix(seg).body.trimStart();
}

// --- unsafe shape: 触ると壊れる構文を含むセグメント／全体の検出 -----------------

const CONTROL_HEADS = new Set([
  'for',
  'while',
  'until',
  'if',
  'case',
  'do',
  'done',
  'then',
  'else',
  'elif',
  'fi',
  'esac',
  'select',
  'function',
]);

const FORBIDDEN_HEADS = new Set(['eval', 'exec']);

export function isUnsafeSeg(segText) {
  const { body } = splitPrefix(segText);
  const trimmed = body.trimStart();
  if (trimmed === '') return false;
  // 関数定義: `name() {` または `function name`
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

// --- 既存の早期判定パターン ---------------------------------------------------

// 対話・watch・UI・ストリーミングモード。詰まるのでどちらの対象からも外して素通しする。
const EXCLUDE =
  /(--watch|--watchAll|--ui|--debug|--headed|--interactive|--tty|--follow)\b|\s-(it|ti)\b|\battach\b|pytest-watch|\bptw\b/;

// rtk に渡すと精読できない/壊れるコマンドは常に素通しにする。
//   git diff … エージェントがコード理解のため精読する（圧縮で必要な文脈が欠ける）。
//   find     … rtk の find フィルタが GNU find の `<path> -type f` 構文を誤解釈する。
//   ps       … rtk 0.42 系の `rtk rewrite` は `ps` を rc=3 で書き換えるが `rtk --help`
//              の subcommand 表には `ps` が無い。実行時に `rtk ps` のフォールバックが
//              システム `ps` を spawn しようとして「[rtk: No such file or directory]」
//              で死ぬ（rtk 側の不整合）。標準 `ps` の出力は元々短く圧縮の旨味も薄い。
const FORCE_PASSTHROUGH = [/^git\s+diff\b/, /^find\b/, /^ps\b/];

// context-mode へ誘導する間接実行系。内側のツールが隠れて rtk の専用フィルタが効かないため、
// 丸ごとオフロードする方が削減できる。`ci` は `npm ci` と衝突するので `run ci` のみ heavy 扱い。
const CTX_PATTERNS = [
  /^(npm|pnpm|yarn|bun)\s+(run\s+)?(test|test:[\w:-]+|quality|e2e|lint|check)\b/,
  /^(npm|pnpm|yarn|bun)\s+run\s+ci\b/,
  /^make\s+(test|e2e|quality|lint|ci|check)\b/,
  /^just\s+(test|e2e|quality|lint|ci|check)\b/,
];

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

// --- バージョンガード ---------------------------------------------------------
//
// 公式の `rtk rewrite` は >= 0.23.0 で導入された。古い rtk を silently 素通しすると気付けない
// ので 1 回だけ警告し、sentinel ファイルでキャッシュして以降の起動を高速化する。
function ensureRtkVersion(rtk) {
  const home = process.env.HOME || '';
  const cacheDir = process.env.XDG_CACHE_HOME || (home ? `${home}/.cache` : '');
  const sentinel = cacheDir ? `${cacheDir}/rtk-hook-version-ok` : '';
  if (sentinel && existsSync(sentinel)) return true;
  // cacheDir が無い環境 (HOME も XDG_CACHE_HOME も未設定) でも、バージョン検査自体は
  // 必ず行う。sentinel 書き込みだけをスキップして毎回検査する fallback とする。
  const res = spawnSync(rtk, ['--version'], { encoding: 'utf8' });
  const raw = ((res.stdout || '') + (res.stderr || ''))
    .trim()
    .replace(/^rtk\s+/i, '')
    .split(/\s+/)[0] || '';
  const [maj = NaN, min = NaN] = raw.split('.').map((x) => parseInt(x, 10));
  if (Number.isFinite(maj) && Number.isFinite(min) && (maj > 0 || (maj === 0 && min >= 23))) {
    if (sentinel) {
      try {
        mkdirSync(cacheDir, { recursive: true });
        writeFileSync(sentinel, '');
      } catch {
        /* sentinel が書けなくても続行（毎回バージョンチェックするだけ） */
      }
    }
    return true;
  }
  process.stderr.write(
    `[rtk-hook] WARNING: rtk ${raw || '(unknown)'} is too old (need >= 0.23.0); passthrough\n`,
  );
  return false;
}

// --- セグメント単位 rewrite ---------------------------------------------------
//
// rtk rewrite の exit code 規約:
//   0 — rewrite 一致・deny/ask rule なし → auto-allow
//   1 — rtk 非対応            → 素通し
//   2 — deny rule              → Claude Code の native deny に委ねる（hook は exit 0）
//   3 — ask rule               → rewrite するが auto-allow せず、ユーザー確認させる
//
// 戻り値:
//   { action: 'keep' }                — 原文維持
//   { action: 'replace', body }       — body を置換して allow
//   { action: 'replace-ask', body }   — body を置換するが ask（permissionDecision omit）
//   { action: 'deny' }                — このセグメントが deny rule に当たった
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

// 書き換え後の body 先頭が裸の `rtk` であれば、絶対パスに差し替える。
// sudo など PATH を切り替えるラッパーの後ろに rtk が来るケースで PATH 非依存にするため。
function absInBody(rtk, body) {
  if (body === 'rtk') return rtk;
  if (body.startsWith('rtk ')) return `${rtk} ${body.slice(4)}`;
  return body;
}

// --- main ---------------------------------------------------------------------

function denyToContextMode(command) {
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

function main() {
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

  const { tokens, flags } = tokenize(command);
  const segs = tokens.filter((t) => t.kind === 'seg');
  const heads = segs.map((s) => commandHead(s.text));

  // 0. `rtk init` はブロック（複合コマンドの一部でも）。
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

  // 1. 対話/ストリーミング、または常時素通し対象が含まれる → 素通し（最優先）。
  if (heads.some((h) => EXCLUDE.test(h) || FORCE_PASSTHROUGH.some((re) => re.test(h)))) {
    allow();
  }

  // 2. 間接実行系が含まれる → context-mode へ誘導。
  if (heads.some((h) => CTX_PATTERNS.some((re) => re.test(h)))) {
    denyToContextMode(command);
  }

  // 3. 触ると壊れる shell 構文（heredoc / 制御構文 / サブシェル等）→ 全体 passthrough。
  if (hasUnsafeShape(tokens, flags)) {
    allow();
  }

  // 4. rtk 解決 & バージョンガード。
  const rtk = resolveRtk();
  if (rtk === '') allow(); // rtk 未導入: 圧縮できないので素通し。
  if (!ensureRtkVersion(rtk)) allow();

  // 5. セグメント数の上限（fork コスト保護）。
  const MAX_SEGS = 16;
  if (segs.length > MAX_SEGS) allow();

  // 6. セグメント単位で rewrite し、結果を組み立てる。
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
    // rtk rewrite が trim した結果を返すため、デリミタ手前の trailing whitespace を
    // 別途保持しておき、書き換え後の body と再結合する（原文の整形を維持）。
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

  // 7. いずれかのセグメントが deny → Claude Code の native deny rule に委ねる（hook は exit 0）。
  if (denyHit) allow();

  // 8. 書き換え対象なし → 素通し。
  if (!anyReplace) allow();

  const newCommand = pieces.join('');

  // 9. ask: permissionDecision を omit して Claude Code にユーザー確認させる。
  if (needsAsk) {
    process.stdout.write(
      JSON.stringify({
        hookSpecificOutput: {
          hookEventName: 'PreToolUse',
          updatedInput: { ...payload.tool_input, command: newCommand },
        },
      }),
    );
    process.exit(0);
  }

  // 10. 通常: 書き換えて allow。
  process.stdout.write(
    JSON.stringify({
      hookSpecificOutput: {
        hookEventName: 'PreToolUse',
        permissionDecision: 'allow',
        permissionDecisionReason: 'RTK auto-rewrite',
        updatedInput: { ...payload.tool_input, command: newCommand },
      },
    }),
  );
  process.exit(0);
}

// エントリポイント保護: 直接実行（shebang or `node hook.mjs`）の時だけ main() を走らせる。
// symlink 経由でも argv[1] を realpath で実体に揃えれば import.meta.url と一致する。
function isMain() {
  try {
    // 両辺とも realpath に揃える。Node が `--preserve-symlinks` などで `import.meta.url`
    // に symlink パスを残す環境でも、`process.argv[1]` 側だけ realpath すると比較が
    // 不一致になり main() が走らなくなる。
    const here = realpathSync(fileURLToPath(import.meta.url));
    const invoked = process.argv[1] ? realpathSync(process.argv[1]) : '';
    return invoked === here;
  } catch {
    return false;
  }
}

if (isMain()) main();
