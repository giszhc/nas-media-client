// 截一张「右侧滚动到底、左侧视频不动」的对比图，证明只有右侧滚动
const { spawn } = require('child_process');
const http = require('http');
const fs = require('fs');
const os = require('os');
const path = require('path');

const PORT = 9335;
const URL = process.env.TEST_URL || 'http://127.0.0.1:8787/';
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const PROFILE = fs.mkdtempSync(path.join(os.tmpdir(), 'yysc-'));

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
  const chrome = spawn(CHROME, ['--remote-debugging-port=' + PORT, '--user-data-dir=' + PROFILE, '--headless=new', '--no-sandbox', '--disable-gpu', '--window-size=1400,980', 'about:blank'], { stdio: 'ignore' });
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

    await page.send('Page.navigate', { url: URL });
    await sleep(3000);
    // 用 88 集连续剧《西游记》，右侧选集很长更能体现「只有右侧滚动」
    await page.send('Runtime.evaluate', { expression: `localStorage.setItem('yy_theme','dark');location.hash='#/play/beb8cf3b32127271/0'` });
    await sleep(3000);

    // 右侧滚动到底
    const before = await ev(`document.getElementById('ppStage').getBoundingClientRect().top`);
    await page.send('Runtime.evaluate', { expression: `document.querySelector('.pp-side').scrollTop = document.querySelector('.pp-side').scrollHeight` });
    await sleep(300);
    const after = await ev(`document.getElementById('ppStage').getBoundingClientRect().top`);
    const scrolled = await ev(`document.querySelector('.pp-side').scrollTop`);
    const sideMax = await ev(`(function(){var s=document.querySelector('.pp-side');return s.scrollHeight - s.clientHeight})()`);
    out.videoTopBefore = before; out.videoTopAfter = after; out.sideScrollTop = scrolled; out.sideScrollable = sideMax;
    out.leftUnmoved = before === after;

    const shot = await page.send('Page.captureScreenshot', { format: 'png' });
    fs.writeFileSync(path.join(__dirname, '..', 'screenshots', 'yy_scroll_proof.png'), Buffer.from(shot.data, 'base64'));
    page.close();
  } catch (e) { out.error = String(e); }
  finally { browser && browser.close(); chrome.kill('SIGKILL'); try { fs.rmSync(PROFILE, { recursive: true, force: true }); } catch (e) {} }
  console.log(JSON.stringify(out));
}
main();
