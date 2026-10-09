// シーケンス図の例: publish から自動再読み込みまで。参加者を等間隔の列に並べ、時間を上から下へ流す。
// 実行: node sequence.mjs page.html
import { writeFileSync } from 'node:fs';

const { assets, diagram } = await import(`${process.env.HOME}/.agents/skills/artifact/diagram/diagram.mjs`);

// 格子: 参加者の列は 260 間隔、メッセージは 40 刻み。ラベルは線の 14 上に置く
const X = { cli: 130, store: 390, srv: 650, br: 910 };
const d = diagram({ id: 'seq', width: 1040, height: 700, title: 'publish から再読み込みまで' });
for (const [k, name, sub, code] of [
  ['cli', 'エージェント', 'artifacts.sh', true],
  ['store', '保存先', '~/.local/share/artifacts', true],
  ['srv', 'サーバー', 'artifacts.mjs serve'],
  ['br', 'ブラウザ', 'ページのタブ'],
]) {
  d.box(X[k] - 115, 12, 230, 52, [name, [sub, code ? 'sub code' : 'sub']], { tone: 'accent' }).line(X[k], 64, X[k], 688, 'lifeline');
}

// サーバーが版を比べ続ける区間の帯（幅 12）。帯に当たるメッセージは帯の縁で止める
const band = { top: 420, bottom: 610 };
d.raw(`<rect x="${X.srv - 6}" y="${band.top}" width="12" height="${band.bottom - band.top}" class="band"/>`);
const msg = (y, from, to, label, dashed = false) => {
  const dir = Math.sign(X[to] - X[from]);
  const onBand = y > band.top && y < band.bottom;
  const x1 = X[from] + (from === 'srv' && onBand ? 6 * dir : 0);
  const x2 = X[to] - (to === 'srv' && onBand ? 6 * dir : 0);
  d.edge(`M${x1},${y} H${x2}`, { dashed, label, at: [(X[from] + X[to]) / 2, y - 14] });
};

msg(104, 'cli', 'srv', 'GET /api/health');
msg(144, 'cli', 'srv', '止まっていれば serve を起動');
msg(184, 'srv', 'cli', 'health が応答するまで待つ', true);
msg(224, 'cli', 'store', 'index.html・meta.json を書く');
msg(264, 'cli', 'br', '新しい slug ならブラウザで開く');
msg(304, 'br', 'srv', 'GET /a/<slug>/?raw');
msg(344, 'srv', 'store', '読む');
msg(384, 'srv', 'br', 'HTML + 再読込スクリプト', true);
msg(424, 'br', 'srv', 'EventSource ?since=版');
d.label('1 秒ごとに版を比べる', X.srv + 14, 470, 'start');
// 場面の切り替わりは区切り線とラベルで示す
d.line(16, 500, 1024, 500, 'divider').label('同じ slug で公開し直す', 520, 500);
msg(544, 'cli', 'store', '書き直す（updatedAt が進む）');
msg(584, 'srv', 'store', 'stat で版の変化を見つける');
msg(624, 'srv', 'br', 'event: reload', true);
// 自分へのメッセージは右へ張り出す小さな折れ線
d.edge(`M${X.br},648 H${X.br + 40} V676 H${X.br}`, { label: 'location.reload()', at: [X.br - 10, 662] });

writeFileSync(process.argv[2] ?? 'page.html', `${assets}
<section>
  <h2>publish から自動再読み込みまで</h2>
  <p class="muted">応答は破線、サーバーが版を比べ続ける区間は帯で示す。</p>
  ${d.svg()}
</section>
`);
