// 抓取优酷「播放页」真实播放器控制栏 DOM 结构
const { spawn } = require('child_process');
const http = require('http');
const fs = require('fs');
const os = require('os');
const path = require('path');
const PORT = 9342;
const PROFILE = fs.mkdtempSync(path.join(os.tmpdir(), 'ykp2-'));
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
    await page.send('Runtime.enable'); await page.send('Page.enable');
    const ev = async (e) => (await page.send('Runtime.evaluate', { expression: e, returnByValue: true })).result.value;

    await page.send('Page.navigate', { url: 'https://www.youku.tv/v/v_show/id_XNjEzNzIyOTE2MA==.html' });
    await sleep(7000);
    const link = '';
    console.log('VIDEO_LINK:', link);

    const info = await ev(`(function(){
      var v=document.querySelector('video');
      if(!v) return {err:'no video'};
      function chain(el,n){var a=[];while(el&&a.length<n){a.push((el.tagName||'')+'.'+(''+(el.className||'')).trim().slice(0,50));el=el.parentElement;}return a;}
      // 找 player 根：含 video 的祖先里 class 含 player/play 的最大者
      var root=v.parentElement;
      while(root&&!/player|play_|ykplayer|player_/i.test(''+root.className)&&root.parentElement) root=root.parentElement;
      // 在 root 内找所有按钮 / 含 control 的节点
      function mapControls(scope){
        var nodes=[...scope.querySelectorAll('*')];
        return nodes.filter(function(e){var c=(''+e.className).toLowerCase();return /control|playbar|progress|toolbar|bar|speed|quality|volume|next|prev|full|pip|theater|webfull|btn|setting|subtitle/i.test(c)&&e.children.length<25;})
          .slice(0,60).map(function(e){return {tag:e.tagName,cls:(''+e.className).replace(/\\s+/g,' ').slice(0,60),txt:(e.textContent||'').replace(/\\s+/g,' ').trim().slice(0,16)};});
      }
      return {chain:chain(v,6),rootCls:(''+root.className).slice(0,60),controls:mapControls(root)};
    })()`);
    console.log('INFO:', JSON.stringify(info, null, 1));
    let s = await page.send('Page.captureScreenshot', { format: 'png' }); fs.writeFileSync('/tmp/youku_watch.png', Buffer.from(s.data, 'base64'));
    page.close(); browser.close();
  } finally { chrome.kill('SIGKILL'); try { fs.rmSync(PROFILE, { recursive: true, force: true }); } catch (e) {} }
}
main().catch(e => { console.error('PROBE ERR', e.message); process.exit(1); });
