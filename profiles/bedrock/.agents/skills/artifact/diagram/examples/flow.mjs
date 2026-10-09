// 判定フローの例: publish の検査。本流を縦一列に通し、拒否は右へ出して理由を書き、判定を飛ばす経路は左を迂回させる。
// 実行: node flow.mjs page.html
import { writeFileSync } from 'node:fs';

const { assets, diagram } = await import(`${process.env.HOME}/.agents/skills/artifact/diagram/diagram.mjs`);

// 格子: 本流の中心 x = 300、段の中心 y = 40 + 76n（箱の高さ 52、段の間 24）。拒否の札は x = 540 から
const cy = (n) => 40 + n * 76;
const d = diagram({ id: 'flow', width: 860, height: 916, title: 'publish の検査' });
const step = (n, rows, shape = 'rect') => d.box(130, cy(n) - 26, 340, 52, rows, { shape });

d.box(200, cy(0) - 20, 200, 40, [['publish <file>', 'main code']], { tone: 'accent', shape: 'pill' });
step(1, ['--link で登録するか'], 'hex');
step(2, ['symlink を実体のパスに解決']);
step(3, ['.html / .htm の通常ファイルか'], 'hex');
step(4, ['$HOME 直下の隠しディレクトリの中か'], 'hex');
step(5, ['/ か $HOME の直下にあるか'], 'hex');
step(6, ['slug は英小文字・数字・ハイフンか'], 'hex');
step(7, ['同じ slug が別の種類（ページ／リンク）か'], 'hex');
step(8, ['他プロジェクトのページで --force なしか'], 'hex');
step(9, ['サーバーを確かめ、必要なら起動']);
step(10, ['保存（ページは雛形で包む）', 'リンクは meta.json だけ']);
d.box(200, cy(11) - 20, 200, 40, ['URL を出力'], { tone: 'good', shape: 'pill' });

// 本流の縦線。判定から出る線には、本流へ進む答えを線の右に添える
const answer = { 1: 'はい', 3: 'はい', 4: 'いいえ', 5: 'いいえ', 6: 'はい', 7: 'いいえ', 8: 'いいえ' };
for (let n = 0; n < 11; n++) {
  const top = n === 0 ? cy(0) + 20 : cy(n) + 26;
  const bottom = n === 10 ? cy(11) - 20 : cy(n + 1) - 26;
  d.edge(`M300,${top} V${bottom}`, answer[n] ? { label: answer[n], at: [312, (top + bottom) / 2, 'start'] } : {});
}
d.edge(`M130,${cy(1)} H90 V${cy(6)} H130`, { label: 'いいえ', at: [98, cy(1) - 14] });
for (const [n, label, reason] of [
  [3, 'いいえ', 'HTML ファイルではない'],
  [4, 'はい', '設定や鍵の置き場は公開しない'],
  [5, 'はい', 'ディレクトリ全体が公開されてしまう'],
  [6, 'いいえ', 'URL 名に使えない文字がある'],
  [7, 'はい', '先に rm するか別の slug にする'],
  [8, 'はい', '別の slug にするか --force を付ける'],
]) {
  d.box(540, cy(n) - 18, 300, 36, [[reason, 'sub']], { tone: 'bad', shape: 'pill' })
    .edge(`M470,${cy(n)} H540`, { label, at: [505, cy(n) - 14] });
}

writeFileSync(process.argv[2] ?? 'page.html', `${assets}
<section>
  <h2>publish の検査</h2>
  ${d.svg()}
</section>
`);
