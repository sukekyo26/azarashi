// AWS Architecture Icons を手元に取得し、名前で引けるようにする。図への埋め込みは diagram.mjs が lookupIcon で行う。
// 図や検索結果での名前は、アイコン集を頭に付けた aws/<name>。この中で扱う名前は aws/ を除いたもの
// アイコンは再配布になるのでリポジトリには入れず、各自のマシンの ARTIFACTS_ICONS_DIR（既定 ~/.local/share/artifacts-icons）に置く
import {
  existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync,
} from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { inflateRawSync } from 'node:zlib';

export const PAGE = 'https://aws.amazon.com/architecture/icons/';
const ICONS_DIR = process.env.ARTIFACTS_ICONS_DIR
  || join(process.env.XDG_DATA_HOME || join(homedir(), '.local', 'share'), 'artifacts-icons');
export const AWS_DIR = join(ICONS_DIR, 'aws');
const INDEX = join(AWS_DIR, 'index.json');
const FETCH_HINT = 'run "artifacts.sh icons-aws fetch" (downloads about 14MB from aws.amazon.com) and try again';

// 公式ページの HTML から Icon package の zip の URL を探す。URL は日付とハッシュを含み、四半期ごとに変わる
export const findPackageUrl = (html) => html.match(/https:\/\/[^"'\s<>]+\/Icon-package_\d{8}[^"'\s<>]*\.zip/)?.[0] ?? null;

// zip の中央ディレクトリを読み、名前と中身を読む関数の組を返す。
// LIMIT: ZIP64（4GB 超・65535 件超）は読まない。公式の zip がそれを超えたら対応する
function* zipEntries(buf, source) {
  let end = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 22 - 0xffff); i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) {
      end = i;
      break;
    }
  }
  if (end < 0) throw new Error(`${source} is not a zip file; pass the Icon package zip from ${PAGE}`);
  const count = buf.readUInt16LE(end + 10);
  let p = buf.readUInt32LE(end + 16);
  if (count === 0xffff || p === 0xffffffff) throw new Error(`${source} is a ZIP64 archive, which is not supported`);
  for (let n = 0; n < count; n++) {
    if (buf.readUInt32LE(p) !== 0x02014b50) throw new Error(`${source} is a broken zip file; download it again`);
    const method = buf.readUInt16LE(p + 10);
    const size = buf.readUInt32LE(p + 20);
    const nameLength = buf.readUInt16LE(p + 28);
    const local = buf.readUInt32LE(p + 42);
    const name = buf.toString('utf8', p + 46, p + 46 + nameLength);
    p += 46 + nameLength + buf.readUInt16LE(p + 30) + buf.readUInt16LE(p + 32);
    // 大きさは中央ディレクトリのものを使う。ローカルヘッダーはデータ記述子を使うと 0 になっている
    yield {
      name,
      read() {
        const start = local + 30 + buf.readUInt16LE(local + 26) + buf.readUInt16LE(local + 28);
        const raw = buf.subarray(start, start + size);
        if (method === 0) return raw;
        if (method === 8) return inflateRawSync(raw);
        throw new Error(`${name} in ${source} uses an unsupported compression method (${method})`);
      },
    };
  }
}

const slug = (s) => s.toLowerCase().replace(/[_\s]+/g, '-').replace(/-+/g, '-');

// zip の中のパスから、取り出すアイコンの名前・カテゴリ・版（ダーク用か）を決める。取り出さないものは null
export function iconOf(path) {
  let m = path.match(/^Architecture-Service-Icons_(\d{8})\/Arch_([^/]+)\/48\/Arch_(.+?)(_Dark)?_48\.svg$/);
  if (m) return { version: m[1], name: slug(m[3]), category: m[2], dark: Boolean(m[4]) };
  m = path.match(/^Architecture-Group-Icons_(\d{8})\/(.+?)_32(_Dark)?\.svg$/);
  if (m) return { version: m[1], name: `group/${slug(m[2])}`, category: 'Group', dark: Boolean(m[3]) };
  m = path.match(/^Resource-Icons_(\d{8})\/Res_([^/]+)\/(?:Res_48_(?:Light|Dark)\/)?Res_(.+?)_48(?:_(Light|Dark))?\.svg$/);
  if (m) return { version: m[1], name: `res/${slug(m[3])}`, category: m[2], dark: m[4] === 'Dark' };
  return null;
}

function readIndex() {
  try {
    return JSON.parse(readFileSync(INDEX, 'utf8'));
  } catch (e) {
    if (e.code === 'ENOENT') return null;
    throw new Error(`cannot read ${INDEX}: ${e.message}; ${FETCH_HINT.replace('fetch"', 'fetch --force"')}`);
  }
}

function loadIndex() {
  const index = readIndex();
  if (!index) throw new Error(`AWS icons are not in ${AWS_DIR}; ${FETCH_HINT}`);
  return index;
}

async function download(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`GET ${url} failed with ${res.status}; check the network, or download it in a browser and pass the path`);
  return res;
}

/**
 * Icon package の zip（source は URL かパス、省略時は公式ページから探す）から必要なアイコンを取り出し、AWS_DIR を置き換える。
 * 同じ版が既にあれば、force でない限り何もしない。結果を 1 行で返す
 */
export async function fetchIcons(source, { force = false } = {}) {
  let from = source;
  if (!from) {
    from = findPackageUrl(await (await download(PAGE)).text());
    if (!from) throw new Error(`no Icon package link on ${PAGE}; download the zip there and run: artifacts.sh icons-aws fetch <path-or-url>`);
  }
  const current = readIndex();
  const known = from.match(/Icon-package_(\d{8})/)?.[1];
  if (!force && known && current?.version === known) return `AWS icons ${known} are already in ${AWS_DIR} (add --force to fetch them again)`;
  const buf = /^https?:\/\//.test(from) ? Buffer.from(await (await download(from)).arrayBuffer()) : readFileSync(from);

  const tmp = `${AWS_DIR}.tmp-${process.pid}`;
  rmSync(tmp, { recursive: true, force: true });
  try {
    const icons = {};
    let version;
    for (const entry of zipEntries(buf, from)) {
      const icon = iconOf(entry.name);
      if (!icon) continue;
      // 同じサービスが 2 つのカテゴリにあるとき（背景の色だけが違う）は、先に見つかった方を使う
      if (icons[icon.name]?.[icon.dark ? 'dark' : 'light']) continue;
      version ??= icon.version;
      const file = join(tmp, `${icon.name}${icon.dark ? '.dark' : ''}.svg`);
      mkdirSync(dirname(file), { recursive: true });
      writeFileSync(file, entry.read());
      icons[icon.name] ??= { category: icon.category };
      icons[icon.name][icon.dark ? 'dark' : 'light'] = true;
    }
    if (!version) throw new Error(`no AWS icons in ${from}; pass the Icon package zip from ${PAGE}`);
    if (!force && current?.version === version) return `AWS icons ${version} are already in ${AWS_DIR} (add --force to fetch them again)`;
    // ダーク用しか無いものは、それを通常の版として使う
    for (const [name, icon] of Object.entries(icons)) {
      if (!icon.light) {
        renameSync(join(tmp, `${name}.dark.svg`), join(tmp, `${name}.svg`));
        icon.dark = false;
      }
      delete icon.light;
    }
    writeFileSync(join(tmp, 'index.json'), `${JSON.stringify({ version, source: from, icons }, null, 1)}\n`);
    // 置き換えは丸ごと。途中で失敗しても前の版が残る
    const old = `${AWS_DIR}.old-${process.pid}`;
    const hadOld = existsSync(AWS_DIR);
    if (hadOld) renameSync(AWS_DIR, old);
    try {
      renameSync(tmp, AWS_DIR);
    } catch (e) {
      // 新しい版を置けなかったら、退避した前の版を戻してから失敗を伝える
      if (hadOld) renameSync(old, AWS_DIR);
      throw e;
    }
    rmSync(old, { recursive: true, force: true });
    return `fetched ${Object.keys(icons).length} AWS icons (${version}) into ${AWS_DIR}`;
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}

// 名前にすべての語を含むアイコンを「aws/名前<TAB>カテゴリ」で返す
export function searchIcons(words) {
  const { icons } = loadIndex();
  const terms = words.map((w) => w.toLowerCase());
  const hits = Object.keys(icons).filter((n) => terms.every((t) => n.includes(t))).sort();
  if (!hits.length) throw new Error(`no AWS icon name contains ${terms.map((t) => `"${t}"`).join(' and ')}; try a shorter word`);
  return hits.map((n) => `aws/${n}\t${icons[n].category}`);
}

/**
 * 名前（aws/ を除いたもの）のアイコンを data URI で返す（{ light, dark? }）。無い名前は { candidates } で近い名前（aws/ 付き）を返す。
 * アイコン置き場が無ければ取得の手順を書いて投げる
 */
export function lookupIcon(name) {
  const { icons } = loadIndex();
  const icon = icons[name];
  if (!icon) {
    const words = name.split(/[/-]/).filter((w) => w.length > 1 && !['aws', 'amazon', 'res', 'group'].includes(w));
    const candidates = Object.keys(icons)
      .map((n) => [n, words.filter((w) => n.includes(w)).length])
      .filter(([, score]) => score > 0)
      .sort((a, b) => b[1] - a[1] || a[0].length - b[0].length)
      .slice(0, 5)
      .map(([n]) => `aws/${n}`);
    return { candidates };
  }
  const uri = (file) => `data:image/svg+xml;base64,${readFileSync(join(AWS_DIR, file)).toString('base64')}`;
  return { light: uri(`${name}.svg`), dark: icon.dark ? uri(`${name}.dark.svg`) : undefined };
}
