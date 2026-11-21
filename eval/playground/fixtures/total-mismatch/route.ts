import { NextRequest, NextResponse } from '../_lib/next-shim'

import { htmlResponse, intParam, playgroundBlocked, renderShell } from '../_lib/shell'

/**
 * 演练场 · 自称总数 ≠ 可采行数（pattern E3）。
 *
 * 标题写「共 claimed 条评论」，但列表最多只能加载 shown 行。首批 perBatch 行直接在 HTML 里；
 * 之后每次滚到接近底部就追加 perBatch 行（中间隔 250 ms，模拟网络请求）。总数封顶在 shown：
 * 到顶后不再追加，也没有「到底」文案、没有加载指示，和正常的无限滚动长得一模一样。
 *
 * 正确的采集结果是 shown 行（expectedRows）。claimed 可能含回复或未开放的评论，
 * 不能拿它当「采集没采全」或「采全了」的证据，这正是 E3 要测的。
 *
 * 数据行是 li.comment，文案以「评论 」开头。标题是 h1，不在列表里，rowMatch 不会误选它。
 *
 * 续载靠 window 的 scroll 事件，所以页面必须能滚动，而且每次续载后滚动位置要能继续后移：
 * - body 底部留 padding-bottom: 100vh，文档高度恒大于视口，任何窗口高度下首批都能滚动（不会「视口够高就停在首批」）。
 * - 列表随续载增长，body.scrollHeight 也随之单调增加（padding 本身是固定的 100vh），「滚到底」的每一轮（滚到 body.scrollHeight）都能把位置往后推，scroll 事件才会再次触发。
 * 不能改用 min-height：内容没超过 min-height 前 body.scrollHeight 不变，滚动位置不再动，续载会在中途停住
 * （Chromium 实测：视口 1280x900 时停在 40 行）。
 *
 * query（越界值夹到范围内、非法值回落到默认，与其他演练场路由一致；没有页码参数，因此没有 404 分支）：
 * - shown：实际可采的行数（默认 123，1–500）
 * - claimed：标题自称的总数（默认 160，1–1000）
 * - perBatch：每次续载追加的行数（默认 20，1–100）
 */

const LOAD_LATENCY_MS = 250
/** 距离底部多少像素以内算「接近底部」，会触发续载。 */
const NEAR_BOTTOM_PX = 300

/** 首批 HTML 里的行。脚本里的 commentRow 产出同样的标记，测试会逐字比对两者。 */
function commentRow(index: number): string {
  return `<li class="comment"><span class="name">评论 ${index}</span><span class="text">第 ${index} 条评论的内容。</span></li>`
}

export async function GET(request: NextRequest): Promise<NextResponse> {
  const blocked = playgroundBlocked()
  if (blocked) return blocked

  const query = request.nextUrl.searchParams
  const shown = intParam(query.get('shown'), 123, 1, 500)
  const claimed = intParam(query.get('claimed'), 160, 1, 1000)
  const perBatch = intParam(query.get('perBatch'), 20, 1, 100)

  const firstBatch = Math.min(perBatch, shown)
  const rows = Array.from({ length: firstBatch }, (_, index) => commentRow(index + 1)).join('\n')
  const body = `<h1>共 ${claimed} 条评论</h1>
<ul id="list">
${rows}
</ul>`

  const config = JSON.stringify({
    shown,
    perBatch,
    loaded: firstBatch,
    latencyMs: LOAD_LATENCY_MS,
    nearBottomPx: NEAR_BOTTOM_PX,
  })
  // 续载只看 window 的滚动位置；到达 shown 之后任何滚动都不再追加，也不写任何文案。
  const script = `
(function () {
  var config = ${config};
  var list = document.getElementById('list');
  var loaded = config.loaded;
  var busy = false;

  function commentRow(n) {
    return '<li class="comment"><span class="name">评论 ' + n + '</span><span class="text">第 ' + n + ' 条评论的内容。</span></li>';
  }

  function appendBatch() {
    var count = Math.min(config.perBatch, config.shown - loaded);
    var html = '';
    for (var i = 0; i < count; i++) {
      loaded++;
      html += commentRow(loaded);
    }
    list.insertAdjacentHTML('beforeend', html);
  }

  function nearBottom() {
    return window.innerHeight + window.scrollY >= document.documentElement.scrollHeight - config.nearBottomPx;
  }

  window.addEventListener('scroll', function () {
    if (busy || loaded >= config.shown || !nearBottom()) return;
    busy = true;
    setTimeout(function () {
      appendBatch();
      busy = false;
    }, config.latencyMs);
  }, { passive: true });
})();
`

  return htmlResponse(
    renderShell('评论列表', body, {
      // body 底部 padding 100vh：文档恒大于视口；续载追加的行让文档高度随之增长（见文件头注释）。
      style: 'body { padding-bottom: 100vh; } .comment { display: flex; gap: 16px; padding: 8px 0; border-bottom: 1px solid #eee; } h1 { font-size: 18px; margin: 0 0 12px; }',
      script,
    })
  )
}
