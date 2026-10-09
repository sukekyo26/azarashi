// クラス図の例: artifacts.mjs が使う Node の http まわりのクラス。親を上に置き、継承は兄弟で共有する折れ線で親の下辺へ引く。
// 各クラスには artifacts.mjs が使うメンバーだけを、定義しているクラスに書く。実行: node class.mjs page.html
import { writeFileSync } from 'node:fs';

const { assets, diagram } = await import(`${process.env.HOME}/.agents/skills/artifact/diagram/diagram.mjs`);

// 格子: 列の中心 x = 150, 430, 710, 990（表の幅 240）、段の上端 y = 20, 138, 256, 418。段の間 30 の高さで継承線を折る
const col = (c) => [150, 430, 710, 990][c] - 120;
const d = diagram({ id: 'class', width: 1140, height: 580, title: 'Node の http まわりのクラス' });
d.table(col(2), 20, 240, 'EventEmitter', ['on(event, listener)'])
  .table(col(1), 138, 240, 'Stream')
  .table(col(3), 138, 240, 'net.Server', ['listen(port, host)'])
  .table(col(0), 256, 240, 'stream.Readable', [['pipe(dest)', 'res へ流す'], 'destroy()', '[Symbol.asyncIterator]()'])
  .table(col(2), 256, 240, 'http.OutgoingMessage', ['write(chunk)', 'end()', 'destroy()'])
  .table(col(3), 256, 240, 'http.Server', [], { tone: 'accent' })
  .table(col(0), 418, 240, 'fs.ReadStream')
  .table(col(1), 418, 240, 'http.IncomingMessage', [['method', 'string'], ['url', 'string'], ['headers', 'object']], { tone: 'accent' })
  .table(col(2), 418, 240, 'http.ServerResponse', [['req', 'IncomingMessage'], '---', 'writeHead(status, headers)'], { tone: 'accent' });

// 継承（白抜き三角）。子の上辺から上がり、段の間で横へ寄って親の下辺へ入る
const inherit = (d1) => d.edge(d1, { end: 'triangle' });
inherit('M990,138 V108 H710 V78');
inherit('M430,138 V108 H710 V78');
inherit('M150,256 V226 H430 V168');
inherit('M710,256 V226 H430 V168');
inherit('M990,256 V196');
inherit('M150,418 V358');
inherit('M430,418 V388 H150 V358');
inherit('M710,418 V358');
// 関連と生成。生成の破線は全部の下を通して、表を横切らない
d.edge('M590,459 H550', { label: 'req', at: [570, 447] })
  .edge('M990,286 V550 H710 V507', { dashed: true, label: 'リクエストごとに作る', at: [850, 550] })
  .edge('M710,550 H430 V520', { dashed: true });

writeFileSync(process.argv[2] ?? 'page.html', `${assets}
<section>
  <h2>Node の http まわりのクラス</h2>
  ${d.svg()}
  <p class="muted">白抜き三角は継承、破線は生成。<code>createServer</code> が返す <code>http.Server</code> は、リクエストのたびに <code>IncomingMessage</code>（req）と <code>ServerResponse</code>（res）を作る。</p>
</section>
`);
