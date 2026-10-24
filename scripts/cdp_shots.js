// 快速补两张截图：亮色首页 + 列表筛选页
const { spawn } = require('child_process');
const http = require('http');
const fs = require('fs');
const os = require('os');
const path = require('path');
const PORT = 9334;
const URL = 'http://127.0.0.1:8787/';
const PROFILE = fs.mkdtempSync(path.join(os.tmpdir(), 'yycdp2-'));
const get = (u) => new Promise((r, j) => { http.get(u, s => { let d = ''; s.on('data', c => d += c); s.on('end', () => r(d)); }).on('error', j); });
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
function makecdp(wsUrl) {
  const WS = global.WebSocket || require('ws');
  const ws = new WS(wsUrl);
  let id = 0; const pending = new Map();
  const onOpen = () => new Promise(r => { if (ws.readyState === 1) return r(); ws.addEventListener('open', () => r()); });
  ws.addEventListener('message', raw => { const m = JSON.parse(raw.data || raw); if (m.id && pending.has(m.id)) { pending.get(m.id)(m.result); pending.delete(m.id); } });
  const send = (method, params = {}) => new Promise(res => { const mid = ++id; pending.set(mid, res); ws.send(JSON.stringify({ id: mid, method, params })); });
  return { ws, send, onOpen, close: () => ws.close() };
}
async function findWs() { for (let i = 0; i < 60; i++) { try { return JSON.parse(await get(`http://127.0.0.1:${PORT}/json/version`)).webSocketDebuggerUrl; } catch (e) { await sleep(200); } } throw new Error('no ws'); }
async function main() {
  const chrome = spawn('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', ['--remote-debugging-port=' + PORT, '--user-data-dir=' + PROFILE, '--headless=new', '--no-sandbox', '--disable-gpu', '--window-size=1440,940', 'about:blank'], { stdio: 'ignore' });
  try {
    const browser = makecdp(await findWs()); await browser.onOpen();
    await browser.send('Target.createTarget', { url: 'about:blank' });
    const targets = JSON.parse(await get(`http://127.0.0.1:${PORT}/json`));
    const page = makecdp(targets.find(t => t.type === 'page').webSocketDebuggerUrl); await page.onOpen();
    await page.send('Runtime.enable'); await page.send('Page.enable');
    await page.send('Page.navigate', { url: URL }); await sleep(3000);
    await page.send('Runtime.evaluate', { expression: "try{localStorage.setItem('yy_theme','light');}catch(e){} document.documentElement.setAttribute('data-theme','light');" });
    await sleep(500);
    let s = await page.send('Page.captureScreenshot', { format: 'png' }); fs.writeFileSync('/tmp/yy_home_light.png', Buffer.from(s.data, 'base64'));
    await page.send('Runtime.evaluate', { expression: "location.hash = '#/list/tv'" }); await sleep(1500);
    s = await page.send('Page.captureScreenshot', { format: 'png' }); fs.writeFileSync('/tmp/yy_list.png', Buffer.from(s.data, 'base64'));
    page.close(); browser.close();
  } finally { chrome.kill('SIGKILL'); try { fs.rmSync(PROFILE, { recursive: true, force: true }); } catch (e) {} }
  console.log('ok');
}
main().catch(e => { console.error(e); process.exit(1); });
