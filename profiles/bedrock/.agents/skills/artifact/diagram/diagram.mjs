// 座標で図を組み、guide.md の「書き終えたら」の確認を機械で行って inline SVG を返す。使い方は guide.md
import { lookupIcon } from '../app/icons-aws.mjs';

const ids = new Set();
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
// LIMIT: 文字幅は概算（日本語 1 文字 ≈ 文字サイズ、英数字 ≈ 0.6 倍）。フォントを替えて外れるなら実測に替える
const textWidth = (s, size, code) => [...s].reduce((w, c) => w + (c.codePointAt(0) > 0x2e80 ? size : size * (code ? 0.62 : 0.6)), 0);
const SIZE = { main: 13, sub: 12 };
const PAD = 16;
const LINE = 17;
const overlaps = (a, b) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
const inside = (a, b) => a.x >= b.x && a.y >= b.y && a.x + a.w <= b.x + b.w && a.y + a.h <= b.y + b.h;
const TONES = ['', 'accent', 'good', 'warn', 'bad'];

// 線の端の記号。どれも「記号の右端 = 線の端（箱の辺）」で描き、始点では向きが反転する
const MARKERS = {
  arrow: ['0 0 10 10', 10, 10, 9, 5, '<path d="M0,0 L10,5 L0,10 z" class="mk-fill"/>'],
  triangle: ['0 0 14 14', 14, 14, 13, 7, '<path d="M1,1 L13,7 L1,13 z" class="mk-hollow"/>'],
  diamond: ['0 0 18 10', 18, 10, 17, 5, '<path d="M1,5 L9,1 L17,5 L9,9 z" class="mk-fill"/>'],
  odiamond: ['0 0 18 10', 18, 10, 17, 5, '<path d="M1,5 L9,1 L17,5 L9,9 z" class="mk-hollow"/>'],
  one: ['0 0 14 14', 14, 14, 14, 7, '<path d="M6,1 V13 M10,1 V13" class="mk-line"/>'],
  many: ['0 0 14 14', 14, 14, 14, 7, '<path d="M0,7 L14,1 M0,7 L14,7 M0,7 L14,13" class="mk-line"/>'],
  'zero-one': ['0 0 22 14', 22, 14, 22, 7, '<circle cx="6" cy="7" r="4" class="mk-hollow"/><path d="M15,1 V13" class="mk-line"/>'],
  'zero-many': ['0 0 24 14', 24, 14, 24, 7, '<circle cx="5" cy="7" r="4" class="mk-hollow"/><path d="M10,7 L24,1 M10,7 L24,7 M10,7 L24,13" class="mk-line"/>'],
};

// 表形式の箱（ER 図のエンティティ・クラス図のクラス）の寸法。行 i（0 始まり、区切りなし）の中心は y + 41 + 22i
const HEAD = 30;
const ROW = 22;
const SEP = 9;
export const tableHeight = (rows = []) => (rows.length
  ? HEAD + rows.reduce((h, r) => h + (r === '---' ? SEP : ROW), 0) + 6
  : HEAD);

// 角の丸い四角（rect）・両端が丸い札（pill）・判定の六角形（hex）・状態（state）
function shapeOf(shape, { x, y, w, h }) {
  if (shape === 'hex') return `<path d="M${x + 18},${y} H${x + w - 18} L${x + w},${y + h / 2} L${x + w - 18},${y + h} H${x + 18} L${x},${y + h / 2} Z"/>`;
  const r = { rect: 8, pill: h / 2, state: Math.min(26, h / 2) }[shape];
  if (r === undefined) throw new Error(`unknown shape "${shape}": use rect, pill, hex or state`);
  return `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${r}"/>`;
}

// 絶対座標の M・H・V・L だけを受け、折れ線の線分に分ける
function segments(d) {
  const tokens = d.match(/[A-Za-z]|-?(?:\d+\.?\d*|\.\d+)(?:e[-+]?\d+)?/g) ?? [];
  const segs = [];
  let x;
  let y;
  for (let i = 0; i < tokens.length;) {
    const cmd = tokens[i++];
    const num = () => {
      const n = Number(tokens[i++]);
      if (!Number.isFinite(n)) throw new Error(`edge "${d}": expected a number after ${cmd}`);
      return n;
    };
    let nx = x;
    let ny = y;
    if (cmd === 'M' || cmd === 'L') [nx, ny] = [num(), num()];
    else if (cmd === 'H') nx = num();
    else if (cmd === 'V') ny = num();
    else throw new Error(`edge "${d}": use absolute M, H, V and L only (got ${cmd})`);
    if (cmd !== 'M') {
      if (x === undefined) throw new Error(`edge "${d}": start with M`);
      segs.push([x, y, nx, ny]);
    }
    [x, y] = [nx, ny];
  }
  return segs;
}

// 線分が箱の内側（縁から 1px 内）を通るか。端が縁に触れるのは通さない
function crosses([x1, y1, x2, y2], b) {
  const steps = Math.max(1, Math.ceil(Math.hypot(x2 - x1, y2 - y1) / 2));
  for (let k = 0; k <= steps; k++) {
    const px = x1 + ((x2 - x1) * k) / steps;
    const py = y1 + ((y2 - y1) * k) / steps;
    if (px > b.x + 1 && px < b.x + b.w - 1 && py > b.y + 1 && py < b.y + b.h - 1) return true;
  }
  return false;
}

// 2 本の線分が X 字に交わる点。平行（同じ道筋を共有する区間を含む）と、どちらかの端（分岐・合流・角）で触れるのは交差としない
function crossing([x1, y1, x2, y2], [x3, y3, x4, y4]) {
  const den = (x2 - x1) * (y4 - y3) - (y2 - y1) * (x4 - x3);
  if (Math.abs(den) < 1e-9) return null;
  const t = ((x3 - x1) * (y4 - y3) - (y3 - y1) * (x4 - x3)) / den;
  const u = ((x3 - x1) * (y2 - y1) - (y3 - y1) * (x2 - x1)) / den;
  const e = 1e-6;
  return t > e && t < 1 - e && u > e && u < 1 - e ? [Math.round(x1 + t * (x2 - x1)), Math.round(y1 + t * (y2 - y1))] : null;
}

/**
 * 図を 1 枚作る。id はページ内で一意（線の端の記号の id に使う）。
 * 各メソッドは座標を受けて部品を足し、svg() が検査して `<div class="dg-wrap"><svg>…</svg></div>` を返す。
 * 検査に通らなければ、直すべき箇所の一覧を付けて例外を投げる。
 */
export function diagram({ id, width, height, title }) {
  if (!/^[a-z][a-z0-9-]*$/.test(id ?? '')) throw new Error(`diagram id "${id}": use lowercase letters, digits and hyphens`);
  if (ids.has(id)) throw new Error(`diagram id "${id}" is used twice on the page; give each diagram its own id`);
  ids.add(id);
  if (!title) throw new Error(`diagram "${id}": give a title (read aloud by screen readers)`);
  const out = { areas: [], edges: [], boxes: [], labels: [] };
  const boxes = []; // 線が通ってはいけないもの
  const marks = []; // 重なってはいけないが、線は中心まで来てよいもの（丸）
  const frames = [];
  const areas = []; // 重なってよいもの（ベン図の円）
  const labels = [];
  const heads = []; // 枠の見出し。線が横切ってはいけない
  const paths = [];
  const used = new Set();
  const problems = [];
  const tone = (t, what) => {
    if (!TONES.includes(t)) throw new Error(`${what}: unknown tone "${t}"; use ${TONES.filter(Boolean).join(', ')}`);
    return t ? ` ${t}` : '';
  };
  const marker = (kind, where, d) => {
    if (kind === null) return '';
    if (!MARKERS[kind]) throw new Error(`edge "${d}": unknown ${where} "${kind}"; use ${Object.keys(MARKERS).join(', ')} or null`);
    used.add(kind);
    return ` marker-${where}="url(#${id}-${kind})"`;
  };
  // アイコン集を頭に付けた名前（aws/…）の SVG を <image> で置く。インラインの <svg> にしないのは、公式の SVG の id がアイコン同士で衝突するため
  const image = (name, x, y, size, what) => {
    const [set, ...rest] = String(name).split('/');
    const hint = '(search with: artifacts.sh icons-aws search <word>)';
    if (set !== 'aws' || !rest.length) {
      problems.push(`${what}: "${name}" needs the icon set in front, like aws/amazon-ec2 ${hint}`);
      return '';
    }
    const found = lookupIcon(rest.join('/'));
    if (found.candidates) {
      problems.push(`${what}: no AWS icon "${name}"${found.candidates.length ? `; did you mean ${found.candidates.join(', ')}?` : ''} ${hint}`);
      return '';
    }
    const img = (href, cls) => `<image href="${href}" x="${x}" y="${y}" width="${size}" height="${size}"${cls ? ` class="${cls}"` : ''}/>`;
    return found.dark ? img(found.light, 'icon-light') + img(found.dark, 'icon-dark') : img(found.light);
  };
  const fit = (text, size, code, room, what) => {
    const tw = textWidth(text, size, code);
    if (tw > room) problems.push(`${what}: "${text}" needs about ${Math.ceil(tw - room)}px more width`);
  };
  const api = {
    // 入れ子の枠。見出しは左上の内側に置くので、中身は見出しの下（上端から 32 以上、icon 付きは 40 以上）から並べる。
    // icon を渡すと AWS のグループ枠の作法で描く: 角を丸めず、角に 32px のアイコンを置いて見出しをその右へずらす。
    // square はアイコン無しで角だけ丸めない（AWS 構成図の中のほかの枠）
    frame(x, y, w, h, label, { accent = false, icon, square = false } = {}) {
      const what = `frame "${label}"`;
      frames.push({ x, y, w, h, what });
      if (label) {
        const [hx, hy, size] = icon === undefined ? [x + 12, y + 18, 12] : [x + 40, y + 15, SIZE.main];
        heads.push({ x: hx, y: hy - 9, w: textWidth(label, size, false), h: 18, what: `the heading of ${what}` });
      }
      // 枠の線（幅 1.2）は座標を中心に描かれるので、アイコンを 1 ずらして線の外側の半分（0.6）まで覆う
      const corner = icon === undefined ? '' : image(icon, x - 1, y - 1, 32, what);
      out.areas.push(`<g class="frame${accent ? ' accent' : ''}${corner ? ' grouped' : ''}"><rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${icon === undefined && !square ? 10 : 0}"/>`
        + `${corner}<text x="${x + (icon === undefined ? 12 : 40)}" y="${y + (icon === undefined ? 18 : 15)}" text-anchor="start">${esc(label)}</text></g>`);
      return api;
    },
    // AWS などのアイコン（左上を x, y に置く）。label はアイコンの下に置く。線はアイコンの辺で止める
    icon(x, y, name, { label, size = 48 } = {}) {
      const what = `icon "${name}"`;
      boxes.push({ x, y, w: size, h: size, what });
      out.boxes.push(image(name, x, y, size, what));
      if (label !== undefined) api.label(label, x + size / 2, y + size + 16);
      return api;
    },
    // rows: 文字列（1 行目は太字、2 行目以降は補足）か [文字列, 'main' | 'sub' | 'main code' | 'sub code']
    box(x, y, w, h, rows, { tone: t = '', shape = 'rect' } = {}) {
      const list = (Array.isArray(rows) ? rows : [rows]).map((row, i) => (Array.isArray(row) ? row : [row, i ? 'sub' : 'main']));
      const what = `box "${list[0][0]}"`;
      const room = (shape === 'hex' ? w - 36 : w) - PAD * 2;
      for (const [text, style] of list) fit(text, SIZE[style.split(' ')[0]] ?? SIZE.main, style.includes('code'), room, what);
      if (list.length * LINE + 12 > h) problems.push(`${what}: ${list.length} lines need a height of ${list.length * LINE + 12}px or more, the box has ${h}px`);
      boxes.push({ x, y, w, h, what });
      const text = list.map(([s, style], i) => `<text x="${x + w / 2}" y="${y + h / 2 + (i - (list.length - 1) / 2) * LINE}" text-anchor="middle" class="${style}">${esc(s)}</text>`).join('');
      out.boxes.push(`<g class="box${tone(t, what)}">${shapeOf(shape, { x, y, w, h })}${text}</g>`);
      return api;
    },
    // 見出しと行の表（ER 図のエンティティ・クラス図のクラス）。rows は [名前, 型や補足] か名前の文字列、'---' は区切り線。
    // 高さは tableHeight(rows) で決まる
    table(x, y, w, title, rows = [], { tone: t = '' } = {}) {
      const h = tableHeight(rows);
      const what = `table "${title}"`;
      fit(title, SIZE.main, false, w - PAD * 2, what);
      boxes.push({ x, y, w, h, what });
      let body = '';
      let top = y + HEAD;
      for (const row of rows) {
        if (row === '---') {
          body += `<line x1="${x}" y1="${top + SEP / 2}" x2="${x + w}" y2="${top + SEP / 2}" class="sep"/>`;
          top += SEP;
          continue;
        }
        const [name, type = ''] = Array.isArray(row) ? row : [row];
        fit(`${name}  ${type}`, SIZE.sub, true, w - 24, what);
        body += `<text x="${x + 12}" y="${top + ROW / 2}" text-anchor="start" class="cell code">${esc(name)}</text>`
          + (type ? `<text x="${x + w - 12}" y="${top + ROW / 2}" text-anchor="end" class="type">${esc(type)}</text>` : '');
        top += ROW;
      }
      const r = 8;
      const head = `<path d="M${x},${y + HEAD} V${y + r} Q${x},${y} ${x + r},${y} H${x + w - r} Q${x + w},${y} ${x + w},${y + r} V${y + HEAD} Z" class="head"/>`;
      out.boxes.push(`<g class="table${tone(t, what)}"><rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${r}" class="bg"/>${head}`
        + (rows.length ? `<line x1="${x}" y1="${y + HEAD}" x2="${x + w}" y2="${y + HEAD}" class="sep"/>` : '')
        + `<text x="${x + w / 2}" y="${y + HEAD / 2}" text-anchor="middle" class="main">${esc(title)}</text>${body}`
        + `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${r}" class="outline"/></g>`);
      return api;
    },
    // 直角の折れ線。箱の辺から辺へ引く。start・end は線の端の記号（MARKERS の名前か null）。label は at の位置に置く。
    // crossing は、避けられない交差をこの線にだけ許す
    edge(d, {
      label, at, dashed = false, bold = false, tone: t = '', start = null, end = 'arrow', crossing: crossOk = false,
    } = {}) {
      const path = { d, segs: segments(d), crossOk };
      paths.push(path);
      const cls = `edge${dashed ? ' dashed' : ''}${bold ? ' bold' : ''}${tone(t, `edge "${d}"`)}`;
      out.edges.push(`<path d="${d}" class="${cls}"${marker(start, 'start', d)}${marker(end, 'end', d)}/>`);
      if (label !== undefined) {
        if (!at) throw new Error(`diagram "${id}": edge "${d}" has a label but no at: [x, y]`);
        api.label(label, ...at);
        path.own = labels.at(-1);
      }
      return api;
    },
    // 丸（Git のコミット・タイムラインの節目・状態遷移の開始点）。線は中心まで引いてよい
    dot(cx, cy, { tone: t = '', hollow = false, r = 7 } = {}) {
      const what = `dot at ${cx},${cy}`;
      marks.push({ x: cx - r, y: cy - r, w: r * 2, h: r * 2, what });
      out.boxes.push(`<circle cx="${cx}" cy="${cy}" r="${r}" class="dot${tone(t, what)}${hollow ? ' hollow' : ''}"/>`);
      return api;
    },
    // 期間の横棒（タイムライン）。label は棒の右に置く
    bar(x1, x2, y, { tone: t = '', label } = {}) {
      const what = `bar "${label ?? `${x1}-${x2}`}"`;
      const w = Math.max(x2 - x1, 4);
      boxes.push({ x: x1, y: y - 7, w, h: 14, what });
      out.boxes.push(`<rect x="${x1}" y="${y - 7}" width="${w}" height="14" rx="3" class="bar${tone(t, what)}"/>`);
      if (label !== undefined) api.label(label, x1 + w + 10, y, 'start');
      return api;
    },
    // 時間軸。ticks は [x, 目盛りの文字] の配列。grid に上端の y を渡すと、目盛りから縦の補助線を引く
    axis(x1, x2, y, ticks, { grid } = {}) {
      out.edges.push(`<line x1="${x1}" y1="${y}" x2="${x2}" y2="${y}" class="axis"/>`);
      for (const [x, text] of ticks) {
        if (grid !== undefined) out.edges.unshift(`<line x1="${x}" y1="${grid}" x2="${x}" y2="${y}" class="grid"/>`);
        out.edges.push(`<line x1="${x}" y1="${y}" x2="${x}" y2="${y + 5}" class="axis"/>`);
        api.label(text, x, y + 17, 'middle', { plain: true });
      }
      return api;
    },
    // 半透明の円（ベン図）。重なってよいので、検査は図からのはみ出しだけ
    circle(cx, cy, r, { tone: t = 'accent' } = {}) {
      const what = `circle at ${cx},${cy}`;
      areas.push({ x: cx - r, y: cy - r, w: r * 2, h: r * 2, what });
      out.areas.push(`<circle cx="${cx}" cy="${cy}" r="${r}" class="venn${tone(t, what)}"/>`);
      return api;
    },
    // 文字。anchor は 'middle' | 'start' | 'end'。plain は背景を敷かない（色の付いた面の上）、strong は太字
    label(text, x, y, anchor = 'middle', { plain = false, strong = false } = {}) {
      const w = textWidth(text, strong ? SIZE.main : SIZE.sub, false) + 10;
      const x0 = { middle: x - w / 2, start: x - 5, end: x - w + 5 }[anchor];
      labels.push({ x: x0, y: y - 9, w, h: 18, what: `label "${text}"` });
      out.labels.push(`${plain ? '' : `<rect x="${x0}" y="${y - 9}" width="${w}" height="18" class="label-bg"/>`}`
        + `<text x="${x}" y="${y}" text-anchor="${anchor}" class="label${strong ? ' strong' : ''}">${esc(text)}</text>`);
      return api;
    },
    // 矢印でない線。kind は 'lifeline'（シーケンス図の縦線）| 'divider'（区切り）| 'line'
    line(x1, y1, x2, y2, kind = 'line') {
      out.edges.push(`<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" class="${kind}"/>`);
      return api;
    },
    // 部品に無いものを SVG のまま足す（検査の対象外）。class="band"（シーケンス図の処理中の帯）が使える
    raw(svg) {
      out.edges.push(svg);
      return api;
    },
    svg() {
      const canvas = { x: 0, y: 0, w: width, h: height };
      for (const s of [...boxes, ...marks, ...labels, ...frames, ...areas]) if (!inside(s, canvas)) problems.push(`${s.what} sticks out of the ${width}x${height} canvas`);
      const solids = [...boxes, ...marks, ...labels];
      solids.forEach((a, i) => solids.slice(i + 1).forEach((b) => overlaps(a, b) && problems.push(`${a.what} overlaps ${b.what}`)));
      for (const b of [...boxes, ...marks]) for (const f of frames) if (overlaps(b, f) && !inside(b, f)) problems.push(`${b.what} straddles the edge of ${f.what}`);
      for (const p of paths) for (const b of boxes) if (p.segs.some((s) => crosses(s, b))) problems.push(`edge "${p.d}" runs through ${b.what}`);
      // 線がほかの線のラベル・アイコンの名前・枠の見出しを横切ると、ラベルの背景で線が途切れて見える
      for (const p of paths) {
        for (const r of [...labels, ...heads]) if (r !== p.own && p.segs.some((s) => crosses(s, r))) problems.push(`edge "${p.d}" runs through ${r.what}`);
      }
      paths.forEach((a, i) => paths.slice(i + 1).forEach((b) => {
        if (a.crossOk || b.crossOk) return;
        const at = a.segs.flatMap((s) => b.segs.map((q) => crossing(s, q))).find(Boolean);
        if (at) problems.push(`edge "${a.d}" crosses edge "${b.d}" at ${at}; move one of them, or add crossing: true to one if it cannot be avoided`);
      }));
      if (problems.length) throw new Error(`diagram "${id}" needs fixing:\n- ${[...new Set(problems)].join('\n- ')}`);
      const defs = [...used].map((k) => {
        const [vb, w, h, rx, ry, body] = MARKERS[k];
        return `<marker id="${id}-${k}" viewBox="${vb}" refX="${rx}" refY="${ry}" markerWidth="${w}" markerHeight="${h}" markerUnits="userSpaceOnUse" orient="auto-start-reverse">${body}</marker>`;
      }).join('');
      return `<div class="dg-wrap"><svg viewBox="0 0 ${width} ${height}" width="${width}" height="${height}" class="dg" role="img" aria-label="${esc(title)}">`
        + `<defs>${defs}</defs>${out.areas.join('')}${out.edges.join('')}${out.boxes.join('')}${out.labels.join('')}</svg></div>`;
    },
  };
  return api;
}

// ページに 1 回だけ入れる。色は雛形の CSS 変数で、ダークモードに追従する。
// text-anchor は属性で付ける（CSS で指定すると属性より強く、個別の指定が効かなくなる）
export const css = `<style>
  .dg-wrap { overflow-x: auto; padding-block: 4px; }
  .dg { display: block; font-family: var(--font); }
  .dg text { dominant-baseline: central; }
  .dg .main { fill: var(--fg); font-size: ${SIZE.main}px; font-weight: 700; }
  .dg .sub { fill: var(--muted); font-size: ${SIZE.sub}px; }
  .dg .code { font-family: var(--mono); font-size: 12px; }
  .dg .box rect, .dg .box path { fill: var(--surface); stroke: var(--line); stroke-width: 1.2; }
  .dg .box.accent rect, .dg .box.accent path { fill: var(--accent-soft); stroke: var(--accent); }
  .dg .box.good rect, .dg .box.good path { fill: var(--good-soft); stroke: var(--good); }
  .dg .box.warn rect, .dg .box.warn path { fill: var(--warn-soft); stroke: var(--warn); }
  .dg .box.bad rect, .dg .box.bad path { fill: var(--bad-soft); stroke: var(--bad); }
  .dg .box.bad text { fill: var(--bad); }
  .dg .table .bg, .dg .table .head { fill: var(--surface); }
  .dg .table.accent .head { fill: var(--accent-soft); }
  .dg .table.good .head { fill: var(--good-soft); }
  .dg .table.warn .head { fill: var(--warn-soft); }
  .dg .table.bad .head { fill: var(--bad-soft); }
  .dg .table .outline { fill: none; stroke: var(--line); stroke-width: 1.2; }
  .dg .table.accent .outline { stroke: var(--accent); }
  .dg .table.good .outline { stroke: var(--good); }
  .dg .table.warn .outline { stroke: var(--warn); }
  .dg .table.bad .outline { stroke: var(--bad); }
  .dg .table .sep { stroke: var(--line); }
  .dg .cell { fill: var(--fg); }
  .dg .type { fill: var(--muted); font-size: 12px; }
  /* 枠の点線は補足の文字より少しだけ濃く。color-mix を解釈できない環境では直前の --muted が残る */
  .dg .frame rect { fill: none; stroke: var(--muted); stroke: color-mix(in srgb, var(--muted) 75%, var(--fg)); stroke-width: 1.2; stroke-dasharray: 5 4; }
  .dg .frame.accent rect { stroke: var(--accent); }
  .dg .frame text { fill: var(--muted); font-size: 12px; font-weight: 700; }
  .dg .frame.grouped text { fill: var(--fg); font-size: 13px; }
  .dg .icon-dark { display: none; }
  @media (prefers-color-scheme: dark) { .dg .icon-light { display: none; } .dg .icon-dark { display: inline; } }
  .dg .edge, .dg .line { fill: none; stroke: var(--muted); stroke-width: 1.5; }
  .dg .edge.dashed { stroke-dasharray: 5 4; }
  .dg .edge.bold { stroke-width: 3; }
  .dg .edge.accent { stroke: var(--accent); }
  .dg .edge.good { stroke: var(--good); }
  .dg .edge.warn { stroke: var(--warn); }
  .dg .edge.bad { stroke: var(--bad); }
  /* 線の端の記号は線と同じ色（context-stroke）。解釈できない環境では直前の --muted が残る */
  .dg .mk-fill { fill: var(--muted); fill: context-stroke; }
  .dg .mk-hollow { fill: var(--bg); stroke: var(--muted); stroke: context-stroke; stroke-width: 1.2; }
  .dg .mk-line { fill: none; stroke: var(--muted); stroke: context-stroke; stroke-width: 1.5; }
  .dg .dot { fill: var(--muted); stroke: var(--muted); }
  .dg .dot.accent { fill: var(--accent); stroke: var(--accent); }
  .dg .dot.good { fill: var(--good); stroke: var(--good); }
  .dg .dot.warn { fill: var(--warn); stroke: var(--warn); }
  .dg .dot.bad { fill: var(--bad); stroke: var(--bad); }
  .dg .dot.hollow { fill: var(--bg); stroke-width: 2; }
  .dg .bar { fill: var(--muted); }
  .dg .bar.accent { fill: var(--accent); }
  .dg .bar.good { fill: var(--good); }
  .dg .bar.warn { fill: var(--warn); }
  .dg .bar.bad { fill: var(--bad); }
  .dg .axis { stroke: var(--muted); stroke-width: 1.2; }
  .dg .grid { stroke: var(--line); }
  .dg .venn { fill: var(--accent-soft); fill-opacity: 0.6; stroke: var(--accent); stroke-width: 1.5; }
  .dg .venn.good { fill: var(--good-soft); stroke: var(--good); }
  .dg .venn.warn { fill: var(--warn-soft); stroke: var(--warn); }
  .dg .venn.bad { fill: var(--bad-soft); stroke: var(--bad); }
  .dg .label-bg { fill: var(--bg); }
  .dg .label { fill: var(--fg); font-size: ${SIZE.sub}px; }
  .dg .label.strong { font-size: ${SIZE.main}px; font-weight: 700; }
  .dg .lifeline { stroke: var(--muted); stroke-width: 1.2; stroke-dasharray: 6 4; }
  .dg .divider { stroke: var(--muted); stroke-width: 1.2; stroke-dasharray: 12 6; }
  .dg .band { fill: var(--accent-soft); stroke: var(--accent); }
</style>`;
