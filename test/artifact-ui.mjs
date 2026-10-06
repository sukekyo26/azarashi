#!/usr/bin/env node
// test/artifact-ui.mjs <chrome> <base-url> <scenario> [artifacts.mjs] — artifact skill の画面を
// ヘッドレス Chrome で操作し、観測結果を | 区切りの 1 行で出す（run.sh が期待値と比べる）。
//   manage: 管理画面。前提はストアに my-demo（Demo Page、新しい方）と untitled の 2 件だけがあること
//   extras: 並び替え・キーボード操作・まとめて削除・説明の編集・パスのコピー（一覧は差し替えるのでストアの中身は問わない）
//   reload: ライブリロードと、ページの外枠。artifacts.mjs で live を公開し直す（ARTIFACTS_DIR / ARTIFACTS_PORT を引き継ぐ）
import { execFileSync, spawn } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const [chrome, base, scenario, art] = process.argv.slice(2);
// Chrome を起動する前に確かめ、引数の取り違えを型エラーではなく使い方で知らせる
if (!chrome || !base || !['manage', 'extras', 'reload'].includes(scenario) || (scenario === 'reload' && !art)) {
  console.error('usage: artifact-ui.mjs <chrome> <base-url> manage | extras | reload <artifacts.mjs>');
  process.exit(2);
}
const profile = mkdtempSync(join(tmpdir(), 'artifact-ui-'));
const proc = spawn(chrome, [
  '--headless=new', '--no-sandbox', '--disable-gpu', '--no-first-run',
  '--remote-debugging-port=0', `--user-data-dir=${profile}`, 'about:blank',
], { stdio: ['ignore', 'ignore', 'pipe'] });
let stderr = '';
proc.stderr.on('data', (d) => {
  stderr = (stderr + d).slice(-2000);
});
const exited = new Promise((r) => proc.once('exit', r));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function until(fn, what, tries = 100) {
  for (let i = 0; i < tries; i++) {
    const v = await fn();
    if (v) return v;
    await sleep(50);
  }
  throw new Error(`timed out waiting for ${what}`);
}

async function manage({ send, evaluate }) {
  const titles = () => evaluate("[...document.querySelectorAll('#list li .title')].map((a) => a.textContent).join(',')");
  const rows = () => evaluate("document.querySelectorAll('#list li').length");
  const filter = (q) => evaluate(`(() => {
    const q = document.getElementById('q');
    q.value = ${JSON.stringify(q)};
    q.dispatchEvent(new Event('input'));
  })()`);
  const clickDelete = (title) => evaluate(`(() => {
    const li = [...document.querySelectorAll('#list li')].find((l) => l.querySelector('.title').textContent === ${JSON.stringify(title)});
    const b = li.querySelector('.delete');
    b.click();
    return b.querySelector('.label').textContent;
  })()`);

  const out = [];
  await send('Page.navigate', { url: `${base}/` });
  out.push(await until(titles, 'the list to render'));
  out.push(await evaluate("(() => { const d = document.querySelector('#list li .download'); const o = document.querySelector('#list li .open'); return `${d.getAttribute('href')} ${d.getAttribute('download')} ${o.getAttribute('href')} ${o.target}`; })()"));
  // a row's project tag filters by it and keeps the choice in the URL; the "全プロジェクト" chip clears it
  out.push(await evaluate(`(() => {
    const tag = document.querySelector('#list li .tag');
    tag.click();
    const pressed = document.querySelector('#chips .chip[aria-pressed="true"]').firstChild.textContent;
    return [document.querySelectorAll('#list li').length, pressed === tag.textContent,
      new URLSearchParams(location.search).get('project') === tag.textContent].join(' ');
  })()`));
  await evaluate("document.querySelector('#chips .chip').click()");
  out.push(await evaluate("location.search === '' && document.querySelector('#chips .chip').getAttribute('aria-pressed')"));
  await filter('untitled');
  out.push(await rows());
  // the search is kept in the URL and restored from it
  out.push(await evaluate("new URLSearchParams(location.search).get('q')"));
  await send('Page.navigate', { url: `${base}/?q=untitled` });
  out.push(await until(() => evaluate("document.getElementById('q').value === 'untitled' && document.querySelectorAll('#list li').length"), 'the search restored from the URL'));
  await filter('');
  out.push(await clickDelete('untitled'));
  out.push(await rows());
  await clickDelete('untitled');
  await until(async () => (await rows()) === 1, 'the deleted row to disappear');
  out.push(await titles());
  out.push(await evaluate("fetch('/api/artifacts').then((r) => r.json()).then((a) => a.map((x) => x.slug).join(','))"));
  // a DELETE that cannot reach the server shows an error and keeps the row
  await evaluate("window.realFetch = window.fetch; window.fetch = () => Promise.reject(new TypeError('Failed to fetch'))");
  await clickDelete('Demo Page');
  await clickDelete('Demo Page');
  out.push(await until(() => evaluate("(() => { const e = document.getElementById('error'); return !e.hidden && e.textContent.includes('削除できませんでした'); })()"), 'the delete error'));
  out.push(await rows());
  const down = () => evaluate("document.getElementById('server').classList.contains('down')");
  out.push(await down());
  await evaluate('window.fetch = window.realFetch');
  // the button stays armed, so one more click deletes, and reaching the server turns the indicator back up
  await clickDelete('Demo Page');
  out.push(await until(() => evaluate("!document.getElementById('empty').hidden"), 'the empty state'));
  out.push(await down());
  // polling notices a lost server and turns the indicator back up once it answers again
  await evaluate("window.fetch = () => Promise.reject(new TypeError('Failed to fetch'))");
  out.push(await until(down, 'the indicator to go down'));
  await evaluate('window.fetch = window.realFetch');
  out.push(await until(async () => !(await down()), 'the indicator to come back up'));
  // the add form opens in a modal from the links tab only, focused on the path, and cancel closes it
  await evaluate("document.querySelector('.tabs [data-tab=links]').click()");
  out.push(await evaluate(`(() => {
    document.getElementById('add-open').click();
    const shown = document.getElementById('add-dialog').open && document.activeElement.id;
    document.getElementById('add-cancel').click();
    return [shown, document.getElementById('add-dialog').open].join(' ');
  })()`));
  await evaluate("document.querySelector('.tabs [data-tab=pages]').click()");
  out.push(await evaluate("document.getElementById('add-open').hidden"));
  // paging over 25 rows (a stubbed list, so that polling keeps returning it): 10 a page by default,
  // then the next page (kept in the URL), then 20 a page (remembered in the browser, back to page 1)
  const pager = () => evaluate("[document.querySelectorAll('#list li').length, document.getElementById('pageno').textContent, document.getElementById('next').disabled].join(' ')");
  await evaluate(`(() => {
    const list = JSON.stringify(Array.from({ length: 25 }, (_, i) => ({ slug: \`p\${i}\`, title: \`P\${i}\`, description: '', updatedAt: '2026-01-01T00:00:00.000Z' })));
    window.fetch = (url, init) => (url === '/api/artifacts' ? Promise.resolve(new Response(list)) : window.realFetch(url, init));
    return load();
  })()`);
  out.push(await pager());
  await evaluate("document.getElementById('next').click()");
  out.push(await pager());
  out.push(await evaluate("new URLSearchParams(location.search).get('page')"));
  await evaluate("[...document.querySelectorAll('#sizes button')].find((b) => b.textContent === '20').click()");
  out.push(`${await pager()} ${await evaluate("localStorage.getItem('artifacts.pageSize')")} ${await evaluate("location.search === ''")}`);
  return out;
}

// 並び替え・キーボード操作・まとめて削除・モーダルでの説明の編集・パスのコピー。
// 一覧と書き込みは差し替えた fetch で受け、送られた要求を calls に記録する
async function extras({ send, evaluate }) {
  await send('Page.navigate', { url: `${base}/` });
  const ready = () => until(() => evaluate("document.readyState === 'complete' && typeof load === 'function'").catch(() => false), 'the page');
  await ready();
  const stub = `(() => {
    window.calls = [];
    const at = (d) => \`2026-01-0\${d}T00:00:00.000Z\`;
    const list = JSON.stringify([
      { slug: 'b', title: 'Beta', description: '', createdAt: at(3), updatedAt: at(9) },
      { slug: 'a', title: 'Alpha', description: 'old', createdAt: at(1), updatedAt: at(8) },
      { slug: 'c', title: 'Gamma', description: '', createdAt: at(5), updatedAt: at(7), favorite: true },
      { slug: 'l', title: 'Linked', description: '', path: '/tmp/x/l.html', createdAt: at(1), updatedAt: at(1) },
      { slug: 'm', title: 'Missing', description: '', path: '/tmp/x/m.html', missing: true, createdAt: at(1), updatedAt: at(1) },
    ]);
    window.fetch = (url, init = {}) => {
      if (!init.method) return Promise.resolve(new Response(list));
      calls.push([init.method, url, init.body].filter(Boolean).join(' '));
      return Promise.resolve(new Response(null, { status: 204 }));
    };
    navigator.clipboard.writeText = (text) => {
      calls.push(\`copy \${text}\`);
      return Promise.resolve();
    };
    return load();
  })()`;
  await evaluate(stub);
  const titles = () => evaluate("[...document.querySelectorAll('#list .title')].map((a) => a.textContent).join(',')");
  const sortBy = (v) => evaluate(`(() => {
    const s = document.getElementById('sort');
    s.value = '${v}';
    s.dispatchEvent(new Event('change'));
  })()`);
  const key = (k) => evaluate(`document.body.dispatchEvent(new KeyboardEvent('keydown', { key: '${k}', bubbles: true }))`);
  const out = [];
  out.push(await titles());
  await sortBy('created');
  out.push(`${await titles()} ${await evaluate("new URLSearchParams(location.search).get('sort')")}`);
  await sortBy('title');
  out.push(await titles());
  // the ★ chip narrows to favourites (kept in the URL); a row's star sends the change
  await evaluate("document.getElementById('fav').click()");
  out.push(`${await titles()} ${await evaluate("new URLSearchParams(location.search).get('fav')")}`);
  await evaluate("document.getElementById('fav').click()");
  await evaluate("document.querySelector('#list li .star').click()");
  out.push(await until(() => evaluate("calls.splice(0).join(',')"), 'the favourite'));
  // the time's tooltip has both the creation and the update
  out.push(await evaluate("document.querySelector('#list li time').title.split('\\n').map((l) => l.split(' ')[0]).join(' ')"));
  // ↓ moves through the rows by focusing their titles, x selects the focused row
  await key('ArrowDown');
  await key('ArrowDown');
  out.push(await evaluate('document.activeElement.textContent'));
  await key('x');
  out.push(await evaluate("document.getElementById('bulk-count').textContent"));
  // with Alpha selected too by a real mouse click (nothing may sit on top of the checkbox),
  // the first click arms and the second deletes both
  const { x, y } = JSON.parse(await evaluate("(() => { const r = document.querySelector('#list li .sel').getBoundingClientRect(); return JSON.stringify({ x: r.x + r.width / 2, y: r.y + r.height / 2 }); })()"));
  for (const type of ['mousePressed', 'mouseReleased']) await send('Input.dispatchMouseEvent', { type, x, y, button: 'left', clickCount: 1 });
  out.push(await until(() => evaluate("document.querySelector('#list li .sel').checked && document.getElementById('bulk-count').textContent"), 'the mouse click to select'));
  await evaluate("document.getElementById('bulk-delete').click()");
  out.push(await evaluate("document.getElementById('bulk-delete').textContent"));
  await evaluate("document.getElementById('bulk-delete').click()");
  await until(() => evaluate("document.getElementById('bulk').hidden"), 'the selection to clear');
  out.push(await evaluate("calls.splice(0).sort().join(',')"));
  // the pencil opens a modal with the current description; saving sends the new one
  await evaluate("document.querySelector('#list li .edit').click()");
  out.push(await evaluate("[document.getElementById('edit-dialog').open, document.getElementById('edit-desc').value].join(' ')"));
  await evaluate("document.getElementById('edit-desc').value = 'new'; document.getElementById('edit').requestSubmit()");
  await until(() => evaluate("!document.getElementById('edit-dialog').open"), 'the edit modal to close');
  out.push(await evaluate("calls.splice(0).join(',')"));
  out.push(await evaluate("document.getElementById('toasts').textContent.includes('保存しました')"));
  // only linked files have a copy button for their path
  out.push(await evaluate("document.querySelector('#list li .copy').hidden"));
  await evaluate("document.querySelector('.tabs [data-tab=links]').click()");
  await evaluate("document.querySelector('#list li .copy').click()");
  out.push(await until(() => evaluate("calls.join(',')"), 'the copy'));
  out.push(await evaluate("document.getElementById('toasts').textContent.includes('パスをコピーしました')"));
  // a link whose file is gone has no href, but ↓ still reaches it
  await evaluate('document.activeElement.blur()');
  await key('ArrowDown');
  await key('ArrowDown');
  out.push(await evaluate('document.activeElement.textContent'));
  // the theme switch overrides the OS setting and is remembered; "OS に合わせる" drops the override
  await evaluate("document.querySelector('[data-theme-choice=dark]').click()");
  out.push(await evaluate("[document.documentElement.dataset.theme, getComputedStyle(document.body).backgroundColor, localStorage.getItem('artifacts.theme')].join(' ')"));
  await evaluate("document.querySelector('[data-theme-choice=system]').click()");
  out.push(await evaluate("String(document.documentElement.dataset.theme)"));
  // a page opened from the list steps to its neighbours in that list's order, and the logo returns to that list
  await evaluate("sessionStorage.setItem('artifacts.list', '?sort=title')");
  await send('Page.navigate', { url: `${base}/a/b/` });
  await ready();
  await evaluate(stub);
  out.push(await until(() => evaluate("document.getElementById('frame-pos').textContent && ['frame-prev', 'frame-next'].map((id) => document.getElementById(id).getAttribute('href')).concat(document.getElementById('frame-pos').textContent, document.querySelector('.brand').getAttribute('href')).join(' ')"), 'the neighbours'));
  return out;
}

// 開いているページが、公開し直しに合わせて（sandbox の中から）読み直されること
async function reload({ send, evaluate }) {
  const dir = mkdtempSync(join(tmpdir(), 'artifact-live-'));
  const publish = (v) => {
    writeFileSync(join(dir, 'live.html'), `<title>Live</title><p id="v">${v}</p>`);
    execFileSync(process.execPath, [art, 'publish', join(dir, 'live.html'), '--slug', 'live'], { stdio: 'ignore' });
  };
  // reload の最中は実行コンテキストが入れ替わるので、評価の失敗は「まだ」とみなす
  const shown = (v) => async () => (await evaluate("document.getElementById('v')?.textContent").catch(() => null)) === v;
  try {
    const out = [];
    publish('1');
    await send('Page.navigate', { url: `${base}/a/live/?raw` });
    out.push(await until(shown('1'), 'the first version') && '1');
    publish('2');
    out.push(await until(shown('2'), 'the page to reload') && '2');
    // the page URL itself is the frame: the tab is named after the page and the iframe loads ?raw
    await send('Page.navigate', { url: `${base}/a/live/` });
    out.push(await until(() => evaluate("document.title.startsWith('Live') && document.title"), 'the frame title'));
    out.push(await evaluate("new URL(document.getElementById('frame').src).search === '?raw'"));
    // the frame lets the page write to the clipboard and go fullscreen. The page reports its own policy to the frame
    // until someone listens, since it may load before the listener is attached
    // permissionsPolicy is the standard name; Chrome still ships it as featurePolicy. Without either, say so instead of a false "denied"
    writeFileSync(join(dir, 'perm.html'), "<title>Perm</title><script>const policy = document.permissionsPolicy ?? document.featurePolicy; setInterval(() => parent.postMessage(policy ? ['clipboard-write', 'fullscreen'].map((f) => policy.allowsFeature(f)).join() : 'no policy API', '*'), 100)</script>");
    execFileSync(process.execPath, [art, 'publish', join(dir, 'perm.html'), '--slug', 'perm'], { stdio: 'ignore' });
    await send('Page.navigate', { url: `${base}/a/perm/` });
    // one listener per document keeps the last report; until() polls it at its usual pace
    out.push(await until(() => evaluate("(window.listening ||= (addEventListener('message', (e) => { window.reported = e.data; }), true)) && window.reported"), 'the page permissions'));
    execFileSync(process.execPath, [art, 'rm', 'perm'], { stdio: 'ignore' });
    out.push(await leave({ send, evaluate, dir }));
    // an unknown page shows the way back instead of the frame
    await send('Page.navigate', { url: `${base}/a/no-such/` });
    out.push(await until(() => evaluate("!document.getElementById('notfound').hidden && document.getElementById('frame').hidden && !document.getElementById('frame').hasAttribute('src')"), 'the not-found state'));
    return out;
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

// ページ内のリンクで別のサイトへ出る。target=_blank のタブは sandbox を引き継がずそのサイトの origin で動き、
// target の無いリンクも外枠の中ではなく新しいタブで開く（多くのサイトは iframe に入れられるのを拒む）。
// 同じサーバー内のリンクは今までどおり外枠の中で開く。別のサイトは、iframe を拒む小さなサーバーで代える。
// 出力は開いたタブごとの origin（無ければ none）
async function leave({ send, evaluate, dir }) {
  const site = createServer((req, res) => {
    res.writeHead(200, { 'content-type': 'text/html', 'x-frame-options': 'DENY' });
    res.end('<title>Elsewhere</title>');
  });
  await new Promise((r) => site.listen(0, '127.0.0.1', r));
  const other = `http://127.0.0.1:${site.address().port}`;
  try {
    // 3 つのリンクを決まった位置に置き、読み込めたら外枠に知らせる
    writeFileSync(join(dir, 'leave.html'), `<title>Leave</title><style>a { position: fixed; left: 0; width: 200px; height: 40px; }</style>`
      + `<a href="${other}/blank" target="_blank" style="top: 0">blank</a><a href="${other}/plain" style="top: 60px">plain</a><a href="inner.html" style="top: 120px">inner</a>`
      + "<script>setInterval(() => parent.postMessage('ready', '*'), 100)</script>");
    execFileSync(process.execPath, [art, 'publish', join(dir, 'leave.html'), '--slug', 'leave'], { stdio: 'ignore' });
    await send('Page.navigate', { url: `${base}/a/leave/` });
    await until(() => evaluate("(window.listening ||= (addEventListener('message', (e) => { window.reported = e.data; }), true)) && window.reported"), 'the page in the frame');
    const box = JSON.parse(await evaluate("JSON.stringify(document.getElementById('frame').getBoundingClientRect())"));
    for (const y of [20, 80, 140]) {
      for (const type of ['mousePressed', 'mouseReleased']) {
        await send('Input.dispatchMouseEvent', { type, x: box.x + 20, y: box.y + y, button: 'left', clickCount: 1 });
      }
    }
    const tab = async (url) => (await send('Target.getTargets')).result.targetInfos.find((t) => t.type === 'page' && t.url === url);
    await until(() => tab(`${other}/blank`), 'the target=_blank tab');
    // 外枠の中で開いたリンクではタブは増えない。増えるなら blank と同じ頃に増える
    await sleep(500);
    const origins = [];
    for (const url of [`${other}/blank`, `${other}/plain`, `${base}/a/leave/inner.html`]) {
      const t = await tab(url);
      if (!t) {
        origins.push('none');
        continue;
      }
      const { sessionId } = (await send('Target.attachToTarget', { targetId: t.targetId, flatten: true })).result;
      const origin = (await send('Runtime.evaluate', { expression: 'self.origin', returnByValue: true }, sessionId)).result.result.value;
      origins.push(origin === other ? 'own' : origin);
      await send('Target.closeTarget', { targetId: t.targetId });
    }
    execFileSync(process.execPath, [art, 'rm', 'leave'], { stdio: 'ignore' });
    return origins.join(' ');
  } finally {
    site.close();
  }
}

let ws;
try {
  // a cold CI runner can take several seconds to start Chrome
  const port = await until(() => {
    if (proc.exitCode !== null) throw new Error(`Chrome exited with code ${proc.exitCode}`);
    try {
      return readFileSync(join(profile, 'DevToolsActivePort'), 'utf8').split('\n')[0];
    } catch {
      return null;
    }
  }, 'Chrome to start', 600);
  const target = await until(async () => {
    try {
      return (await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()).find((t) => t.type === 'page');
    } catch {
      return null;
    }
  }, 'a page target');

  ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => {
    ws.onopen = resolve;
    ws.onerror = () => reject(new Error('cannot connect to Chrome'));
  });
  let nextId = 0;
  const pending = new Map();
  ws.onmessage = (e) => {
    const m = JSON.parse(e.data);
    pending.get(m.id)?.(m);
    pending.delete(m.id);
  };
  // sessionId は Target.attachToTarget（flatten）で付けた別のタブ宛て
  const send = (method, params = {}, sessionId = undefined) => new Promise((resolve) => {
    pending.set(++nextId, resolve);
    ws.send(JSON.stringify({ id: nextId, method, params, sessionId }));
  });
  const evaluate = async (expression) => {
    const { result } = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
    if (result.exceptionDetails) throw new Error(`${expression}: ${result.exceptionDetails.exception?.description}`);
    return result.result.value;
  };

  const scenarios = { manage, extras, reload };
  console.log((await scenarios[scenario]({ send, evaluate })).join('|'));
} catch (e) {
  console.error(`artifact-ui: ${e.message}`);
  if (stderr) console.error(`--- Chrome stderr (tail) ---\n${stderr}`);
  process.exitCode = 1;
} finally {
  ws?.close();
  proc.kill();
  await exited;
  rmSync(profile, { recursive: true, force: true });
}
