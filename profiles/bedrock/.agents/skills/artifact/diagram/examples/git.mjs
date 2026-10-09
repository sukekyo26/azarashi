// Git のブランチ図の例: artifact スキルの統合ブランチ 2 回目。横がコミットの順、ブランチごとに 1 行のレーンを持つ。
// 実行: node git.mjs page.html
import { writeFileSync } from 'node:fs';

const { assets, diagram } = await import(`${process.env.HOME}/.agents/skills/artifact/diagram/diagram.mjs`);

// 格子: レーンの y、コミットは x = 200 から 70 刻み。分岐と合流は斜めの線 1 本
const lane = { develop: 50, artifact: 110, flakes: 170, svg: 230, layout: 290, examples: 350 };
const d = diagram({ id: 'git', width: 1180, height: 380, title: 'artifact スキルのブランチ' });
// 名札は分岐点の左に置く。幅は名前（13px の等幅で 1 文字 ≈ 8.1px）に合わせる
const tag = (name, right, y, tone) => d.box(right - (name.length * 8.1 + 40), y - 15, name.length * 8.1 + 40, 30, [[name, 'main code']], { tone, shape: 'pill' });
tag('develop', 112, lane.develop, 'accent');
tag('feature/artifact', 176, lane.artifact, 'good');
tag('test/artifact-ui-flakes', 328, lane.flakes);
tag('feature/artifact-svg-diagrams', 328, lane.svg);
tag('refactor/artifact-layout', 678, lane.layout);
tag('feature/artifact-diagram-examples', 818, lane.examples);

// 線を先に引き、丸を上に重ねる（丸は線の中心まで来てよい）
d.edge('M112,50 H1150', { bold: true, tone: 'accent', end: null })
  .edge('M270,50 L340,110 H1110', { bold: true, tone: 'good', end: null })
  .edge('M340,110 L410,170 H480 L620,110', { end: null })
  .edge('M340,110 L410,230 H550 L690,110', { end: null })
  .edge('M690,110 L760,290 L830,110', { end: null })
  .edge('M830,110 L900,350 H1040', { end: null })
  .edge('M1040,350 L1110,110', { dashed: true, end: null });
d.dot(200, 50, { tone: 'accent' }).dot(270, 50, { tone: 'accent' });
for (const x of [620, 690, 830]) d.dot(x, 110, { tone: 'good' });
d.dot(1110, 110, { tone: 'good', hollow: true });
d.dot(480, 170).dot(410, 230).dot(550, 230).dot(760, 290).dot(900, 350).dot(970, 350).dot(1040, 350);
d.label('#109', 200, 30).label('#75', 270, 30)
  .label('#111', 620, 90).label('#110', 690, 90).label('#112', 830, 90).label('#113 レビュー中', 1110, 90);

writeFileSync(process.argv[2] ?? 'page.html', `${assets}
<section>
  <h2>artifact スキルのブランチ</h2>
  ${d.svg()}
  <p class="muted">統合ブランチ <code>feature/artifact</code> を develop から切り直し、作業ブランチを squash で取り込む。#109 は 1 回目の統合で develop に入ったもの、白抜きの丸はレビュー中の PR。</p>
</section>
`);
