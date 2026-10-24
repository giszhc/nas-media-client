// CDP 冒烟测试：加载页面、捕获控制台/异常、验证首页/主题/列表/播放页
const { spawn } = require('child_process');
const http = require('http');
const fs = require('fs');
const os = require('os');
const path = require('path');

const PORT = 9333;
const URL = process.env.TEST_URL || 'http://127.0.0.1:8787/';
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const PROFILE = fs.mkdtempSync(path.join(os.tmpdir(), 'yycdp-'));

function get(url) {
  return new Promise((res, rej) => {
    http.get(url, (r) => { let d = ''; r.on('data', (c) => (d += c)); r.on('end', () => res(d)); }).on('error', rej);
  });
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// 兼容 undici(global.WebSocket) 与 ws 包：统一用 addEventListener
function makecdp(wsUrl) {
  const WS = global.WebSocket || require('ws');
  const ws = new WS(wsUrl);
  let id = 0;
  const pending = new Map();
  const handlers = { console: [], exception: [] };
  function onOpen() { return new Promise((r) => { if (ws.readyState === 1) return r(); ws.addEventListener('open', () => r()); }); }
  ws.addEventListener('message', (raw) => {
    const m = JSON.parse(raw.data || raw);
    if (m.id && pending.has(m.id)) { pending.get(m.id)(m.result); pending.delete(m.id); }
    if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') {
      handlers.console.push('console.error: ' + m.params.args.map((a) => a.value || a.description || '').join(' '));
    }
    if (m.method === 'Runtime.exceptionThrown') {
      const e = m.params.exceptionDetails;
      handlers.exception.push('exception: ' + ((e.exception && e.exception.description) || e.text));
    }
  });
  function send(method, params = {}) {
    return new Promise((res) => { const mid = ++id; pending.set(mid, res); ws.send(JSON.stringify({ id: mid, method, params })); });
  }
  return { ws, send, onOpen, errors: () => handlers.console.concat(handlers.exception), close: () => ws.close() };
}

async function findWs() {
  for (let i = 0; i < 60; i++) {
    try { const v = JSON.parse(await get(`http://127.0.0.1:${PORT}/json/version`)); return v.webSocketDebuggerUrl; }
    catch (e) { await sleep(200); }
  }
  throw new Error('chrome ws not ready');
}

async function main() {
  const chrome = spawn(CHROME, [
    '--remote-debugging-port=' + PORT, '--user-data-dir=' + PROFILE,
    '--headless=new', '--no-sandbox', '--disable-gpu', '--window-size=1440,940', 'about:blank'
  ], { stdio: 'ignore' });

  const results = { errors: [] };
  let browser, page;
  try {
    const wsUrl = await findWs();
    browser = makecdp(wsUrl);
    await browser.onOpen();
    await browser.send('Target.createTarget', { url: 'about:blank' });
    const targets = JSON.parse(await get(`http://127.0.0.1:${PORT}/json`));
    const target = targets.find((t) => t.type === 'page');
    page = makecdp(target.webSocketDebuggerUrl);
    await page.onOpen();
    await page.send('Runtime.enable');
    await page.send('Page.enable');
    const evalx = async (expr) => {
      const r = await page.send('Runtime.evaluate', { expression: expr, returnByValue: true });
      return r.result && r.result.value;
    };

    await page.send('Page.navigate', { url: URL });
    await sleep(3500);

    results.home = {
      hero: await evalx(`!!document.querySelector('.hero')`),
      rank: await evalx(`!!document.querySelector('.rank')`),
      rankCount: await evalx(`document.querySelectorAll('.rank-item').length`),
      rows: await evalx(`document.querySelectorAll('.row').length`),
      themeBtn: await evalx(`!!document.querySelector('[data-act="theme"]')`),
      bg: await evalx(`getComputedStyle(document.body).backgroundColor`),
    };

    await page.send('Runtime.evaluate', { expression: `document.querySelector('[data-act="theme"]').click()` });
    await sleep(400);
    results.afterToggle = {
      themeAttr: await evalx(`document.documentElement.getAttribute('data-theme')`),
      bg: await evalx(`getComputedStyle(document.body).backgroundColor`),
    };

    await page.send('Runtime.evaluate', { expression: `location.hash = '#/list/movie'` });
    await sleep(1200);
    results.list = {
      filterbar: await evalx(`!!document.querySelector('.filterbar')`),
      typeChips: await evalx(`document.querySelectorAll('[data-act="ftype"]').length`),
      yearChips: await evalx(`document.querySelectorAll('[data-act="fyear"]').length`),
      cards: await evalx(`document.querySelectorAll('.grid .card').length`),
    };

    const firstId = await evalx(`(document.querySelector('[data-act="open"]')||{}).dataset ? document.querySelector('[data-act="open"]').dataset.id : ''`);
    await page.send('Runtime.evaluate', { expression: `location.hash = '#/play/${firstId}/0'` });
    await sleep(2600);
    results.player = {
      visible: await evalx(`!document.getElementById('player').hidden`),
      title: await evalx(`document.getElementById('playerTitle').textContent`),
      sideMeta: await evalx(`document.getElementById('sideMeta').textContent`),
      synopsis: await evalx(`(document.getElementById('ppSynopsis').textContent||'').slice(0,40)`),
      pepCount: await evalx(`document.querySelectorAll('#pepGrid .pep').length`),
    };

    // ---- 控制栏（优酷 overlay + 交互）断言 ----
    results.pctrl = {
      controlsInsideStage: await evalx(`document.getElementById('ppControls').closest('#ppStage') === document.getElementById('ppStage')`),
      overlayPos: await evalx(`getComputedStyle(document.getElementById('ppControls')).position`),
      leftBtns: await evalx(`document.querySelectorAll('#ppControls .pp-cbar-l .pbtn').length`),
      rightOrder: await evalx(`Array.from(document.querySelectorAll('#ppControls .pp-cbar-r [data-pact]')).map(b=>b.dataset.pact).join(',')`),
      barDotPos: await evalx(`getComputedStyle(document.getElementById('pbarDot')).position`),
      badge: await evalx(`(document.getElementById('pnote').textContent||'').slice(0,24)`),
    };
    // 设置弹层：自动连播开关 + 画面比例
    await page.send('Runtime.evaluate', { expression: `document.getElementById('settingsBtn').click()` });
    await sleep(180);
    results.pctrl.settingsOpen = await evalx(`!document.getElementById('settingsMenu').hidden`);
    results.pctrl.settingsRows = await evalx(`document.querySelectorAll('#settingsMenu .pm-row').length`);
    await page.send('Runtime.evaluate', { expression: `document.querySelector('#settingsMenu .pm-row[data-set="autoNext"]').click()` });
    await sleep(140);
    results.pctrl.autoNextToggledOff = await evalx(`!document.querySelector('#settingsMenu .pm-row[data-set="autoNext"] .pm-switch').classList.contains('on')`);
    await page.send('Runtime.evaluate', { expression: `document.querySelector('#settingsMenu .pm-row[data-set="fit"] button[data-val="fill"]').click()` });
    await sleep(140);
    results.pctrl.fitFill = await evalx(`document.getElementById('video').style.objectFit`);
    // 倍速弹层（打开倍速应同时关闭设置）
    await page.send('Runtime.evaluate', { expression: `document.getElementById('speedBtn').click()` });
    await sleep(140);
    results.pctrl.speedOpenClosesSettings = await evalx(`!document.getElementById('speedMenu').hidden && document.getElementById('settingsMenu').hidden`);
    await page.send('Runtime.evaluate', { expression: `document.getElementById('speedBtn').click()` });
    await sleep(120);
    // 网页全屏（剧场模式）开/关
    await page.send('Runtime.evaluate', { expression: `document.getElementById('theaterBtn').click()` });
    await sleep(200);
    results.pctrl.theaterOn = await evalx(`document.getElementById('player').classList.contains('is-theater') && document.getElementById('theaterBtn').classList.contains('on')`);
    await page.send('Runtime.evaluate', { expression: `document.getElementById('theaterBtn').click()` });
    await sleep(200);
    results.pctrl.theaterOff = await evalx(`!document.getElementById('player').classList.contains('is-theater')`);

    // ---- 滚动归属断言：外层(含左侧视频)不滚动，只有右侧栏滚动 ----
    results.scroll = {
      playerOverflowY: await evalx(`getComputedStyle(document.getElementById('player')).overflowY`),
      sideOverflowY: await evalx(`getComputedStyle(document.querySelector('.pp-side')).overflowY`),
      mainExtraScroll: await evalx(`(function(){var m=document.getElementById('main');return m.scrollHeight - m.clientHeight})()`),
      stageFitsInMain: await evalx(`document.getElementById('ppStage').getBoundingClientRect().bottom <= document.getElementById('main').getBoundingClientRect().bottom + 1`),
    };

    const shot = await page.send('Page.captureScreenshot', { format: 'png' });
    fs.writeFileSync('/tmp/yy_player.png', Buffer.from(shot.data, 'base64'));
    await page.send('Page.navigate', { url: URL });
    await sleep(1500);
    const shot2 = await page.send('Page.captureScreenshot', { format: 'png' });
    fs.writeFileSync('/tmp/yy_home.png', Buffer.from(shot2.data, 'base64'));

    results.errors = results.errors.concat(browser.errors(), page.errors());
    page.close();
  } finally {
    browser && browser.close();
    chrome.kill('SIGKILL');
    try { fs.rmSync(PROFILE, { recursive: true, force: true }); } catch (e) {}
  }
  console.log(JSON.stringify(results, null, 2));
}

main().catch((e) => { console.error('TEST ERROR', e); process.exit(1); });
