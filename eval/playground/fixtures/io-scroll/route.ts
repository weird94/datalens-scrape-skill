import { NextRequest, NextResponse } from '../_lib/next-shim'

import { htmlResponse, intParam, itemRow, playgroundBlocked, renderShell } from '../_lib/shell'

/**
 * 演练场 · IntersectionObserver 无限滚动（pattern D8 / D9 / E2）。
 *
 * 续载由哨兵元素进入 root 视口触发，没有「加载更多」按钮。
 * - innerScroll=0：列表直接在页面里，root 是视口（window 滚动即可触发）。
 * - innerScroll=1：列表放在固定高度的 overflow:auto 容器里，root 就是这个容器；
 *   只滚 window 不会触发续载（D9 的形状）。
 * - endText=0：到底后既没有文案也没有哨兵，只能靠「不再增长」判断（E2）。endText=1 时显示「已经到底了」。
 *
 * query：
 * - batches：总批数（默认 8，1–50）
 * - batchSize：每批行数（默认 30，1–100）
 * - innerScroll：0 / 1（默认 0）
 * - endText：0 / 1（默认 0）
 * - delayMs：每批续载前的延迟毫秒数（默认 300，0–3000），模拟真实网络
 * - slowBatch / slowMs：第 slowBatch 批（从 2 起数，0 = 没有）要等 slowMs 毫秒（0–40000）才到，比规则的耐心
 *   （到底后连续几轮没有新行就停）更久（pattern D17）
 * - spinner：0 / 1，续载期间列表末尾显示「加载中…」（默认 0）
 * - lang：zh / en（默认 zh），影响标题、行文字、加载中和到底文案
 */
export async function GET(request: NextRequest): Promise<NextResponse> {
  const blocked = playgroundBlocked()
  if (blocked) return blocked

  const query = request.nextUrl.searchParams
  const batches = intParam(query.get('batches'), 8, 1, 50)
  const batchSize = intParam(query.get('batchSize'), 30, 1, 100)
  const innerScroll = intParam(query.get('innerScroll'), 0, 0, 1) === 1
  const endText = intParam(query.get('endText'), 0, 0, 1) === 1
  const delayMs = intParam(query.get('delayMs'), 300, 0, 3000)
  const slowBatch = intParam(query.get('slowBatch'), 0, 0, 50)
  const slowMs = intParam(query.get('slowMs'), 0, 0, 40_000)
  const spinner = intParam(query.get('spinner'), 0, 0, 1) === 1
  const en = query.get('lang') === 'en'
  const text = en
    ? { item: 'Item ', loading: 'Loading…', end: "You've reached the end", heading: 'Recommended (infinite scroll)', title: 'Infinite feed' }
    : { item: '商品 ', loading: '加载中…', end: '已经到底了', heading: '推荐列表（无限滚动）', title: '无限滚动列表' }

  const row = (n: number) => (en ? itemRow(n).replace('商品 ', text.item) : itemRow(n))
  const firstBatch = Array.from({ length: batchSize }, (_, index) => row(index + 1)).join('\n')
  const feedBody = `<ul id="feed">\n${firstBatch}\n</ul>\n<p id="loading" hidden>${text.loading}</p>\n<div id="sentinel"></div>`
  const scrollerBody = innerScroll
    ? `<div id="scroller" style="height: 480px; overflow: auto; border: 1px solid #ddd;">\n${feedBody}\n</div>`
    : feedBody

  const config = JSON.stringify({ batches, batchSize, endText, delayMs, innerScroll, slowBatch, slowMs, spinner, text })
  const script = `
(function () {
  var config = ${config};
  var feed = document.getElementById('feed');
  var sentinel = document.getElementById('sentinel');
  var root = config.innerScroll ? document.getElementById('scroller') : null;
  var loadedBatches = 1;
  var nextNumber = config.batchSize + 1;
  var loading = false;

  function appendBatch() {
    var html = '';
    for (var i = 0; i < config.batchSize; i++) {
      var n = nextNumber++;
      html += '<li class="item"><span class="title">' + config.text.item + n + '</span><span class="price">¥' + (100 + n) + '</span></li>';
    }
    feed.insertAdjacentHTML('beforeend', html);
  }

  function finish() {
    observer.disconnect();
    sentinel.remove();
    if (config.endText) {
      var p = document.createElement('p');
      p.textContent = config.text.end;
      document.body.appendChild(p);
    }
  }

  var observer = new IntersectionObserver(function (entries) {
    entries.forEach(function (entry) {
      if (!entry.isIntersecting || loading) return;
      loading = true;
      var spin = document.getElementById('loading');
      if (config.spinner) spin.hidden = false;
      setTimeout(function () {
        appendBatch();
        loadedBatches++;
        loading = false;
        spin.hidden = true;
        if (loadedBatches >= config.batches) finish();
      }, loadedBatches + 1 === config.slowBatch ? config.slowMs : config.delayMs);
    });
  }, { root: root, rootMargin: '0px' });

  observer.observe(sentinel);
})();
`

  const body = `<h1>${text.heading}</h1>\n${scrollerBody}`
  const html = renderShell(text.title, body, { script, style: '#sentinel { height: 1px; }' })
  return htmlResponse(en ? html.replace('<html lang="zh">', '<html lang="en">') : html)
}
