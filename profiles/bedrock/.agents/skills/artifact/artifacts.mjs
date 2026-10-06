#!/usr/bin/env node
// Artifacts の代わりに、単一 HTML ページを保存して 127.0.0.1 のローカルサーバーで配信する。
// 保存先は ARTIFACTS_DIR（既定 ~/.local/share/artifacts/<slug>/{index.html,meta.json}）。
// meta.json に path を持つエントリはリンクで、index.html を持たず登録した絶対パスのファイルを毎回読む。
// サーバーは保存先を毎回読むので、CLI とサーバーの間に受け渡しはない。
import { execFileSync, spawn } from 'node:child_process';
import {
  accessSync, constants, existsSync, mkdirSync, readFileSync, readdirSync, realpathSync, renameSync, rmSync, statSync,
  writeFileSync,
} from 'node:fs';
import { createServer } from 'node:http';
import { homedir } from 'node:os';
import {
  basename, dirname, extname, join, resolve, sep,
} from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

const APP = 'local-artifacts';
const SCRIPT = fileURLToPath(import.meta.url);
const ROOT = process.env.ARTIFACTS_DIR
  || join(process.env.XDG_DATA_HOME || join(homedir(), '.local', 'share'), 'artifacts');
const PORT = Number(process.env.ARTIFACTS_PORT || 4317);
// 待ち受けと同じアドレスを表示する。localhost は環境によって ::1 に解決され、届かないことがある
const BASE = `http://127.0.0.1:${PORT}`;
const SLUG_RE = /^[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?$/;
// DNS rebinding 対策: 自分の名前以外で届いたリクエストは拒否する
const HOSTS = new Set([`localhost:${PORT}`, `127.0.0.1:${PORT}`]);
const ORIGINS = new Set([...HOSTS].map((h) => `http://${h}`));
// ページは opaque origin で動かし、ページのスクリプトから管理 API を叩けないようにする
const PAGE_CSP = 'sandbox allow-scripts allow-popups allow-forms allow-modals allow-downloads';

const USAGE = `usage: artifacts.mjs <command>
  publish <file.html> [--link] [--slug s] [--title t] [--description d]
                 store the page (same slug overwrites) and print its URL;
                 body-only HTML (no doctype/html/head/body/title) is wrapped in template.html;
                 a new slug is also opened in the browser ($BROWSER, wslview, xdg-open);
                 --link registers the file in place instead of copying it: it is read on every request,
                 and files under its directory are served for its relative references
  list           list pages, newest first (updated<TAB>slug<TAB>title<TAB>linked path)
  rm <slug>...   delete pages (a linked file itself is left untouched)
  serve          run the server in the foreground
  stop           stop the background server`;

class UsageError extends Error {}

function fail(msg) {
  throw new UsageError(msg);
}

function readMeta(slug) {
  try {
    return JSON.parse(readFileSync(join(ROOT, slug, 'meta.json'), 'utf8'));
  } catch {
    return null;
  }
}

function readText(file) {
  try {
    return readFileSync(file, 'utf8');
  } catch {
    return null;
  }
}

const isLink = (meta) => typeof meta?.path === 'string';

// <slug>/<rest> の実ファイル。rest はパーセントエンコードされたままの URL パス。
// 保存したページは index.html だけ。リンクは登録ファイルと、相対参照の資材としてそのディレクトリの配下を返す。
// ディレクトリの外（.. や外を指す symlink）と、ドットで始まる要素（.git・.env 等）は返さない
function resolveFile(meta, slug, rest) {
  if (!rest) return isLink(meta) ? meta.path : join(ROOT, slug, 'index.html');
  if (!isLink(meta)) return null;
  try {
    const parts = rest.split('/').map(decodeURIComponent);
    if (parts.some((p) => p === '' || p.startsWith('.'))) return null;
    const base = realpathSync(dirname(meta.path));
    const file = realpathSync(join(base, ...parts));
    return file.startsWith(base + sep) ? file : null;
  } catch {
    return null;
  }
}

// ライブリロードで比べる版。保存したページは公開日時、リンクはファイルの更新日時（無ければ空）
function versionOf(meta, file) {
  if (!isLink(meta)) return meta.updatedAt;
  try {
    return statSync(file).mtime.toISOString();
  } catch {
    return '';
  }
}

function listArtifacts() {
  if (!existsSync(ROOT)) return [];
  return readdirSync(ROOT)
    .filter((slug) => SLUG_RE.test(slug))
    .map((slug) => {
      const meta = readMeta(slug);
      if (!isLink(meta)) return { slug, ...meta };
      // リンクのタイトルと更新日時はファイルから取る。読めなければ登録時の値で残し、missing を付ける
      const html = readText(meta.path);
      return {
        slug,
        ...meta,
        title: meta.title ?? (titleOf(html ?? '') || slug),
        updatedAt: (html !== null && versionOf(meta, meta.path)) || meta.updatedAt,
        missing: html === null,
      };
    })
    // meta.json が無い・壊れたエントリは除き、1 件のために一覧全体を落とさない
    .filter((a) => typeof a.updatedAt === 'string')
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

function writeAtomic(path, data) {
  const tmp = `${path}.tmp-${process.pid}`;
  writeFileSync(tmp, data);
  renameSync(tmp, path);
}

function slugFromFile(file) {
  return basename(file, extname(file)).toLowerCase()
    .replace(/[^a-z0-9]+/g, '-').slice(0, 64).replace(/^-+|-+$/g, '');
}

const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', '#39': "'" };

// <title>、なければ最初の <h1> の中身をプレーンテキストにして返す（meta.json と管理画面はテキストで扱う）
function titleOf(html) {
  const m = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i) ?? html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i);
  if (!m) return '';
  return m[1].replace(/<[^>]*>/g, '').replace(/&(amp|lt|gt|quot|#39);/g, (_, e) => ENTITIES[e])
    .replace(/\s+/g, ' ').trim();
}

const escapeHtml = (s) => s.replace(/[&<>"']/g, (c) => `&${Object.keys(ENTITIES).find((k) => ENTITIES[k] === c)};`);

// 文書の枠（<!doctype> <html> <head> <body> <title>）を持たない入力は本文だけの断片とみなし、
// 同梱の雛形で包む。包んだ結果を保存するので、雛形を後で変えても公開済みのページは変わらない。
function wrapFragment(html, title) {
  if (/<!doctype|<(html|head|body|title)[\s>]/i.test(html)) return html;
  const template = readFileSync(join(dirname(SCRIPT), 'template.html'), 'utf8');
  // 置換文字列の $& などを解釈させないよう関数で渡す
  return template.replace('{{title}}', () => escapeHtml(title)).replace('{{content}}', () => html);
}

// 生成元のプロジェクト名。別名で clone しても揃うよう origin の URL（https・scp 形式・パス）から取る。
// origin が無ければリポジトリのディレクトリ名、git の外なら dir のディレクトリ名にする。
// worktree でも元のリポジトリにまとまるよう、show-toplevel ではなく共通の .git から辿る
function projectName(dir) {
  const git = (...args) => execFileSync('git', args, { cwd: dir, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  try {
    const name = git('remote', 'get-url', 'origin').replace(/\/+$/, '').split(/[/:]/).pop().replace(/\.git$/, '');
    if (name) return name;
  } catch {
    // origin が無い、または git の外
  }
  try {
    const common = git('rev-parse', '--path-format=absolute', '--git-common-dir');
    return basename(basename(common) === '.git' ? dirname(common) : common);
  } catch {
    return basename(dir);
  }
}

async function publish(file, opts) {
  if (!file) fail(USAGE);
  let html;
  try {
    html = readFileSync(file, 'utf8');
  } catch (e) {
    fail(`cannot read ${file}: ${e.message}`);
  }
  const slug = opts.slug ?? slugFromFile(file);
  if (!SLUG_RE.test(slug)) fail(`invalid slug "${slug}": use lowercase letters, digits and hyphens via --slug`);
  const prev = readMeta(slug);
  if (prev && isLink(prev) !== Boolean(opts.link)) {
    fail(`"${slug}" is ${isLink(prev) ? 'a linked file' : 'a stored page'}; run "artifacts.mjs rm ${slug}" first or use another --slug`);
  }
  const path = opts.link ? resolve(file) : undefined;
  // リンクはディレクトリの配下も配信するので、ホームやルートを丸ごと公開しない
  if (path && [sep, homedir()].includes(dirname(path))) {
    fail(`${path} would expose all of ${dirname(path)}; move it into a directory of its own and link it there`);
  }
  // サーバーを確かめてから書く。失敗した publish が保存先にページを残さないように
  await ensureServer();
  const dir = join(ROOT, slug);
  mkdirSync(dir, { recursive: true });
  const now = new Date().toISOString();
  const meta = {
    path,
    // リンクのタイトルは毎回ファイルから取るので、--title で固定したときだけ記録する
    title: path ? opts.title : opts.title ?? (titleOf(html) || prev?.title || slug),
    description: opts.description ?? prev?.description ?? '',
    // ルート（/）では名前が空になる。空は記録せず「記録なし」に入れる（管理画面の「すべて」の値 '' と衝突するため）
    project: projectName(path ? dirname(path) : process.cwd()) || undefined,
    createdAt: prev?.createdAt ?? now,
    updatedAt: now,
  };
  if (!path) writeAtomic(join(dir, 'index.html'), wrapFragment(html, meta.title));
  writeAtomic(join(dir, 'meta.json'), `${JSON.stringify(meta, null, 2)}\n`);
  return { slug, created: !prev };
}

function onPath(name) {
  return (process.env.PATH || '').split(':').some((d) => {
    try {
      accessSync(join(d, name), constants.X_OK);
      return true;
    } catch {
      return false;
    }
  });
}

// 開けなくても公開は成功しているので、失敗は無視して表示した URL に任せる。
// $BROWSER は VS Code の devcontainer 等がホストのブラウザで開く補助スクリプトを入れる。
// Linux の /usr/bin/open は openvt なので open は macOS でだけ使う。
// LIMIT: $BROWSER は単一コマンドとして扱う（: 区切りの複数指定は未対応）
function openBrowser(url) {
  const cmd = process.env.BROWSER
    || (process.platform === 'darwin' ? 'open' : ['wslview', 'xdg-open'].find(onPath));
  if (!cmd) return;
  spawn(cmd, [url], { detached: true, stdio: 'ignore' }).on('error', () => {}).unref();
}

function remove(slug) {
  if (!SLUG_RE.test(slug) || !readMeta(slug)) fail(`no artifact "${slug}" (see: artifacts.mjs list)`);
  rmSync(join(ROOT, slug), { recursive: true, force: true });
}

// 管理画面へ戻るリンク。保存した HTML は変えず、配信時に <body> の直後へ差し込む。
// <body> を省いた文書では </head> か doctype の直後に入れる（doctype より前に置くと quirks mode になる）。
// 既定の見た目は詳細度 0 の :where() で付け、ページ側（雛形を含む）の CSS が上書きできるようにする。
const HOME_LINK = '<style>:where(.artifact-home){display:block;margin:0 0 1rem;font:0.85rem/1.6 system-ui,sans-serif}'
  + ':where(.artifact-home a){color:inherit;opacity:.7;text-decoration:none}'
  + ':where(.artifact-home a:hover){opacity:1;text-decoration:underline}</style>'
  + '<nav class="artifact-home"><a href="/">← Home</a></nav>';

function withHomeLink(page) {
  // 配信後の HTML をブラウザで保存して公開し直したページなど、既に持っていれば足さない
  // 属性の順序・引用符・空白や他のクラスが違っても、class に artifact-home を持つ <nav> なら既にあるとみなす
  if (/<nav\b[^>]*\sclass\s*=\s*["']?(?:[^"'>]*\s)?artifact-home(?=[\s"'>])/i.test(page)) return page;
  const anchor = page.match(/<body\b[^>]*>/i) ?? page.match(/<\/head\s*>/i) ?? page.match(/<!doctype\b[^>]*>/i);
  if (!anchor) return HOME_LINK + page;
  const at = anchor.index + anchor[0].length;
  return page.slice(0, at) + HOME_LINK + page.slice(at);
}

// リンクのディレクトリから資材として返すファイルの型。登録ファイル自身は拡張子によらず HTML として返す
const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.htm': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json',
  '.map': 'application/json',
  '.txt': 'text/plain; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
  '.ttf': 'font/ttf',
  '.wasm': 'application/wasm',
};

// LIMIT: 資材も丸ごと読んでから返す。大きな動画などを置くなら stream と Range 対応に替える
function servePage(res, slug, rest) {
  const meta = readMeta(slug);
  const file = meta && resolveFile(meta, slug, rest);
  if (!file) return send(res, 404, 'not found');
  // 版は本文より先に取る。間に変わっても、取りこぼさず再読み込みが 1 回余分に起きるだけで済む
  const version = versionOf(meta, file);
  let body;
  try {
    body = readFileSync(file);
  } catch {
    return send(res, 404, 'not found');
  }
  const type = rest ? TYPES[extname(file).toLowerCase()] ?? 'application/octet-stream' : TYPES['.html'];
  // 資材も sandbox で返す。直接開いた SVG や HTML が 127.0.0.1 の origin で動き、管理 API を叩けないように
  const headers = { 'content-type': type, 'content-security-policy': PAGE_CSP, 'x-content-type-options': 'nosniff' };
  if (type !== TYPES['.html']) return send(res, 200, body, headers);
  let page = body.toString('utf8');
  // 保存したページは公開時に包んである。リンクはファイルが変わり続けるので配信時に包む
  if (isLink(meta)) page = wrapFragment(page, (!rest && meta.title) || titleOf(page) || slug);
  return send(res, 200, withReloader(withHomeLink(page), slug, rest, version), headers);
}

function send(res, status, body, headers = {}) {
  res.writeHead(status, { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store', ...headers });
  res.end(body);
}

// 公開し直したら（リンクはファイルを保存したら）開いているタブを再読み込みさせるスクリプトを、配信時にだけ末尾へ足す。
// 読み込んだ版を since に埋め込むので、接続前に変わっても取りこぼさない。
function withReloader(page, slug, rest, version) {
  // rest には ' が残り得るので、文字列リテラルは JSON.stringify で作る
  const url = JSON.stringify(`/api/events/${slug}${rest ? `/${rest}` : ''}?since=${encodeURIComponent(version)}`);
  // 合図を受けたら購読を閉じてから読み直す。読み直しが遅いと、再接続で合図がもう一度届くため
  return `${page}\n<script>{const es = new EventSource(${url});`
    + "es.addEventListener('reload', () => { es.close(); location.reload(); });}</script>\n";
}

// ページは sandbox（opaque origin、Origin: null）から購読するので、CORS は null にだけ開ける。
// null は他サイトの sandbox iframe からも名乗れるため、合図には更新日時も含めず「変わった」以外を返さない。
// LIMIT: 接続ごとに 1 秒間隔で meta.json とファイルを stat する。同時に開くタブが数十を超えるなら fs.watch に替える
function watch(req, res, slug, rest, since) {
  res.writeHead(200, {
    'content-type': 'text/event-stream', 'cache-control': 'no-store', 'access-control-allow-origin': 'null',
  });
  res.write('retry: 1000\n\n');
  const timer = setInterval(check, 1000);
  req.on('close', () => clearInterval(timer));
  check();
  function check() {
    const meta = readMeta(slug);
    const now = meta ? versionOf(meta, resolveFile(meta, slug, rest)) : '';
    if (now === since) return;
    clearInterval(timer);
    res.end('event: reload\ndata: changed\n\n');
  }
}

function handle(req, res, ui) {
  if (!HOSTS.has(req.headers.host)) return send(res, 403, 'forbidden host');
  let pathname;
  let searchParams;
  try {
    ({ pathname, searchParams } = new URL(req.url, BASE));
  } catch {
    // `//` などの不正なリクエストは、内部エラー（500）ではなく利用側の誤りとして返す
    return send(res, 400, 'bad request');
  }
  const html = { 'content-type': 'text/html; charset=utf-8' };
  const json = { 'content-type': 'application/json' };
  let m;
  if (req.method === 'GET' && pathname === '/') return send(res, 200, ui, html);
  if (req.method === 'GET' && pathname === '/api/health') {
    return send(res, 200, JSON.stringify({ app: APP, pid: process.pid, root: ROOT }), json);
  }
  if (req.method === 'GET' && pathname === '/api/artifacts') return send(res, 200, JSON.stringify(listArtifacts()), json);
  if (req.method === 'GET' && (m = pathname.match(/^\/api\/events\/([^/]+)(?:\/(.+))?$/)) && SLUG_RE.test(m[1])) {
    return watch(req, res, m[1], m[2] ?? '', searchParams.get('since') ?? '');
  }
  if (req.method === 'GET' && (m = pathname.match(/^\/api\/artifacts\/([^/]+)\/download$/)) && SLUG_RE.test(m[1])) {
    // 保存したまま（リンクはファイルのまま）の HTML を返す。配信時に差し込むものは含めず、1 ファイルで完結したページとして渡す
    const meta = readMeta(m[1]);
    let page;
    try {
      page = readFileSync(resolveFile(meta, m[1], ''));
    } catch {
      return send(res, 404, 'not found');
    }
    return send(res, 200, page, { ...html, 'content-disposition': `attachment; filename="${m[1]}.html"` });
  }
  if (req.method === 'DELETE' && (m = pathname.match(/^\/api\/artifacts\/([^/]+)$/))) {
    // 他サイトのページや sandbox 内のページ（Origin: null）からの削除を拒否する
    if (!ORIGINS.has(req.headers.origin)) return send(res, 403, 'forbidden origin');
    // 存在の確認は remove に任せる。並行した削除で先に消えていても 500 にせず 404 で返す
    try {
      remove(m[1]);
    } catch (e) {
      if (e instanceof UsageError) return send(res, 404, 'not found');
      throw e;
    }
    return send(res, 204, '');
  }
  if (req.method === 'GET' && (m = pathname.match(/^\/a\/([^/]+)(?:(\/)(.*))?$/)) && SLUG_RE.test(m[1])) {
    if (!m[2]) return send(res, 301, '', { location: `/a/${m[1]}/` });
    return servePage(res, m[1], m[3]);
  }
  return send(res, 404, 'not found');
}

function serve() {
  mkdirSync(ROOT, { recursive: true });
  const ui = readFileSync(join(dirname(SCRIPT), 'ui.html'));
  const server = createServer((req, res) => {
    try {
      handle(req, res, ui);
    } catch (e) {
      send(res, 500, e.message);
    }
  });
  server.on('error', (e) => {
    console.error(e.code === 'EADDRINUSE'
      ? `artifacts: port ${PORT} is in use; stop that program or set ARTIFACTS_PORT`
      : `artifacts: ${e.message}`);
    process.exit(1);
  });
  server.listen(PORT, '127.0.0.1', () => console.log(`serving ${ROOT} at ${BASE}/`));
  for (const sig of ['SIGTERM', 'SIGINT']) process.on(sig, () => process.exit(0));
}

// 'ours' | 'other'（別のプログラムがポートを使用中） | 'down'
async function probe() {
  let res;
  try {
    res = await fetch(`${BASE}/api/health`, { signal: AbortSignal.timeout(1000) });
  } catch {
    return { state: 'down' };
  }
  const body = await res.json().catch(() => null);
  return body?.app === APP ? { state: 'ours', ...body } : { state: 'other' };
}

async function ensureServer() {
  let p = await probe();
  if (p.state === 'down') {
    spawn(process.execPath, [SCRIPT, 'serve'], { detached: true, stdio: 'ignore' }).unref();
    for (let i = 0; i < 30 && p.state === 'down'; i++) {
      await new Promise((r) => setTimeout(r, 100));
      p = await probe();
    }
  }
  if (p.state === 'other') fail(`port ${PORT} is used by another program; set ARTIFACTS_PORT to a free port`);
  if (p.state === 'down') fail(`the server did not start; run "node ${SCRIPT} serve" to see the error`);
  if (p.root !== ROOT) fail(`the server on port ${PORT} serves ${p.root}; run "artifacts.mjs stop" and publish again`);
}

async function stop() {
  const p = await probe();
  if (p.state !== 'ours') {
    console.log('server is not running');
    return;
  }
  try {
    process.kill(p.pid, 'SIGTERM');
  } catch (e) {
    // probe と kill の間に自分で終了していれば、止まっている状態なので成功扱い
    if (e.code !== 'ESRCH') throw e;
  }
  console.log(`stopped server (pid ${p.pid})`);
}

function localTime(iso) {
  const d = new Date(iso);
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

async function main() {
  if (!Number.isInteger(PORT) || PORT < 1 || PORT > 65535) {
    fail(`invalid ARTIFACTS_PORT "${process.env.ARTIFACTS_PORT}": use a port number from 1 to 65535`);
  }
  const { positionals, values } = parseArgs({
    allowPositionals: true,
    options: {
      link: { type: 'boolean' }, slug: { type: 'string' }, title: { type: 'string' }, description: { type: 'string' },
    },
  });
  const [cmd, ...args] = positionals;
  switch (cmd) {
    case 'publish': {
      const { slug, created } = await publish(args[0], values);
      const url = `${BASE}/a/${slug}/`;
      // 公開し直すたびにタブを増やさない。更新は開いているタブの再読み込みで見る
      if (created) openBrowser(url);
      console.log(url);
      break;
    }
    case 'list':
      for (const a of listArtifacts()) console.log(`${localTime(a.updatedAt)}\t${a.slug}\t${a.title}\t${a.path ?? ''}`);
      break;
    case 'rm':
      if (args.length === 0) fail(USAGE);
      for (const slug of args) remove(slug);
      break;
    case 'serve':
      serve();
      break;
    case 'stop':
      await stop();
      break;
    default:
      fail(USAGE);
  }
}

main().catch((e) => {
  console.error(e instanceof UsageError ? e.message : `artifacts: ${e.message}`);
  process.exit(1);
});
