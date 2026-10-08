// 座標で図を組み、diagram.md の「書き終えたら」の確認を機械で行って inline SVG を返す。使い方は diagram.md
const ids = new Set();
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
// LIMIT: 文字幅は概算（日本語 1 文字 ≈ 文字サイズ、英数字 ≈ 0.6 倍）。フォントを替えて外れるなら実測に替える
const textWidth = (s, size, code) => [...s].reduce((w, c) => w + (c.codePointAt(0) > 0x2e80 ? size : size * (code ? 0.62 : 0.6)), 0);
const SIZE = { main: 13, sub: 12 };
const PAD = 16;
const LINE = 17;
const overlaps = (a, b) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
const inside = (a, b) => a.x >= b.x && a.y >= b.y && a.x + a.w <= b.x + b.w && a.y + a.h <= b.y + b.h;

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

/**
 * 図を 1 枚作る。id はページ内で一意（矢印の marker の id に使う）。
 * 各メソッドは座標を受けて部品を足し、svg() が検査して `<div class="dg-wrap"><svg>…</svg></div>` を返す。
 * 検査に通らなければ、直すべき箇所の一覧を付けて例外を投げる。
 */
export function diagram({ id, width, height, title }) {
  if (!/^[a-z][a-z0-9-]*$/.test(id ?? '')) throw new Error(`diagram id "${id}": use lowercase letters, digits and hyphens`);
  if (ids.has(id)) throw new Error(`diagram id "${id}" is used twice on the page; give each diagram its own id`);
  ids.add(id);
  if (!title) throw new Error(`diagram "${id}": give a title (read aloud by screen readers)`);
  const out = { frames: [], edges: [], boxes: [], labels: [] };
  const boxes = [];
  const frames = [];
  const labels = [];
  const paths = [];
  const problems = [];
  const api = {
    // 入れ子の枠。見出しは左上の内側に置くので、中身は見出しの下（上端から 32 以上）から並べる
    frame(x, y, w, h, label, { accent = false } = {}) {
      frames.push({ x, y, w, h, what: `frame "${label}"` });
      out.frames.push(`<g class="frame${accent ? ' accent' : ''}"><rect x="${x}" y="${y}" width="${w}" height="${h}" rx="10"/>`
        + `<text x="${x + 12}" y="${y + 18}" text-anchor="start">${esc(label)}</text></g>`);
      return api;
    },
    // rows: 文字列（1 行目は太字、2 行目以降は補足）か [文字列, 'main' | 'sub' | 'main code' | 'sub code']
    box(x, y, w, h, rows, { tone = '', shape = 'rect' } = {}) {
      const r = { x, y, w, h };
      const list = (Array.isArray(rows) ? rows : [rows]).map((row, i) => (Array.isArray(row) ? row : [row, i ? 'sub' : 'main']));
      const what = `box "${list[0][0]}"`;
      const room = shape === 'hex' ? w - 36 : w;
      for (const [text, style] of list) {
        const tw = textWidth(text, SIZE[style.split(' ')[0]] ?? SIZE.main, style.includes('code'));
        if (tw + PAD * 2 > room) problems.push(`${what}: "${text}" needs about ${Math.ceil(tw + PAD * 2 + w - room)}px of width, the box has ${w}px`);
      }
      if (list.length * LINE + 12 > h) problems.push(`${what}: ${list.length} lines need a height of ${list.length * LINE + 12}px or more, the box has ${h}px`);
      boxes.push({ ...r, what });
      const text = list.map(([t, style], i) => `<text x="${x + w / 2}" y="${y + h / 2 + (i - (list.length - 1) / 2) * LINE}" text-anchor="middle" class="${style}">${esc(t)}</text>`).join('');
      out.boxes.push(`<g class="box${tone ? ` ${tone}` : ''}">${shapeOf(shape, r)}${text}</g>`);
      return api;
    },
    // 直角の折れ線。箱の辺から辺へ引く。label は at の位置に背景付きで置く
    edge(d, { label, at, dashed = false, both = false, arrow = true } = {}) {
      paths.push({ d, segs: segments(d) });
      const m = `url(#${id}-arrow)`;
      out.edges.push(`<path d="${d}" class="edge${dashed ? ' dashed' : ''}"${both ? ` marker-start="${m}"` : ''}${arrow ? ` marker-end="${m}"` : ''}/>`);
      if (label !== undefined) {
        if (!at) throw new Error(`diagram "${id}": edge "${d}" has a label but no at: [x, y]`);
        api.label(label, ...at);
      }
      return api;
    },
    // 背景付きの文字。anchor は 'middle' | 'start' | 'end'
    label(text, x, y, anchor = 'middle') {
      const w = textWidth(text, SIZE.sub, false) + 10;
      const x0 = { middle: x - w / 2, start: x - 5, end: x - w + 5 }[anchor];
      labels.push({ x: x0, y: y - 9, w, h: 18, what: `label "${text}"` });
      out.labels.push(`<rect x="${x0}" y="${y - 9}" width="${w}" height="18" class="label-bg"/><text x="${x}" y="${y}" text-anchor="${anchor}" class="label">${esc(text)}</text>`);
      return api;
    },
    // 矢印でない線。kind は 'lifeline'（シーケンス図の縦線）| 'divider'（区切り）| 'line'
    line(x1, y1, x2, y2, kind = 'line') {
      out.edges.push(`<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" class="${kind}"/>`);
      return api;
    },
    // 部品に無いものを SVG のまま足す（検査の対象外）。class="band"（シーケンス図の処理中の帯）・class="dot"（開始点の丸）が使える
    raw(svg) {
      out.edges.push(svg);
      return api;
    },
    svg() {
      const canvas = { x: 0, y: 0, w: width, h: height };
      for (const s of [...boxes, ...labels, ...frames]) if (!inside(s, canvas)) problems.push(`${s.what} sticks out of the ${width}x${height} canvas`);
      const solids = [...boxes, ...labels];
      solids.forEach((a, i) => solids.slice(i + 1).forEach((b) => overlaps(a, b) && problems.push(`${a.what} overlaps ${b.what}`)));
      for (const b of boxes) for (const f of frames) if (overlaps(b, f) && !inside(b, f)) problems.push(`${b.what} straddles the edge of ${f.what}`);
      for (const p of paths) for (const b of boxes) if (p.segs.some((s) => crosses(s, b))) problems.push(`edge "${p.d}" runs through ${b.what}`);
      if (problems.length) throw new Error(`diagram "${id}" needs fixing:\n- ${[...new Set(problems)].join('\n- ')}`);
      return `<div class="dg-wrap"><svg viewBox="0 0 ${width} ${height}" width="${width}" height="${height}" class="dg" role="img" aria-label="${esc(title)}">`
        + `<defs><marker id="${id}-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0,0 L10,5 L0,10 z" class="arrow"/></marker></defs>`
        + out.frames.join('') + out.edges.join('') + out.boxes.join('') + out.labels.join('') + '</svg></div>';
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
  .dg .frame rect { fill: none; stroke: var(--muted); stroke-dasharray: 5 4; }
  .dg .frame.accent rect { stroke: var(--accent); }
  .dg .frame text { fill: var(--muted); font-size: 12px; font-weight: 700; }
  .dg .edge, .dg .line { fill: none; stroke: var(--muted); stroke-width: 1.5; }
  .dg .edge.dashed { stroke-dasharray: 5 4; }
  .dg .arrow { fill: var(--muted); }
  .dg .label-bg { fill: var(--bg); }
  .dg .label { fill: var(--fg); font-size: ${SIZE.sub}px; }
  .dg .lifeline { stroke: var(--line); stroke-width: 1.5; stroke-dasharray: 2 4; }
  .dg .divider { stroke: var(--line); stroke-dasharray: 8 6; }
  .dg .band { fill: var(--accent-soft); stroke: var(--accent); }
  .dg .dot { fill: var(--muted); }
</style>`;
