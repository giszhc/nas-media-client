// 抓取优酷网页版播放器控制栏真实 DOM 结构（仅文本，供 1:1 还原参考）
const { spawn } = require('child_process');
const http = require('http');
const fs = require('fs');
const os = require('os');
const path = require('path');
const PORT = 9341;
const URL = process.env.YK || 'https://www.youku.com/ku/webhome';
const PROFILE = fs.mkdtempSync(path.join(os.tmpdir(), 'ykprobe-'));
const get = (u) => new Promise((r, j) => { http.get(u, s => { let d = ''; s.on('data', c => d += c); s.on('end', () => r(d)); }).on('error', j); });
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
function makecdp(wsUrl) {
  const WS = global.WebSocket || require('ws');
  const ws = new WS(wsUrl); let id = 0; const pending = new Map();
  const onOpen = () => new Promise(r => { if (ws.readyState === 1) return r(); ws.addEventListener('open', () => r()); });
  ws.addEventListener('message', raw => { const m = JSON.parse(raw.data || raw); if (m.id && pending.has(m.id)) { pending.get(m.id)(m.result); pending.delete(m.id); } });
  const send = (method, params = {}) => new Promise(res => { const mid = ++id; pending.set(mid, res); ws.send(JSON.stringify({ id: mid, method, params })); });
  return { ws, send, onOpen, close: () => ws.close() };
}
async function findWs() { for (let i = 0; i < 60; i++) { try { return JSON.parse(await get(`http://127.0.0.1:${PORT}/json/version`)).webSocketDebuggerUrl; } catch (e) { await sleep(200); } } throw new Error('no ws'); }
async function main() {
  const chrome = spawn('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    ['--remote-debugging-port=' + PORT, '--user-data-dir=' + PROFILE, '--headless=new', '--no-sandbox', '--disable-gpu', '--window-size=1440,900',
     '--user-agent=Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36'], { stdio: 'ignore' });
  try {
    const browser = makecdp(await findWs()); await browser.onOpen();
    await browser.send('Target.createTarget', { url: 'about:blank' });
    const targets = JSON.parse(await get(`http://127.0.0.1:${PORT}/json`));
    const page = makecdp(targets.find(t => t.type === 'page').webSocketDebuggerUrl); await page.onOpen();
    await page.send('Runtime.enable'); await page.send('Page.enable'); await page.send('Network.enable');
    await page.send('Page.navigate', { url: URL });
    await sleep(6000);
    const ev = async (e) => (await page.send('Runtime.evaluate', { expression: e, returnByValue: true })).result.value;
    const title = await ev('document.title');
    const hasVideo = await ev('!!document.querySelector("video")');
    const dump = await ev(`(function(){
      const out=[];
      const all=[...document.querySelectorAll('*')];
      const pick=all.filter(e=>{const c=(''+e.className).toLowerCase();return /control|playbar|progress|toolbar|bar|speed|quality|volume|next|prev|full|pip|theater|webfull/i.test(c) && e.children.length>0 && e.children.length<40;});
      pick.slice(0,50).forEach(e=>{out.push({tag:e.tagName,cls:(''+e.className).slice(0,70),txt:(e.textContent||'').replace(/\\s+/g,' ').slice(0,30),kids:[...e.children].slice(0,12).map(k=>({t:k.tagName,c:(''+k.className).slice(0,40),x:(k.getAttribute('data-xxx')||''),txt:(k.textContent||'').replace(/\\s+/g,' ').slice(0,18)}))});});
      return out;
    })()`);
    console.log('TITLE:', title);
    console.log('HAS_VIDEO:', hasVideo);
    console.log('NODES:', JSON.stringify(dump, null, 1));
    let s = await page.send('Page.captureScreenshot', { format: 'png' }); fs.writeFileSync('/tmp/youku_probe.png', Buffer.from(s.data, 'base64'));
    page.close(); browser.close();
  } finally { chrome.kill('SIGKILL'); try { fs.rmSync(PROFILE, { recursive: true, force: true }); } catch (e) {} }
}
main().catch(e => { console.error('PROBE ERR', e.message); process.exit(1); });
