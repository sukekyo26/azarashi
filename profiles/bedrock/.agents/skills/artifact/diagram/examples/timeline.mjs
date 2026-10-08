// タイムラインの例: artifact スキルの PR がマージされた時期（JST）。横が時間、期間は棒、節目は上の段の丸。
// 実行: node timeline.mjs page.html
import { writeFileSync } from 'node:fs';

const { css, diagram } = await import(`${process.env.HOME}/.agents/skills/artifact/diagram/diagram.mjs`);

// 目盛り: 10/06 0:00 からの時間 h を x = 160 + 9h に置く（1 日 = 216px）。左の 160px は行の名前
const at = (day, hh, mm = 0) => 160 + 9 * ((day - 6) * 24 + hh + mm / 60);
const row = { milestone: 44, direct: 84, first: 124, second: 164 };
const d = diagram({ id: 'timeline', width: 1040, height: 240, title: 'artifact スキルの PR の時期' });

d.axis(160, at(9, 12), 200, [6, 7, 8, 9].map((day) => [at(day, 0), `10/0${day}`]), { grid: 30 });
d.label('develop へ直接', 16, row.direct, 'start')
  .label('統合ブランチ 1 回目', 16, row.first, 'start')
  .label('統合ブランチ 2 回目', 16, row.second, 'start');
// 短い期間も棒の右の文字で中身が分かるようにする
d.bar(at(6, 0, 42), at(7, 6, 18), row.direct, { tone: 'accent', label: '#83〜#101（17 本）' })
  .bar(at(7, 6, 40), at(7, 7, 57), row.first, { tone: 'good', label: '#102〜#108 → #109 で develop へ' })
  .bar(at(8, 23, 57), at(9, 0, 21), row.second, { tone: 'good', label: '#110〜#112（#113 はレビュー中）' });
d.dot(at(6, 0, 42), row.milestone, { tone: 'accent' }).label('スキル追加', at(6, 0, 42), 24)
  .dot(at(7, 7, 57), row.milestone, { tone: 'accent' }).label('develop へ統合', at(7, 7, 57), 24)
  .dot(at(9, 0, 17), row.milestone, { tone: 'accent' }).label('図を SVG に', at(9, 0, 17), 24);

writeFileSync(process.argv[2] ?? 'page.html', `${css}
<section>
  <h2>artifact スキルの PR の時期</h2>
  ${d.svg()}
  <p class="muted">develop への PR が増えすぎたので、10/07 から統合ブランチにまとめて取り込む運用に変えた。</p>
</section>
`);
