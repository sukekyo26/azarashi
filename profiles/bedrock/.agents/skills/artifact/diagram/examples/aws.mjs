// AWS 構成図の例: bedrock プロファイルの構成。グループの枠は角にアイコンを置き、サービスはアイコンの下に名前を書く。
// アイコンは先に artifacts.sh icons-aws fetch で取得しておく。名前は artifacts.sh icons-aws search <語> で引く。実行: node aws.mjs page.html
import { writeFileSync } from 'node:fs';

const { css, diagram } = await import(`${process.env.HOME}/.agents/skills/artifact/diagram/diagram.mjs`);

// 格子: アイコンは 48px、流れの行の y = 140。アイコン付きの枠の中身は上端から 40 以上下に置く。AWS 構成図の枠は角を丸めない
const d = diagram({ id: 'aws', width: 1000, height: 330, title: 'bedrock プロファイルの構成' });
d.frame(16, 60, 260, 200, '開発マシン', { square: true })
  .frame(316, 16, 668, 300, 'AWS Cloud', { icon: 'aws/group/aws-cloud-logo' })
  .frame(340, 72, 240, 220, 'リージョン（AWS_REGION）', { icon: 'aws/group/region' })
  .frame(620, 72, 344, 220, 'global 推論プロファイル', { square: true });
d.icon(76, 116, 'aws/res/client', { label: 'Claude Code' }).label('bedrock プロファイル', 100, 202)
  .icon(436, 116, 'aws/amazon-bedrock', { label: 'Amazon Bedrock' });
[['Opus 5.5', 'global.anthropic.claude-opus-5-5'], ['Sonnet 5.5', 'global.anthropic.claude-sonnet-5-5'], ['Haiku 5.5', 'global.anthropic.claude-haiku-5-5']]
  .forEach(([name, id], i) => d.box(632, 114 + i * 62, 320, 52, [name, [id, 'sub code']]));
// 線はアイコンの辺から出す。1 か所から分かれる線は、枠の間の縦線で振り分ける
d.edge('M124,140 H436', { label: '推論リクエスト', at: [200, 140] })
  .edge('M484,140 H632')
  .edge('M484,140 H600 V202 H632')
  .edge('M484,140 H600 V264 H632');

writeFileSync(process.argv[2] ?? 'page.html', `${css}
<section>
  <h2>bedrock プロファイルの構成</h2>
  ${d.svg()}
  <p class="muted">Claude Code は Amazon Bedrock の global 推論プロファイルを指定してモデルを呼ぶ。リクエストはリージョンをまたいで処理される。</p>
</section>
`);
