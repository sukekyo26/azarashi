// ベン図の例: このリポジトリが 3 つのエージェントに配る設定。円は半透明で重ね、領域の文字は背景なしで置く。
// 実行: node venn.mjs page.html
import { writeFileSync } from 'node:fs';

const { assets, diagram } = await import(`${process.env.HOME}/.agents/skills/artifact/diagram/diagram.mjs`);

// 半径 170 の円を三角に並べる。文字はどの円の内側・外側かを座標で確かめた位置に置く
const d = diagram({ id: 'venn', width: 760, height: 520, title: 'エージェントごとの設定' });
d.circle(300, 200, 170, { tone: 'accent' })
  .circle(460, 200, 170, { tone: 'good' })
  .circle(380, 335, 170, { tone: 'warn' });
// 円の名前は円の外に置く
d.label('Claude Code', 190, 30, 'middle', { plain: true, strong: true })
  .label('Codex', 580, 40, 'middle', { plain: true, strong: true })
  .label('Copilot', 560, 470, 'middle', { plain: true, strong: true });
const region = (x, y, lines) => lines.forEach((t, i) => d.label(t, x, y + (i - (lines.length - 1) / 2) * 18, 'middle', { plain: true }));
region(380, 250, ['AGENTS.md', 'skills/', '共通の hook']);
region(268, 321, ['statusline.sh', 'settings.json']);
region(210, 141, ['output style', '専用の hook']);
region(550, 141, ['config.toml', 'hooks.json']);

writeFileSync(process.argv[2] ?? 'page.html', `${assets}
<section>
  <h2>エージェントごとの設定</h2>
  ${d.svg()}
  <p class="muted">3 つが共有するのは指示（AGENTS.md）・skills・<code>~/.agents/hooks/</code> の hook。Copilot だけのもの、Claude Code と Codex だけ・Codex と Copilot だけで共有するものは無い。</p>
</section>
`);
