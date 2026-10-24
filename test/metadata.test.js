'use strict';
const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'yunying-metadata-test-'));
process.env.YUNYING_DATA_DIR = dir;
const net = require('../lib/net');
let remote = async () => null;
net.fetchAbroadJson = (...args) => remote(...args);
const originalFetch = global.fetch;
global.fetch = async () => ({ ok: true, headers: new Headers(), text: async () => '[]' });
const metadata = require('../lib/metadata');
const { createExtraProviders, parse1905Search } = require('../lib/metadata-extra');
after(async () => {
  global.fetch = originalFetch;
  await new Promise(resolve => setTimeout(resolve, 800));
  fs.rmSync(dir, { recursive: true, force: true });
});
test('1905 搜索只解析影片候选，保留中英文片名并去重', () => {
  const html = '<a href="https://www.1905.com/mdb/film/999/">相关新闻</a>' +
    '<h2 class="title-mv"><a href="https://www.1905.com/mdb/film/123/"><font>示</font><font>例</font><b>(2024)</b></a></h2><img src="https://image11.m1905.cn/a.jpg"><b class="jb">8.2</b>' +
    '<h2 class="title-mv"><a href="https://www.1905.com/mdb/film/456/">Example Film <b>(2020)</b></a></h2>';
  const result = parse1905Search(html);
  assert.deepEqual(result.map(c => [c.title, c.year]), [['示例', 2024], ['Example Film', 2020]]);
  assert.equal(result[0].rating, 8.2);
});
test('1905 详情映射、缓存、拦截页面回退', async () => {
  let count = 0;
  const p = createExtraProviders(undefined, async () => {
    count++;
    return '<meta content="剧情&amp;简介" property="og:description"><meta property="og:image" content="https://image11.m1905.cn/a.jpg">' +
      '<a href="/mdb/film/123/">详情</a><h3><span>示例</span><i>(2024)</i></h3>' +
      '<li><span>上映时间</span><em>2024年01月01日</em></li><li><span>导&nbsp;演</span><em><a>某导演</a></em></li>';
  });
  const d = await p.movie1905Apply('123', {});
  assert.equal(d.year, 2024);
  assert.equal(d.overview, '剧情&简介');
  assert.deepEqual(d.director, ['某导演']);
  await p.movie1905Apply('123', {});
  assert.equal(count, 1);
  const blocked = createExtraProviders(undefined, async () => '请输入验证码');
  assert.deepEqual(await blocked.movie1905Search('示例', 'movie'), []);
  await assert.rejects(blocked.movie1905Apply('../bad', {}), /ID 无效/);
});
test('Jikan 搜索类型过滤、别名、详情和 N/A 缺省值', async () => {
  const d = { mal_id: 1, title: 'Example', title_japanese: '示例', titles: [{ title: '示例' }], type: 'TV', year: 2024,
    synopsis: 'Story', images: { jpg: { image_url: 'https://cdn.myanimelist.net/a.jpg' } }, episodes: 12 };
  const p = createExtraProviders(async url => ({ data: url.includes('?') ? [d, { ...d, mal_id: 2, type: 'Movie' }] : d }));
  const list = await p.jikanSearch('示例', 'tv');
  assert.equal(list.length, 1);
  assert.deepEqual(list[0].aliases, ['示例']);
  const detail = await p.jikanApply('1', {});
  assert.equal(detail.episodeCount, 12);
  assert.equal(detail.rating, 0);
  await assert.rejects(p.jikanApply('not-an-id', {}), /ID 无效/);
});
test('不以评分封面代替片名依据，拒绝年份、电影剧集不符', () => {
  const item = { title: '示例作品', year: 2024, type: 'tv' };
  assert.equal(metadata.isRelevant({ title: '无关作品', year: 2024, poster: 'a', rating: 9, isSeries: true }, item), false);
  assert.equal(metadata.isRelevant({ title: '示例作品', year: 1990, isSeries: true }, item), false);
  assert.equal(metadata.isRelevant({ title: '示例作品', year: 2024, isSeries: false }, item), false);
  assert.equal(metadata.isRelevant({ title: 'Example', aliases: ['示例作品'], year: 2024, isSeries: true }, item), true);
});
test('豆瓣无结果后自动回退 TVmaze，缓存复用', async () => {
  let count = 0;
  remote = async url => {
    count++;
    if (url.includes('/search/shows')) return [{ show: { id: 1, name: 'Example Show', premiered: '2024-01-01' } }];
    if (url.includes('/shows/1')) return { id: 1, name: 'Example Show', summary: '<p>Story</p>', premiered: '2024-01-01' };
    return null;
  };
  const item = { id: 'test-tvmaze', title: 'Example Show', year: 2024, type: 'tv' };
  const d = await metadata.matchItem(item);
  assert.equal(d.provider, 'tvmaze');
  assert.equal(d.overview, 'Story');
  const before = count;
  await metadata.matchItem(item);
  assert.equal(count, before);
});
test('新增来源手动应用及失败重匹配保留旧信息', async () => {
  remote = async () => ({ data: { mal_id: 1, title: 'Example', type: 'TV' } });
  const item = { id: 'test-manual', title: 'Example', year: null, type: 'anime' };
  const chosen = await metadata.applyCandidate(item, '1', 'tv', 'jikan');
  assert.equal(chosen.provider, 'jikan');
  remote = async () => null;
  const preserved = await metadata.matchItem(item, { force: true });
  assert.equal(preserved.provider, 'jikan');
  await assert.rejects(metadata.applyCandidate(item, '1', 'tv', 'unknown'), /不支持/);
});
test('电影自动回退 1905，无 Key 可完成匹配', async () => {
  const previousFetch = global.fetch;
  remote = async () => null;
  global.fetch = async url => ({ ok: true, headers: new Headers(), text: async () => {
    if (String(url).includes('/search/index-p-type-film')) return '<h2 class="title-mv"><a href="https://www.1905.com/mdb/film/123/">示例电影 <b>(2024)</b></a></h2>';
    if (String(url).includes('/mdb/film/123/')) return '<a href="/mdb/film/123/">详情</a><h3><span>示例电影</span></h3><meta property="og:description" content="简介"><li><span>上映时间</span><em>2024年</em></li>';
    return '[]';
  } });
  try {
    const d = await metadata.matchItem({ id: 'test-1905-auto', title: '示例电影', year: 2024, type: 'movie' });
    assert.equal(d.provider, 'movie1905');
    assert.equal(d.title, '示例电影');
    assert.equal(d.overview, '简介');
  } finally { global.fetch = previousFetch; }
});
