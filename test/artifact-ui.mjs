#!/usr/bin/env node
// test/artifact-ui.mjs <chrome> <base-url> — artifact skill の管理画面をヘッドレス Chrome で操作し、
// 観測結果を | 区切りの 1 行で出す（run.sh が期待値と比べる）。
// 前提: ストアに my-demo（Demo Page、新しい方）と untitled の 2 件だけがある。
import { spawn } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const [chrome, base] = process.argv.slice(2);
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
  const titles = () => evaluate("[...document.querySelectorAll('#list li .title')].map((a) => a.textContent).join(',')");
  const rows = () => evaluate("document.querySelectorAll('#list li').length");
  const filter = (q) => evaluate(`(() => {
    const q = document.getElementById('q');
    q.value = ${JSON.stringify(q)};
    q.dispatchEvent(new Event('input'));
  })()`);
  const clickDelete = (title) => evaluate(`(() => {
    const li = [...document.querySelectorAll('#list li')].find((l) => l.querySelector('.title').textContent === ${JSON.stringify(title)});
    const b = li.querySelector('button');
    b.click();
    return b.textContent;
  })()`);

  const out = [];
  await send('Page.navigate', { url: `${base}/` });
  out.push(await until(titles, 'the list to render'));
  await filter('untitled');
  out.push(await rows());
  await filter('');
  out.push(await clickDelete('untitled'));
  out.push(await rows());
  await clickDelete('untitled');
  await until(async () => (await rows()) === 1, 'the deleted row to disappear');
  out.push(await titles());
  out.push(await evaluate("fetch('/api/artifacts').then((r) => r.json()).then((a) => a.map((x) => x.slug).join(','))"));
  await clickDelete('Demo Page');
  await clickDelete('Demo Page');
  out.push(await until(() => evaluate("!document.getElementById('empty').hidden"), 'the empty state'));
  console.log(out.join('|'));
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
