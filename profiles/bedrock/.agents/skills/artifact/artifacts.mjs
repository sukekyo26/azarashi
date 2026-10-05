#!/usr/bin/env node
// Artifacts の代わりに、単一 HTML ページを保存して 127.0.0.1 のローカルサーバーで配信する。
// 保存先は ARTIFACTS_DIR（既定 ~/.local/share/artifacts/<slug>/{index.html,meta.json}）。
// サーバーは保存先を毎回読むので、CLI とサーバーの間に受け渡しはない。
import { spawn } from 'node:child_process';
import {
  accessSync, constants, existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, writeFileSync,
} from 'node:fs';
import { createServer } from 'node:http';
import { homedir } from 'node:os';
import { basename, dirname, extname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

const APP = 'local-artifacts';
const SCRIPT = fileURLToPath(import.meta.url);
const ROOT = process.env.ARTIFACTS_DIR
  || join(process.env.XDG_DATA_HOME || join(homedir(), '.local', 'share'), 'artifacts');
const PORT = Number(process.env.ARTIFACTS_PORT || 4317);
const BASE = `http://localhost:${PORT}`;
const SLUG_RE = /^[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?$/;
// DNS rebinding 対策: 自分の名前以外で届いたリクエストは拒否する
const HOSTS = new Set([`localhost:${PORT}`, `127.0.0.1:${PORT}`]);
const ORIGINS = new Set([...HOSTS].map((h) => `http://${h}`));
// ページは opaque origin で動かし、ページのスクリプトから管理 API を叩けないようにする
const PAGE_CSP = 'sandbox allow-scripts allow-popups allow-forms allow-modals allow-downloads';

const USAGE = `usage: artifacts.mjs <command>
  publish <file.html> [--slug s] [--title t] [--description d]
                 store the page (same slug overwrites) and print its URL;
                 a new slug is also opened in the browser ($BROWSER, wslview, xdg-open)
  list           list stored pages, newest first (updated<TAB>slug<TAB>title)
  rm <slug>...   delete pages
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

function listArtifacts() {
  if (!existsSync(ROOT)) return [];
  return readdirSync(ROOT)
    .filter((slug) => SLUG_RE.test(slug))
    .map((slug) => ({ slug, ...readMeta(slug) }))
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
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 64);
}

function titleOf(html) {
  const m = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  return m ? m[1].replace(/\s+/g, ' ').trim() : '';
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
  // サーバーを確かめてから書く。失敗した publish が保存先にページを残さないように
  await ensureServer();
  const dir = join(ROOT, slug);
  mkdirSync(dir, { recursive: true });
  const prev = readMeta(slug);
  const now = new Date().toISOString();
  const meta = {
    title: opts.title ?? (titleOf(html) || prev?.title || slug),
    description: opts.description ?? prev?.description ?? '',
    createdAt: prev?.createdAt ?? now,
    updatedAt: now,
  };
  writeAtomic(join(dir, 'index.html'), html);
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

function send(res, status, body, headers = {}) {
  res.writeHead(status, { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store', ...headers });
  res.end(body);
}

function handle(req, res, ui) {
  if (!HOSTS.has(req.headers.host)) return send(res, 403, 'forbidden host');
  const { pathname } = new URL(req.url, BASE);
  const html = { 'content-type': 'text/html; charset=utf-8' };
  const json = { 'content-type': 'application/json' };
  let m;
  if (req.method === 'GET' && pathname === '/') return send(res, 200, ui, html);
  if (req.method === 'GET' && pathname === '/api/health') {
    return send(res, 200, JSON.stringify({ app: APP, pid: process.pid, root: ROOT }), json);
  }
  if (req.method === 'GET' && pathname === '/api/artifacts') return send(res, 200, JSON.stringify(listArtifacts()), json);
  if (req.method === 'DELETE' && (m = pathname.match(/^\/api\/artifacts\/([^/]+)$/))) {
    // 他サイトのページや sandbox 内のページ（Origin: null）からの削除を拒否する
    if (!ORIGINS.has(req.headers.origin)) return send(res, 403, 'forbidden origin');
    if (!SLUG_RE.test(m[1]) || !readMeta(m[1])) return send(res, 404, 'not found');
    remove(m[1]);
    return send(res, 204, '');
  }
  if (req.method === 'GET' && (m = pathname.match(/^\/a\/([^/]+)(\/?)$/)) && SLUG_RE.test(m[1])) {
    if (!m[2]) return send(res, 301, '', { location: `/a/${m[1]}/` });
    let page;
    try {
      page = readFileSync(join(ROOT, m[1], 'index.html'));
    } catch {
      return send(res, 404, 'not found');
    }
    return send(res, 200, page, { ...html, 'content-security-policy': PAGE_CSP });
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
    res = await fetch(`http://127.0.0.1:${PORT}/api/health`, { signal: AbortSignal.timeout(1000) });
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
  process.kill(p.pid, 'SIGTERM');
  console.log(`stopped server (pid ${p.pid})`);
}

function localTime(iso) {
  const d = new Date(iso);
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

async function main() {
  const { positionals, values } = parseArgs({
    allowPositionals: true,
    options: { slug: { type: 'string' }, title: { type: 'string' }, description: { type: 'string' } },
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
      for (const a of listArtifacts()) console.log(`${localTime(a.updatedAt)}\t${a.slug}\t${a.title}`);
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
