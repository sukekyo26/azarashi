#!/usr/bin/env node
// test/artifact-ui.mjs <chrome> <base-url> <scenario> [artifacts.mjs] — artifact skill の画面を
// ヘッドレス Chrome で操作し、観測結果を | 区切りの 1 行で出す（run.sh が期待値と比べる）。
//   manage: 管理画面。前提はストアに my-demo（Demo Page、新しい方）と untitled の 2 件だけがあること
//   reload: ライブリロード。artifacts.mjs で live を公開し直す（ARTIFACTS_DIR / ARTIFACTS_PORT を引き継ぐ）
import { execFileSync, spawn } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const [chrome, base, scenario, art] = process.argv.slice(2);
// Chrome を起動する前に確かめ、引数の取り違えを型エラーではなく使い方で知らせる
if (!chrome || !base || !['manage', 'reload'].includes(scenario) || (scenario === 'reload' && !art)) {
  console.error('usage: artifact-ui.mjs <chrome> <base-url> manage | reload <artifacts.mjs>');
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
  out.push(await evaluate("(() => { const d = document.querySelector('#list li .download'); return `${d.getAttribute('href')} ${d.getAttribute('download')}`; })()"));
  // a row's project tag filters by it and keeps the choice in the URL; the "すべて" chip clears it
  out.push(await evaluate(`(() => {
    const tag = document.querySelector('#list li .tag');
    tag.click();
    const pressed = document.querySelector('.chip[aria-pressed="true"]').firstChild.textContent;
    return [document.querySelectorAll('#list li').length, pressed === tag.textContent,
      new URLSearchParams(location.search).get('project') === tag.textContent].join(' ');
  })()`));
  await evaluate("document.querySelector('.chip').click()");
  out.push(await evaluate("location.search === '' && document.querySelector('.chip').getAttribute('aria-pressed')"));
  await filter('untitled');
  out.push(await rows());
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
  await evaluate('window.fetch = window.realFetch');
  // the button stays armed, so one more click deletes
  await clickDelete('Demo Page');
  out.push(await until(() => evaluate("!document.getElementById('empty').hidden"), 'the empty state'));
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
    await send('Page.navigate', { url: `${base}/a/live/` });
    out.push(await until(shown('1'), 'the first version') && '1');
    publish('2');
    out.push(await until(shown('2'), 'the page to reload') && '2');
    return out;
  } finally {
    rmSync(dir, { recursive: true, force: true });
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
  const send = (method, params = {}) => new Promise((resolve) => {
    pending.set(++nextId, resolve);
    ws.send(JSON.stringify({ id: nextId, method, params }));
  });
  const evaluate = async (expression) => {
    const { result } = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
    if (result.exceptionDetails) throw new Error(`${expression}: ${result.exceptionDetails.exception?.description}`);
    return result.result.value;
  };

  const scenarios = { manage, reload };
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
