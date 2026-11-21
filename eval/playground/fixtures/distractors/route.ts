import { NextRequest, NextResponse } from '../_lib/next-shim'

import { htmlResponse, intParam, itemRow, playgroundBlocked, renderShell } from '../_lib/shell'

/**
 * 演练场 · 干扰控件大杂烩（pattern D3 / D4 / D6）。
 *
 * 同一个页面里放了七种「看起来像翻页、其实不是」的控件，只有最下面的「加载更多」是真翻页：
 * - D3 侧栏「换一换」：只刷新侧栏，主列表不变。一直在视口里，最容易被误选。
 * - D4 频道切换组：aria-pressed 按钮，点击会换一批主列表数据，URL 不变。
 * - D6 轮播右箭头：只横向滑动，不加载数据。
 * - D6 「展开」按钮：只切换一块内容的显示。
 * - D6 标签链接「看看有趣的人」：跳到另一个 tab（tab=fun 时显示「暂时没有数据」）。
 * - D6 加载中的 spinner：装饰，不可点。
 * - 真翻页：「加载更多」，每点一次追加 10 行，共 totalRows 行后按钮消失。
 *
 * query：
 * - totalRows：主列表总行数（默认 40，10–200，按 10 的倍数）
 * - tab：默认 recommend；fun 时主列表替换为「暂时没有数据」（用于 D6 标签链接的跳转目标）
 */
export async function GET(request: NextRequest): Promise<NextResponse> {
  const blocked = playgroundBlocked()
  if (blocked) return blocked

  const query = request.nextUrl.searchParams
  const totalRows = intParam(query.get('totalRows'), 40, 10, 200)
  const tab = query.get('tab') === 'fun' ? 'fun' : 'recommend'
  const firstBatch = Array.from({ length: 10 }, (_, index) => itemRow(index + 1)).join('\n')

  const feed =
    tab === 'fun'
      ? '<p class="empty">暂时没有数据</p>'
      : `<ul id="feed">\n${firstBatch}\n</ul>\n<button id="load-more" class="load-more">加载更多</button>`

  const body = `<nav class="channels">
  <span role="button" tabindex="0" aria-pressed="true" aria-label="推荐频道" class="chan" data-chan="推荐">推荐</span>
  <span role="button" tabindex="0" aria-pressed="false" aria-label="科技频道" class="chan" data-chan="科技">科技</span>
  <span role="button" tabindex="0" aria-pressed="false" aria-label="体育频道" class="chan" data-chan="体育">体育</span>
  <span role="button" tabindex="0" aria-pressed="false" aria-label="财经频道" class="chan" data-chan="财经">财经</span>
</nav>
<div class="layout">
  <main>
    <div class="tag-row">
      <a class="tag-link" href="/dev-fixtures/playground/distractors?tab=fun">看看 有趣好玩 的人是怎么评价的</a>
      <span class="spinner anticon-spin">◌</span>
    </div>
    <div class="carousel"><div class="track" id="track">${['A', 'B', 'C', 'D', 'E'].map((x) => `<div class="slide">推荐 ${x}</div>`).join('')}</div><button class="swiper-button-next" id="next-slide" aria-label="下一张">›</button></div>
    <div class="card"><p>简介：本地演练场的示例卡片，正文较短。</p><button class="expand" id="expand">展开</button><p class="more" hidden>展开后显示的更多说明文字。</p></div>
    <section class="feed-area">${feed}</section>
  </main>
  <aside>
    <h3>热门榜单</h3>
    <ol id="hot">${['热点一', '热点二', '热点三', '热点四', '热点五'].map((x) => `<li>${x}</li>`).join('')}</ol>
    <button class="refresh" id="refresh">换一换</button>
  </aside>
</div>`

  const script = `
(function () {
  var hotPool = ['热点甲', '热点乙', '热点丙', '热点丁', '热点戊', '热点己', '热点庚'];
  var hotTick = 0;
  document.getElementById('refresh').addEventListener('click', function () {
    hotTick++;
    var items = '';
    for (var i = 0; i < 5; i++) items += '<li>' + hotPool[(hotTick + i) % hotPool.length] + '</li>';
    document.getElementById('hot').innerHTML = items;
  });

  var track = document.getElementById('track');
  var slideIndex = 0;
  document.getElementById('next-slide').addEventListener('click', function () {
    slideIndex = (slideIndex + 1) % 5;
    track.style.transform = 'translateX(-' + slideIndex * 100 + '%)';
  });

  document.getElementById('expand').addEventListener('click', function () {
    document.querySelector('.more').hidden = false;
    this.remove();
  });

  var channelRows = { '推荐': 0, '科技': 1, '体育': 2, '财经': 3 };
  var chans = document.querySelectorAll('.chan');
  chans.forEach(function (el) {
    el.addEventListener('click', function () {
      chans.forEach(function (other) { other.setAttribute('aria-pressed', other === el ? 'true' : 'false'); });
      var offset = channelRows[el.dataset.chan] * 1000 + 500;
      var html = '';
      for (var i = 1; i <= 10; i++) html += '<li class="item"><span class="title">' + el.dataset.chan + ' ' + (offset + i) + '</span></li>';
      document.getElementById('feed').innerHTML = html;
    });
  });

  var loadMore = document.getElementById('load-more');
  if (loadMore) {
    var loaded = 10;
    var total = ${totalRows};
    loadMore.addEventListener('click', function () {
      var html = '';
      for (var i = 1; i <= 10; i++) {
        var n = loaded + i;
        html += '<li class="item"><span class="title">商品 ' + n + '</span><span class="price">¥' + (100 + n) + '</span></li>';
      }
      document.getElementById('feed').insertAdjacentHTML('beforeend', html);
      loaded += 10;
      if (loaded >= total) loadMore.remove();
    });
  }
})();
`

  return htmlResponse(
    renderShell('推荐页（干扰控件）', body, {
      script,
      style: `
.channels { display: flex; gap: 12px; margin-bottom: 12px; }
.chan { padding: 4px 10px; border: 1px solid #ccc; cursor: pointer; }
.chan[aria-pressed="true"] { background: #1a5fb4; color: #fff; }
.layout { display: flex; gap: 24px; align-items: flex-start; }
main { flex: 1; } aside { width: 220px; }
.carousel { position: relative; overflow: hidden; border: 1px solid #ddd; height: 80px; margin: 12px 0; }
.track { display: flex; transition: transform .2s; } .slide { min-width: 100%; padding: 24px; }
.swiper-button-next { position: absolute; right: 4px; top: 30px; }
.card { border: 1px solid #eee; padding: 12px; margin: 12px 0; }
.load-more { margin-top: 12px; padding: 6px 14px; }
`,
    })
  )
}
