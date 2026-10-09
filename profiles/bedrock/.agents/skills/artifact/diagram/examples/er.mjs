// ER 図の例: artifact の保存先のデータ（meta.json）の関係。主のエンティティを中央に置き、関係の線は水平 1 本で引く。
// 実行: node er.mjs page.html
import { writeFileSync } from 'node:fs';

const { assets, diagram, tableHeight } = await import(`${process.env.HOME}/.agents/skills/artifact/diagram/diagram.mjs`);

// 行 i（0 始まり）の中心は y + 41 + 22i。関係の線を水平にするため、相手の表の高さをその行に合わせる
const rowY = (y, i) => y + 41 + 22 * i;
const d = diagram({ id: 'er', width: 1060, height: 280, title: 'artifact の保存データ' });
const artifact = [['slug', 'PK'], ['title', 'text'], ['description', 'text'], ['project', 'FK（表示用）'], ['publishedFrom', 'FK（持ち主）'],
  ['favorite', 'bool'], ['createdAt', '日時'], ['updatedAt', '日時']];
const page = [['slug', 'PK・FK'], ['index.html', '雛形で包んだ HTML']];
const link = [['slug', 'PK・FK'], ['path', '実体のパス']];
d.table(380, 40, 260, 'アーティファクト', artifact, { tone: 'accent' })
  .table(40, 128, 200, 'プロジェクト', [['name', 'リポジトリ名']])
  .table(780, 40, 240, '保存したページ', page)
  .table(780, 172, 240, 'リンク', link);

// 端の記号は「相手から見た数」: プロジェクト側は 0..1（記録なしがある）、アーティファクト側は 0..多
d.edge(`M240,${rowY(40, 3)} H380`, { start: 'zero-one', end: 'zero-many', label: '表示用', at: [310, rowY(40, 3)] })
  .edge(`M240,${rowY(40, 4)} H380`, { start: 'zero-one', end: 'zero-many', label: '持ち主', at: [310, rowY(40, 4)] })
  .edge(`M640,${40 + tableHeight(page) / 2} H780`, { start: 'one', end: 'zero-one', label: '保存したとき', at: [710, 40 + tableHeight(page) / 2] })
  .edge(`M640,${172 + tableHeight(link) / 2} H780`, { start: 'one', end: 'zero-one', label: '--link のとき', at: [710, 172 + tableHeight(link) / 2] });

writeFileSync(process.argv[2] ?? 'page.html', `${assets}
<section>
  <h2>artifact の保存データ</h2>
  ${d.svg()}
  <p class="muted">保存したページとリンクはどちらか一方で、同じ slug のまま種類は変えられない。プロジェクトは公開した場所のリポジトリ名で、表示用は管理画面で変えられる。</p>
</section>
`);
