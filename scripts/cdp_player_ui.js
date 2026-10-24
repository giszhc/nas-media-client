// 专门截播放器控制栏：overlay + 设置弹层弹出（暗色/亮色各一张）
const { spawn } = require('child_process');
const http = require('http');
const fs = require('fs');
const os = require('os');
const path = require('path');

const PORT = 9334;
const URL = process.env.TEST_URL || 'http://127.0.0.1:8787/';
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const PROFILE = fs.mkdtempSync(path.join(os.tmpdir(), 'yyui-'));

function get(url) {
  return new Promise((res, rej) => {
    http.get(url, (r) => { let d = ''; r.on('data', (c) => (d += c)); r.on('end', () => res(d)); }).on('error', rej);
  });
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function makecdp(wsUrl) {
  const WS = global.WebSocket || require('ws');
  const ws = new WS(wsUrl);
  let id = 0;
  const pending = new Map();
  function onOpen() { return new Promise((r) => { if (ws.readyState === 1) return r(); ws.addEventListener('open', () => r()); }); }
  ws.addEventListener('message', (raw) => {
    const m = JSON.parse(raw.data || raw);
    if (m.id && pending.has(m.id)) { pending.get(m.id)(m.result); pending.delete(m.id); }
  });
  function send(method, params = {}) {
    return new Promise((res) => { const mid = ++id; pending.set(mid, res); ws.send(JSON.stringify({ id: mid, method, params })); });
  }
  return { send, onOpen, close: () => ws.close() };
}

async function findWs() {
  for (let i = 0; i < 60; i++) {
    try { return JSON.parse(await get(`http://127.0.0.1:${PORT}/json/version`)).webSocketDebuggerUrl; }
    catch (e) { await sleep(200); }
  }
  throw new Error('chrome ws not ready');
}

async function main() {
  const chrome = spawn(CHROME, [
    '--remote-debugging-port=' + PORT, '--user-data-dir=' + PROFILE,
    '--headless=new', '--no-sandbox', '--disable-gpu', '--window-size=1440,940', 'about:blank'
  ], { stdio: 'ignore' });
  let browser, page;
  const out = {};
  try {
    const wsUrl = await findWs();
    browser = makecdp(wsUrl);
    await browser.onOpen();
    await browser.send('Target.createTarget', { url: 'about:blank' });
    const target = JSON.parse(await get(`http://127.0.0.1:${PORT}/json`)).find((t) => t.type === 'page');
    page = makecdp(target.webSocketDebuggerUrl);
    await page.onOpen();
    await page.send('Runtime.enable');
    await page.send('Page.enable');
    const ev = async (expr) => {
      const r = await page.send('Runtime.evaluate', { expression: expr, returnByValue: true });
      return r.result && r.result.value;
    };

    await page.send('Page.navigate', { url: URL });
    await sleep(3000);
    const firstId = await ev(`(document.querySelector('[data-act="open"]')||{dataset:{}}).dataset.id||''`);
    await page.send('Runtime.evaluate', { expression: `localStorage.setItem('yy_theme','dark');location.hash='#/play/${firstId}/0'` });
    await sleep(2800);

    // 1) 控制栏 overlay（暗色）
    await page.send('Runtime.evaluate', { expression: `document.getElementById('player').classList.add('show-ui')` });
    await sleep(250);
    let shot = await page.send('Page.captureScreenshot', { format: 'png' });
    fs.writeFileSync(path.join(__dirname, '..', 'screenshots', 'yy_ctrl_dark.png'), Buffer.from(shot.data, 'base64'));

    // 2) 设置弹层弹出（暗色）
    await page.send('Runtime.evaluate', { expression: `document.getElementById('settingsBtn').click()` });
    await sleep(300);
    shot = await page.send('Page.captureScreenshot', { format: 'png' });
    fs.writeFileSync(path.join(__dirname, '..', 'screenshots', 'yy_ctrl_settings.png'), Buffer.from(shot.data, 'base64'));

    // 3) 亮色主题 + 控制栏
    await page.send('Runtime.evaluate', { expression: `document.getElementById('settingsBtn').click();document.documentElement.setAttribute('data-theme','light');document.getElementById('player').classList.add('show-ui');document.body.classList.add('force-light')` });
    await sleep(350);
    shot = await page.send('Page.captureScreenshot', { format: 'png' });
    fs.writeFileSync(path.join(__dirname, '..', 'screenshots', 'yy_ctrl_light.png'), Buffer.from(shot.data, 'base64'));

    out.ok = true;
    page.close();
  } catch (e) {
    out.error = String(e);
  } finally {
    browser && browser.close();
    chrome.kill('SIGKILL');
    try { fs.rmSync(PROFILE, { recursive: true, force: true }); } catch (e) {}
  }
  console.log(JSON.stringify(out));
}
main();
