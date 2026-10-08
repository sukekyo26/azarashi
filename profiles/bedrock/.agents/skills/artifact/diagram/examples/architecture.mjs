// 構成図の例: artifact スキルの仕組み。入れ子の枠で「どこで動くか」を分け、主な流れの線に番号を振って図の下で説明する。
// 実行: node architecture.mjs page.html
import { writeFileSync } from 'node:fs';

const { css, diagram } = await import(`${process.env.HOME}/.agents/skills/artifact/diagram/diagram.mjs`);

// 格子: 行の中心 y = 92 + 88n（箱の高さ 56、行の間 32）。列は 左端 / 置き場所 / サーバー / ブラウザ
const row = (n) => 92 + (n - 1) * 88;
const d = diagram({ id: 'arch', width: 1248, height: 512, title: 'artifact スキルの構成' });
const box = (x, n, w, rows, tone) => d.box(x, row(n) - 28, w, 56, rows, { tone });

d.frame(272, 108, 256, 300, 'ページの置き場所')
  .frame(624, 20, 280, 476, 'ローカルサーバー 127.0.0.1:4317', { accent: true })
  .frame(968, 20, 264, 476, 'ブラウザ')
  .frame(984, 112, 232, 188, '外枠 /a/<slug>/');
box(24, 1, 200, [['artifacts.sh publish', 'main code'], 'エージェントが実行'], 'accent');
box(288, 2, 224, [['<slug>/index.html', 'main code'], '保存したページ']);
box(288, 3, 224, [['<slug>/meta.json', 'main code'], 'タイトル・説明・リンク先']);
box(288, 4, 224, ['手元の HTML', '--link で登録・毎回読む']);
box(644, 1, 240, [['/api/health', 'main code'], '起動とコードの版を確認']);
box(644, 2, 240, [['/a/<slug>/?raw', 'main code'], 'ページを返す（sandbox CSP）']);
box(644, 3, 240, [['/api/events/<slug>', 'main code'], '変更を通知（SSE）']);
box(644, 4, 240, [['/ , /a/<slug>/', 'main code'], '管理画面と外枠（ui.html）']);
box(644, 5, 240, [['/api/artifacts', 'main code'], '一覧・編集・リンク登録']);
// 2 本の線（③ 返す・④ 購読）を受けるので、2 行にまたがる高さにする
d.box(1000, 152, 200, 132, ['ページ本体', '?raw を読む iframe', 'sandbox・origin null'], { tone: 'accent' });
box(988, 5, 224, ['管理画面', '127.0.0.1 の origin']);

// 同じ行の箱どうしは水平線 1 本で結ぶ。行をまたぐ線は 1 回だけ折る
d.edge(`M224,${row(1)} H644`, { label: '① 起動確認', at: [434, row(1)] })
  .edge(`M124,${row(1) + 28} V${row(2)} H288`, { label: '② 保存', at: [200, row(2)] })
  .edge(`M512,${row(2)} H644`, { label: '③ 読む', at: [578, row(2)] })
  .edge(`M512,${row(3)} H644`, { label: '④ 版を確認', at: [578, row(3)] })
  .edge(`M400,${row(3) + 28} V${row(4) - 28}`, { dashed: true, label: 'path', at: [410, row(3) + 44] })
  .edge(`M884,${row(2)} H1000`, { label: '③ 返す', at: [936, row(2)] })
  .edge(`M1000,${row(3)} H884`, { label: '④ 購読', at: [936, row(3)] })
  // 1 つの箱から 2 か所へ出す線は、出る高さを ±8 ずらして重ねない
  .edge(`M884,${row(4) - 8} H1100 V300`)
  .edge(`M884,${row(4) + 8} H1070 V${row(5) - 28}`)
  .edge(`M988,${row(5)} H884`, { both: true, label: 'API', at: [936, row(5)] });

writeFileSync(process.argv[2] ?? 'page.html', `${css}
<section>
  <h2>artifact の仕組み</h2>
  ${d.svg()}
  <ol>
    <li><code>publish</code> が <code>/api/health</code> でサーバーを確かめる。止まっていれば起動し、コードやランタイムが古ければ起動し直す。</li>
    <li>本文だけの HTML は雛形で包み、<code>index.html</code> と <code>meta.json</code> に書き込む。新しい slug ならブラウザを開く。</li>
    <li>外枠 <code>/a/&lt;slug&gt;/</code> が iframe で <code>?raw</code> を読む。サーバーは sandbox の CSP と再読み込みスクリプトを付けて返す。リンクはリクエストのたびにファイルを読む。</li>
    <li>ページは <code>/api/events</code> を購読する。サーバーは 1 秒ごとに版（公開日時・ファイルの更新日時）を比べ、変われば <code>reload</code> を送る。</li>
  </ol>
</section>
`);
