// 验证控制层「默认隐藏 / 悬停唤出 / 静止自动隐藏」
const { spawn } = require('child_process');
const http = require('http');
const fs = require('fs');
const os = require('os');
const path = require('path');

const PORT = 9336;
const URL = process.env.TEST_URL || 'http://127.0.0.1:8787/';
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const PROFILE = fs.mkdtempSync(path.join(os.tmpdir(), 'yyhide-'));

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
  ws.addEventListener('message', (raw) => { const m = JSON.parse(raw.data || raw); if (m.id && pending.has(m.id)) { pending.get(m.id)(m.result); pending.delete(m.id); } });
  function send(method, params = {}) { return new Promise((res) => { const mid = ++id; pending.set(mid, res); ws.send(JSON.stringify({ id: mid, method, params })); }); }
  return { send, onOpen, close: () => ws.close() };
}
async function findWs() { for (let i = 0; i < 60; i++) { try { return JSON.parse(await get(`http://127.0.0.1:${PORT}/json/version`)).webSocketDebuggerUrl; } catch (e) { await sleep(200); } } throw new Error('no ws'); }

async function main() {
  const chrome = spawn(CHROME, ['--remote-debugging-port=' + PORT, '--user-data-dir=' + PROFILE, '--headless=new', '--no-sandbox', '--disable-gpu', '--window-size=1440,940', 'about:blank'], { stdio: 'ignore' });
  let browser, page; const out = {};
  try {
    browser = makecdp(await findWs());
    await browser.onOpen();
    await browser.send('Target.createTarget', { url: 'about:blank' });
    const target = JSON.parse(await get(`http://127.0.0.1:${PORT}/json`)).find((t) => t.type === 'page');
    page = makecdp(target.webSocketDebuggerUrl);
    await page.onOpen();
    await page.send('Runtime.enable'); await page.send('Page.enable');
    const ev = async (e) => { const r = await page.send('Runtime.evaluate', { expression: e, returnByValue: true }); return r.result && r.result.value; };
    const showUI = () => ev(`document.getElementById('player').classList.contains('show-ui')`);

    await page.send('Page.navigate', { url: URL });
    await sleep(3000);
    const listOpen = `document.querySelector('[data-act="open"]')`;
    const firstId = await ev(`(${listOpen}||{dataset:{}}).dataset.id||''`);
    await page.send('Runtime.evaluate', { expression: `location.hash='#/play/${firstId}/0'` });
    await sleep(3600); // 不做任何交互，等它加载/播放后自动隐藏
    out.hiddenAfterIdle = await showUI();           // 期望 false
    out.pbarStillPresent = await ev(`!!document.getElementById('pbar')`); // 细进度条常驻

    // 悬停唤出
    await page.send('Runtime.evaluate', { expression: `document.getElementById('player').dispatchEvent(new MouseEvent('mousemove',{bubbles:true}))` });
    await sleep(150);
    out.shownOnHover = await showUI();              // 期望 true
    out.cbarOpacity = await ev(`getComputedStyle(document.querySelector('.pp-cbar')).opacity`); // 期望 ~1

    // 静止后再隐藏
    await sleep(3200);
    out.hiddenAfterIdle2 = await showUI();          // 期望 false
    out.cbarOpacityHidden = await ev(`getComputedStyle(document.querySelector('.pp-cbar')).opacity`); // 期望 ~0

    const shot = await page.send('Page.captureScreenshot', { format: 'png' });
    fs.writeFileSync(path.join(__dirname, '..', 'screenshots', 'yy_controls_hidden.png'), Buffer.from(shot.data, 'base64'));
    page.close();
  } catch (e) { out.error = String(e); }
  finally { browser && browser.close(); chrome.kill('SIGKILL'); try { fs.rmSync(PROFILE, { recursive: true, force: true }); } catch (e) {} }
  console.log(JSON.stringify(out));
}
main();
