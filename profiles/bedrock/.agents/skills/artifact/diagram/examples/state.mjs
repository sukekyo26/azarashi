// 状態遷移図の例: サーバーの起動と停止。状態を横一列に並べ、行き来する遷移は上下 2 本の平行線に分ける。
// 実行: node state.mjs page.html
import { writeFileSync } from 'node:fs';

const { css, diagram } = await import(`${process.env.HOME}/.agents/skills/artifact/diagram/diagram.mjs`);

// 格子: 状態の中心 y = 120、箱 200×64、間隔 200（ラベル 1 つ分より広く取る）。平行線は中心から ±12
const d = diagram({ id: 'state', width: 1080, height: 252, title: 'サーバーの状態' });
for (const [x, name, sub, tone] of [
  [60, '停止中', 'プロセスなし', ''],
  [460, '待機中', '接続なし・30 分タイマー', 'accent'],
  [860, '応答中', '接続あり・タイマー停止', 'accent'],
]) {
  d.box(x, 88, 200, 64, [name, sub], { tone, shape: 'state' });
}

d.dot(22, 120)
  .edge('M29,120 H60')
  // 自分へ戻る遷移は箱の上に張り出す
  .edge('M110,88 V58 H210 V88', { label: '起動失敗（ポート使用中）', at: [160, 40] })
  .edge('M260,108 H460', { label: 'publish・serve で起動', at: [360, 90] })
  .edge('M460,132 H260', { label: '30 分経過', at: [360, 150] })
  .edge('M660,108 H860', { label: 'リクエスト・SSE 接続', at: [760, 90] })
  .edge('M860,132 H660', { label: '最後の接続が閉じる', at: [760, 150] })
  // 2 つの状態から同じ先へ向かう遷移は、下の 1 本にまとめて矢印を 1 つにする
  .edge('M960,152 V216 H160 V152', { label: 'SIGTERM（stop・古い版を publish が検出）', at: [360, 216] })
  .edge('M560,152 V216', { end: null });

writeFileSync(process.argv[2] ?? 'page.html', `${css}
<section>
  <h2>サーバーの起動と停止</h2>
  ${d.svg()}
</section>
`);
