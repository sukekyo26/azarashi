#!/usr/bin/env node
// Artifacts の代わりに、単一 HTML ページを保存して 127.0.0.1 のローカルサーバーで配信する。
// 保存先は ARTIFACTS_DIR（既定 ~/.local/share/artifacts/<slug>/{index.html,meta.json}）。
// meta.json に path を持つエントリはリンクで、index.html を持たず登録した絶対パスのファイルを毎回読む。
// サーバーは保存先を毎回読むので、CLI とサーバーの間に受け渡しはない。
import { execFileSync, spawn } from 'node:child_process';
import {
  accessSync, closeSync, constants, createReadStream, existsSync, mkdirSync, openSync, readFileSync, readSync, readdirSync,
  realpathSync, renameSync, rmSync, statSync, writeFileSync,
} from 'node:fs';
import { createServer } from 'node:http';
import { homedir } from 'node:os';
import {
  basename, dirname, extname, isAbsolute, join, resolve, sep,
} from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

const APP = 'local-artifacts';
const SCRIPT = fileURLToPath(import.meta.url);
// サーバーが動かしているコードの版。publish 側と食い違えばサーバーを起動し直す（ensureServer）。
// template.html は publish とリクエストのたびに読むので含めない
const BUILD = ['artifacts.mjs', 'ui.html'].map((f) => statSync(join(dirname(SCRIPT), f)).mtimeMs).join(':');
const ROOT = process.env.ARTIFACTS_DIR
  || join(process.env.XDG_DATA_HOME || join(homedir(), '.local', 'share'), 'artifacts');
const PORT = Number(process.env.ARTIFACTS_PORT || 4317);
const IDLE_MINUTES = Number(process.env.ARTIFACTS_IDLE_MINUTES || 30);
// 待ち受けと同じアドレスを表示する。localhost は環境によって ::1 に解決され、届かないことがある
const BASE = `http://127.0.0.1:${PORT}`;
const SLUG_RE = /^[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?$/;
// DNS rebinding 対策: 自分の名前以外で届いたリクエストは拒否する
const HOSTS = new Set([`localhost:${PORT}`, `127.0.0.1:${PORT}`]);
const ORIGINS = new Set([...HOSTS].map((h) => `http://${h}`));
// ページは opaque origin で動かし、ページのスクリプトから管理 API を叩けないようにする
// allow-popups-to-escape-sandbox: ページから新しいタブで開いた別のサイトには sandbox を引き継がせない（opener は持たないので管理 API には届かない）
const PAGE_CSP = 'sandbox allow-scripts allow-popups allow-popups-to-escape-sandbox allow-forms allow-modals allow-downloads';

const USAGE = `usage: artifacts.sh <command>
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

// ja は管理画面に返す日本語の理由。管理画面から起き得る失敗にだけ付ける
class UsageError extends Error {
  constructor(msg, ja) {
    super(msg);
    this.ja = ja ?? msg;
  }
}

function fail(msg, ja) {
  throw new UsageError(msg, ja);
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
  if (!isLink(meta)) return rest ? null : join(ROOT, slug, 'index.html');
  try {
    // 登録時に実体のパスへ解決してある。途中が symlink に差し替わって実体が変わっていれば、登録時の検査が効かないので返さない
    if (realpathSync(meta.path) !== meta.path) return null;
    let file = meta.path;
    if (rest) {
      // デコードしてから区切る。区切ってからだと %2F が要素の中に / として残り、ドットの検査をすり抜ける
      const parts = decodeURIComponent(rest).split('/');
      if (parts.some((p) => p === '' || p.startsWith('.'))) return null;
      const base = dirname(meta.path);
      file = realpathSync(join(base, ...parts));
      if (!file.startsWith(base + sep)) return null;
    }
    // 通常のファイルだけを返す。FIFO を readFileSync すると、書き手が現れるまでサーバー全体が止まる
    return statSync(file).isFile() ? file : null;
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

// 一覧は管理画面と開いているページが数秒ごとに取りに来るので、リンク先のタイトルをファイルの版ごとに覚え、
// 数 MB のレポートを毎回全文読まない。読めなければ null
// LIMIT: 登録を外したパスの分も残る（1 件数百バイト）。サーバーの寿命の間に数万パスを超えるなら remove で消す
const titleCache = new Map();
function linkTitle(file) {
  let st;
  try {
    st = statSync(file);
  } catch {
    return null;
  }
  const key = `${st.ino}:${st.size}:${st.mtimeMs}:${st.ctimeMs}`;
  const hit = titleCache.get(file);
  if (hit?.key === key) return hit.title;
  const html = readText(file);
  if (html === null) return null;
  const title = titleOf(html);
  titleCache.set(file, { key, title });
  return title;
}

function listArtifacts() {
  if (!existsSync(ROOT)) return [];
  return readdirSync(ROOT)
    .filter((slug) => SLUG_RE.test(slug))
    .map((slug) => {
      const meta = readMeta(slug);
      if (!isLink(meta)) return { slug, ...meta };
      // リンクのタイトルと更新日時はファイルから取る。読めなければ、タイトルは --title で固定した値か slug、
      // 更新日時は登録日時にして、missing を付ける。配信しないファイルは読まない（resolveFile と同じ判定）
      const file = resolveFile(meta, slug, '');
      const title = file ? linkTitle(file) : null;
      return {
        slug,
        ...meta,
        title: meta.title ?? (title || slug),
        updatedAt: (title !== null && versionOf(meta, file)) || meta.updatedAt,
        missing: title === null,
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

// index.html は名前を表さないので、ディレクトリ名から取る
function slugFromFile(file) {
  const name = /^index\.html?$/i.test(basename(file)) ? basename(dirname(resolve(file))) : basename(file, extname(file));
  return name.toLowerCase()
    .replace(/[^a-z0-9]+/g, '-').slice(0, 64).replace(/^-+|-+$/g, '');
}

const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', '#39': "'" };

// SVG の <title> は図の説明なので、文書のタイトルにも文書の枠の判定にも使わない
// LIMIT: 入れ子の <svg> は内側の </svg> で切れる。入れ子の図で誤判定が出たら HTML パーサに替える
const outsideSvg = (html) => html.replace(/<svg[\s>][\s\S]*?<\/svg>/gi, '');

// <title>、なければ最初の <h1> の中身をプレーンテキストにして返す（meta.json と管理画面はテキストで扱う）
function titleOf(html) {
  const s = outsideSvg(html);
  const m = s.match(/<title[^>]*>([\s\S]*?)<\/title>/i) ?? s.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i);
  if (!m) return '';
  return m[1].replace(/<[^>]*>/g, '').replace(/&(amp|lt|gt|quot|#39);/g, (_, e) => ENTITIES[e])
    .replace(/\s+/g, ' ').trim();
}

const escapeHtml = (s) => s.replace(/[&<>"']/g, (c) => `&${Object.keys(ENTITIES).find((k) => ENTITIES[k] === c)};`);

// 文書の枠（<!doctype> <html> <head> <body> <title>）を持たない入力は本文だけの断片とみなし、
// 同梱の雛形で包む。包んだ結果を保存するので、雛形を後で変えても公開済みのページは変わらない。
const DOCUMENT_RE = /<!doctype|<(html|head|body|title)[\s>]/i;

function wrapFragment(html, title) {
  if (DOCUMENT_RE.test(outsideSvg(html))) return html;
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

// リンクとして登録できるか。ディレクトリの配下も配信するので、公開範囲を HTML のあるディレクトリに絞る:
// ホームやルートの直下は丸ごと公開になり、ホーム直下の隠しディレクトリ（~/.ssh・~/.config 等）は設定や鍵の置き場なので拒否する。
// リポジトリ内の .agents・.github などは対象外（配下の .git 等は resolveFile が配信しない）
function checkLinkPath(path) {
  // 名前が .html でも FIFO などは読むと止まるので、通常のファイルに限る
  if (!/\.html?$/i.test(path) || !statSync(path).isFile()) {
    fail(`${path} is not an .html file; only HTML files can be linked`, `${path} は HTML ファイル（.html / .htm）ではありません`);
  }
  const home = homedir();
  if (path.startsWith(home + sep) && path.slice(home.length + 1).startsWith('.')) {
    fail(
      `${path} is under a hidden directory of your home (settings and keys live there); move it out to link it`,
      `${path} はホーム直下の隠しディレクトリ（設定や鍵の置き場）の中にあるので登録できません`,
    );
  }
  if ([sep, home].includes(dirname(path))) {
    fail(
      `${path} would expose all of ${dirname(path)}; move it into a directory of its own and link it there`,
      `${path} を登録すると ${dirname(path)} 全体が公開されます。専用のディレクトリに置いてから登録してください`,
    );
  }
}

// リンクで URL 名（slug）を省いたときの名前。同じパスの登録があればそれを更新し、
// 別のファイルが使っていれば -2, -3 … を付けて新しく登録する（index.html のような同名ファイルを上書きしない）
function freeSlug(base, path) {
  // 同じパスは、自動で付く名前と違う URL 名で登録されていてもそれを使う
  const same = existsSync(ROOT) && readdirSync(ROOT).find((s) => SLUG_RE.test(s) && readMeta(s)?.path === path);
  if (same) return same;
  for (let n = 1; ; n++) {
    const suffix = n === 1 ? '' : `-${n}`;
    const slug = base.slice(0, 64 - suffix.length).replace(/-+$/, '') + suffix;
    if (!readMeta(slug)) return slug;
  }
}

// 検証して保存する内容を作る（まだ書かない）。CLI の publish と管理画面の登録で共通
function prepare(file, opts, cwd) {
  const cannotRead = (e) => fail(
    `cannot read ${file}: ${e.message}`,
    `${file} を読めません（${e.code ?? e.message}）。パスとファイルがあるかを確かめてください`,
  );
  let path;
  if (opts.link) {
    // symlink を解決した実体のパスで検査して保存する。リンク名のまま検査すると、
    // 隠しディレクトリなどを指す symlink（ファイルでもディレクトリでも）で制限を抜けられる
    try {
      path = realpathSync(resolve(cwd, file));
    } catch (e) {
      cannotRead(e);
    }
    checkLinkPath(path);
  }
  let html;
  try {
    html = readFileSync(path ?? file, 'utf8');
  } catch (e) {
    cannotRead(e);
  }
  // 名前は symlink の先ではなく、指定されたファイル名から付ける
  const slug = opts.slug ?? (path ? freeSlug(slugFromFile(file), path) : slugFromFile(file));
  if (!SLUG_RE.test(slug)) {
    fail(
      `invalid slug "${slug}": use lowercase letters, digits and hyphens via --slug`,
      `URL 名「${slug}」は使えません。英小文字・数字・ハイフンで入力してください`,
    );
  }
  const prev = readMeta(slug);
  if (prev && isLink(prev) !== Boolean(opts.link)) {
    fail(
      `"${slug}" is ${isLink(prev) ? 'a linked file' : 'a stored page'}; run "artifacts.sh rm ${slug}" first or use another --slug`,
      `URL 名「${slug}」は${isLink(prev) ? 'リンク' : 'アーティファクト'}で使われています。別の URL 名を入力してください`,
    );
  }
  const now = new Date().toISOString();
  // 管理画面で付けたお気に入りと、画面で編集したタイトル・プロジェクトは公開し直しても保つ。タイトルは --title が優先する
  const keepTitle = !opts.title && prev?.titleEdited;
  const meta = {
    path,
    // リンクのタイトルは毎回ファイルから取るので、--title か画面で固定したときだけ記録する
    title: opts.title ?? (path || keepTitle ? prev?.title : titleOf(html) || prev?.title || slug),
    titleEdited: keepTitle || undefined,
    description: opts.description ?? prev?.description ?? '',
    // ルート（/）では名前が空になる。空は記録せず「記録なし」に入れる（管理画面の「すべて」の値 '' と衝突するため）
    project: prev?.projectEdited ? prev.project : projectName(path ? dirname(path) : cwd) || undefined,
    projectEdited: prev?.projectEdited,
    favorite: prev?.favorite,
    createdAt: prev?.createdAt ?? now,
    updatedAt: now,
  };
  return {
    slug, meta, page: path ? null : wrapFragment(html, meta.title), created: !prev,
  };
}

function writeMeta(slug, meta) {
  writeAtomic(join(ROOT, slug, 'meta.json'), `${JSON.stringify(meta, null, 2)}\n`);
}

function save({ slug, meta, page }) {
  const dir = join(ROOT, slug);
  mkdirSync(dir, { recursive: true });
  if (page !== null) writeAtomic(join(dir, 'index.html'), page);
  writeMeta(slug, meta);
}

async function publish(file, opts) {
  if (!file) fail(USAGE);
  const entry = prepare(file, opts, process.cwd());
  // サーバーを確かめてから書く。失敗した publish が保存先にページを残さないように
  await ensureServer();
  save(entry);
  return entry;
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
  if (!SLUG_RE.test(slug) || !readMeta(slug)) fail(`no artifact "${slug}" (see: artifacts.sh list)`);
  rmSync(join(ROOT, slug), { recursive: true, force: true });
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

// LIMIT: Range に対応しない。動画をシークして見る用途が出たら足す
function servePage(res, slug, rest) {
  const meta = readMeta(slug);
  const file = meta && resolveFile(meta, slug, rest);
  if (!file) return send(res, 404, 'not found');
  // 版は本文より先に取る。間に変わっても、取りこぼさず再読み込みが 1 回余分に起きるだけで済む
  const version = versionOf(meta, file);
  const fd = openOrNull(file);
  if (fd === null) return send(res, 404, 'not found');
  const type = rest ? TYPES[extname(file).toLowerCase()] ?? 'application/octet-stream' : TYPES['.html'];
  // 資材も sandbox で返す。直接開いた SVG や HTML が 127.0.0.1 の origin で動き、管理 API を叩けないように
  const headers = { 'content-type': type, 'content-security-policy': PAGE_CSP, 'x-content-type-options': 'nosniff' };
  if (type !== TYPES['.html']) return stream(res, fd, headers);
  return sendPage(res, fd, meta, slug, rest, headers, servedScript(slug, rest, version));
}

function openOrNull(file) {
  try {
    return openSync(file, 'r');
  } catch {
    return null;
  }
}

// ページを返す。書き換えが要るのは断片のリンクだけで、それ以外は全体をメモリに載せずに流す。
// 保存したページは公開時に包んである。リンクはファイルが変わり続けるので、配信やダウンロードのたびに包む
function sendPage(res, fd, meta, slug, rest, headers, tail = '') {
  let streamable;
  try {
    streamable = !isLink(meta) || startsAsDocument(fd);
  } catch (e) {
    // 先頭を読めなかったときも fd を閉じる。投げた例外は handle の呼び出し元が 500 にする
    closeSync(fd);
    throw e;
  }
  if (streamable) return stream(res, fd, headers, tail);
  let body;
  try {
    body = readFileSync(fd);
  } finally {
    closeSync(fd);
  }
  const text = body.toString('utf8');
  const wrapped = wrapLink(meta, slug, rest, text);
  // 先頭で文書と分からなかった文書はバイト列のまま返す（UTF-8 でないファイルを読み替えて壊さないため）
  return send(res, 200, wrapped === text ? Buffer.concat([body, Buffer.from(tail)]) : wrapped + tail, headers);
}

const wrapLink = (meta, slug, rest, page) => wrapFragment(page, (!rest && meta.title) || titleOf(page) || slug);

// 先頭 1 KB だけで文書かを見る。目印は wrapFragment と同じで、SVG の <title> を拾わないよう最初の <svg> より前で探す。
// 目印が先頭に無い文書は全体を読み、wrapFragment があらためて判定する（遅くなるだけで結果は変わらない）
function startsAsDocument(fd) {
  const buf = Buffer.alloc(1024);
  const head = buf.toString('utf8', 0, readSync(fd, buf, 0, buf.length, 0));
  const svg = head.search(/<svg[\s>]/i);
  return DOCUMENT_RE.test(svg < 0 ? head : head.slice(0, svg));
}

// 開いたファイルを先頭から流し、tail を末尾に足す。ヘッダーを送った後に読めなくなったら接続を切る
function stream(res, fd, headers, tail = '') {
  res.writeHead(200, { 'cache-control': 'no-store', ...headers });
  const s = createReadStream(null, { fd, start: 0 });
  s.on('error', () => res.destroy());
  s.on('end', () => res.end(tail));
  // 途中で切断されたら読むのをやめて fd を閉じる。bun は終えていない応答の切断で res の close を出さないので req で見る
  res.req.on('close', () => s.destroy());
  s.pipe(res, { end: false });
}

function send(res, status, body, headers = {}) {
  res.writeHead(status, { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store', ...headers });
  res.end(body);
}

// 外枠の中では、別のサイトへのリンクを新しいタブで開く。多くのサイトは iframe に入れられるのを拒むので、
// 外枠の中で開くと何も表示されない。_top・_parent も sandbox が上の階層への移動を禁じていて開けない。
// sandbox の中では location.origin が "null" なので、比べるのは host
const LEAVE_FRAME = "if (top !== self) addEventListener('click', (e) => {"
  + "const a = e.target.closest?.('a[href]');"
  + "if (!a || e.defaultPrevented || e.button || e.ctrlKey || e.metaKey || e.shiftKey || e.altKey) return;"
  + "if (!['', '_self', '_parent', '_top'].includes(a.target)) return;"
  + "const u = new URL(a.href, location.href);"
  + "if (!/^https?:$/.test(u.protocol) || u.host === location.host) return;"
  + "e.preventDefault(); open(u.href, '_blank', 'noopener');});";

// 配信時にだけ末尾へ足すスクリプト。公開し直したら（リンクはファイルを保存したら）開いているタブを再読み込みさせ、
// 外枠の中では外部リンクを新しいタブで開く。読み込んだ版を since に埋め込むので、接続前に変わっても取りこぼさない。
function servedScript(slug, rest, version) {
  // rest には ' が残り得るので、文字列リテラルは JSON.stringify で作る
  const url = JSON.stringify(`/api/events/${slug}${rest ? `/${rest}` : ''}?since=${encodeURIComponent(version)}`);
  // 合図を受けたら購読を閉じてから読み直す。読み直しが遅いと、再接続で合図がもう一度届くため
  return `\n<script>{const es = new EventSource(${url});`
    + `es.addEventListener('reload', () => { es.close(); location.reload(); });${LEAVE_FRAME}}</script>\n`;
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

// 管理画面からの書き込み（リンクの登録・説明の編集）の本文を読む。他サイトや sandbox 内のページからは、
// Origin の確認と JSON 必須（CORS の preflight が要る）で拒否する。拒否したら応答を返して undefined を返す。
// LIMIT: 127.0.0.1 は同じマシンの全ユーザーに開いており、Origin を偽れば誰でも書き込める。共有マシンでは動かさない
async function readJson(req, res) {
  const reject = (status, msg) => {
    send(res, status, msg);
    return undefined;
  };
  if (!ORIGINS.has(req.headers.origin)) return reject(403, 'forbidden origin');
  if (!/^application\/json\b/i.test(req.headers['content-type'] ?? '')) return reject(415, 'send application/json');
  let body = '';
  for await (const chunk of req) {
    body += chunk;
    if (body.length > 65536) return reject(413, 'request body too large');
  }
  let input;
  try {
    input = JSON.parse(body);
  } catch {
    return reject(400, '送られた内容を読めませんでした（JSON ではありません）');
  }
  // オブジェクト以外（数値・文字列・配列・null）は送り間違い。何も変えない成功にせず断る
  if (typeof input !== 'object' || input === null || Array.isArray(input)) {
    return reject(400, '送られた内容を読めませんでした（JSON のオブジェクトで送ってください）');
  }
  return input;
}

async function addLink(req, res) {
  const input = await readJson(req, res);
  if (input === undefined) return;
  const text = (v) => (typeof v === 'string' && v.trim() ? v.trim() : undefined);
  const path = text(input.path);
  if (!path || !isAbsolute(path)) return send(res, 400, 'HTML ファイルの絶対パス（/ で始まるパス）を入力してください');
  let entry;
  try {
    entry = prepare(path, { link: true, slug: text(input.slug), description: text(input.description) }, dirname(path));
  } catch (e) {
    if (e instanceof UsageError) return send(res, 400, e.ja);
    throw e;
  }
  // CLI と違い、入力した URL 名が別のファイルで使われていれば上書きしない。画面の入力ミスで別のリンクを置き換えないように。
  // 省いたときは prepare が空いている名前か同じパスの登録を選ぶので、ここには来ない
  const prev = readMeta(entry.slug);
  if (prev && prev.path !== entry.meta.path) {
    return send(res, 409, `URL 名「${entry.slug}」は ${prev.path} で使われています。別の URL 名を入力するか、空欄にしてください`);
  }
  save(entry);
  return send(res, entry.created ? 201 : 200, JSON.stringify({ slug: entry.slug }), { 'content-type': 'application/json' });
}

// 管理画面からの編集。送られた項目（タイトル・説明・プロジェクト・URL 名・お気に入り）だけを書き換える。
// 版（updatedAt）は変えないので、並び順も開いているタブの再読み込みも動かない
async function editArtifact(req, res, slug) {
  const input = await readJson(req, res);
  if (input === undefined) return;
  const meta = readMeta(slug);
  if (!meta) return send(res, 404, 'not found');
  const has = (k) => Object.hasOwn(input, k);
  if (['title', 'description', 'project', 'slug'].some((k) => has(k) && typeof input[k] !== 'string')) {
    return send(res, 400, 'タイトル・説明・プロジェクト・URL 名は文字列で送ってください');
  }
  if (has('favorite') && typeof input.favorite !== 'boolean') return send(res, 400, 'お気に入りは true か false で送ってください');
  const next = { ...meta };
  if (has('description')) next.description = input.description.trim();
  // 外したときは記録から消す
  if (has('favorite')) next.favorite = input.favorite || undefined;
  // 空にしたタイトルは、リンクならファイルから取り直し、保存したページなら HTML の <title> か slug に戻す。
  // 編集した印（titleEdited・projectEdited）があれば公開し直しても保ち、空にしたら印を外して自動に戻す
  if (has('title')) {
    next.title = input.title.trim()
      || (isLink(meta) ? undefined : titleOf(readText(join(ROOT, slug, 'index.html')) ?? '') || slug);
    next.titleEdited = Boolean(input.title.trim()) || undefined;
  }
  // 空にしたプロジェクトは記録しない（「記録なし」に入る）。/ は管理画面で「記録なし」を表す値なので使えない
  if (has('project')) {
    if (input.project.trim() === '/') return send(res, 400, 'プロジェクト名に / だけは使えません');
    next.project = input.project.trim() || undefined;
    next.projectEdited = Boolean(next.project) || undefined;
  }
  const to = has('slug') ? input.slug.trim() : slug;
  if (!SLUG_RE.test(to)) return send(res, 400, `URL 名「${to}」は使えません。英小文字・数字・ハイフンで入力してください`);
  if (to !== slug && existsSync(join(ROOT, to))) {
    return send(res, 409, `URL 名「${to}」は使われています。別の URL 名を入力してください`);
  }
  writeMeta(slug, next);
  // URL 名の変更はディレクトリの名前を変えるだけ。古い URL を開いているタブは「見つかりません」になる
  if (to !== slug) renameSync(join(ROOT, slug), join(ROOT, to));
  return send(res, 200, JSON.stringify({ slug: to }), { 'content-type': 'application/json' });
}

async function handle(req, res, ui) {
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
    return send(res, 200, JSON.stringify({ app: APP, pid: process.pid, root: ROOT, build: BUILD, runtime: process.execPath }), json);
  }
  if (req.method === 'GET' && pathname === '/api/artifacts') return send(res, 200, JSON.stringify(listArtifacts()), json);
  if (req.method === 'GET' && (m = pathname.match(/^\/api\/events\/([^/]+)(?:\/(.+))?$/)) && SLUG_RE.test(m[1])) {
    return watch(req, res, m[1], m[2] ?? '', searchParams.get('since') ?? '');
  }
  if (req.method === 'GET' && (m = pathname.match(/^\/api\/artifacts\/([^/]+)\/download$/)) && SLUG_RE.test(m[1])) {
    // 保存したままの HTML を返す。本文だけのリンクは表示と同じく雛形で包み、1 ファイルで完結したページとして渡す。
    // 再読み込みのスクリプトなど配信時に差し込むものは含めない
    const meta = readMeta(m[1]);
    const file = meta && resolveFile(meta, m[1], '');
    const fd = file ? openOrNull(file) : null;
    if (fd === null) return send(res, 404, 'not found');
    return sendPage(res, fd, meta, m[1], '', { ...html, 'content-disposition': `attachment; filename="${m[1]}.html"` });
  }
  if (req.method === 'POST' && pathname === '/api/artifacts') return addLink(req, res);
  if (req.method === 'PATCH' && (m = pathname.match(/^\/api\/artifacts\/([^/]+)$/)) && SLUG_RE.test(m[1])) {
    return editArtifact(req, res, m[1]);
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
    // ページの URL は管理画面と同じ見出しの外枠を返し、本体は外枠の iframe が ?raw で読む。ページの HTML には何も足さない。
    // 無いページも外枠を 404 で返し、画面で「見つかりません」と一覧への戻り口を出す
    if (!m[3] && !searchParams.has('raw')) {
      const meta = readMeta(m[1]);
      return send(res, meta && resolveFile(meta, m[1], '') ? 200 : 404, ui, html);
    }
    return servePage(res, m[1], m[3]);
  }
  return send(res, 404, 'not found');
}

function serve() {
  mkdirSync(ROOT, { recursive: true });
  const ui = readFileSync(join(dirname(SCRIPT), 'ui.html'));
  // 応答中の接続が無いまま IDLE_MINUTES 経ったら終了し、常駐メモリを返す。次の publish が起動し直す。
  // 開いているページは SSE を保ち、表示中の管理画面は数秒ごとに一覧を取るので、見ている間は落ちない
  let active = 0;
  let idle;
  // setTimeout は 2^31-1 ms（約 24.8 日）を超えると即座に発火するので、そこで頭打ちにする
  const arm = () => { idle = setTimeout(() => process.exit(0), Math.min(IDLE_MINUTES * 60_000, 2 ** 31 - 1)); };
  const server = createServer((req, res) => {
    active++;
    clearTimeout(idle);
    // res ではなく req の close で数える。bun は SSE のように終えていない応答の切断で res の close を出さない
    req.on('close', () => {
      if (--active === 0) arm();
    });
    handle(req, res, ui).catch((e) => send(res, 500, e.message));
  });
  arm();
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

// 起動や終了は 100 ms かからないので、細かく確かめて待ちすぎない（上限は 20 ms × 150 回 = 3 秒）
async function waitWhile(p, cond) {
  for (let i = 0; i < 150 && cond(p); i++) {
    await new Promise((r) => setTimeout(r, 20));
    p = await probe();
  }
  return p;
}

async function ensureServer() {
  let p = await probe();
  // スキルの更新や bun の出し入れの後も、起動したときのコードとランタイムのままのサーバーを使い続けない
  if (p.state === 'ours' && p.root === ROOT && (p.build !== BUILD || p.runtime !== process.execPath)) {
    const old = p.pid;
    terminate(old);
    // 止めたサーバーだけを待つ。並行した別の publish が先に起動し直していれば、そのサーバーをそのまま使う
    p = await waitWhile(p, (q) => q.state === 'ours' && q.pid === old);
    if (p.state === 'ours' && p.pid === old) fail(`the outdated server (pid ${old}) did not stop; run "artifacts.sh stop" and publish again`);
  }
  if (p.state === 'down') {
    spawn(process.execPath, [SCRIPT, 'serve'], { detached: true, stdio: 'ignore' }).unref();
    p = await waitWhile(p, (q) => q.state === 'down');
  }
  if (p.state === 'other') fail(`port ${PORT} is used by another program; set ARTIFACTS_PORT to a free port`);
  if (p.state === 'down') fail(`the server did not start; run '${process.execPath}' '${SCRIPT}' serve to see the error`);
  if (p.root !== ROOT) fail(`the server on port ${PORT} serves ${p.root}; run "artifacts.sh stop" and publish again`);
}

async function stop() {
  const p = await probe();
  if (p.state !== 'ours') {
    console.log('server is not running');
    return;
  }
  terminate(p.pid);
  console.log(`stopped server (pid ${p.pid})`);
}

function terminate(pid) {
  try {
    process.kill(pid, 'SIGTERM');
  } catch (e) {
    // probe と kill の間に自分で終了していれば、止まっている状態なので成功扱い
    if (e.code !== 'ESRCH') throw e;
  }
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
  if (!(IDLE_MINUTES > 0)) {
    fail(`invalid ARTIFACTS_IDLE_MINUTES "${process.env.ARTIFACTS_IDLE_MINUTES}": use a positive number of minutes`);
  }
  const { positionals, values } = parseArgs({
    allowPositionals: true,
    options: {
      link: { type: 'boolean' }, slug: { type: 'string' }, title: { type: 'string' }, description: { type: 'string' },
    },
  });
  // 空のタイトルは「付けない」と区別できず、一覧が空欄になるだけなので受け付けない
  if (values.title !== undefined && !values.title.trim()) {
    fail('--title is empty: give the page a name, or omit --title to take it from the <title> or first <h1>');
  }
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
