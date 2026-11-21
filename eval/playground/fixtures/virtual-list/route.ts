import { NextRequest, NextResponse } from '../_lib/next-shim'

import { htmlResponse, intParam, itemRow, playgroundBlocked, renderShell } from '../_lib/shell'

/**
 * 演练场 · 虚拟列表（pattern A2）。
 *
 * 视口固定 400px、overflow:auto；里面的 #spacer 撑开总高度 total × itemHeight，
 * 只挂载当前位置附近的若干行 li.row。起点 = floor(scrollTop / itemHeight)，夹到 [0, total - 挂载行数]。
 * 滚动时脚本整段回收旧行、按新起点重渲染，和真实虚拟列表一样：DOM 里任一时刻只有一小段行。
 *
 * query：
 * - total：总行数（默认 200，1–1000）
 * - window：同时挂载的行数（默认 10，1–50）。视口放得下的行数是 ceil(400 / itemHeight)，
 *   挂载行数至少抬到这个值：否则列表尾部的行永远滚不到、挂不上，mock 本身就坏了。
 * - itemHeight：每行高度像素（默认 40，20–80）
 *
 * 陷阱：检测那一刻只看得到首屏的前 window 行。正确采集必须边滚边累计，
 * 且每步滚动不超过 挂载行数 × itemHeight 像素，否则中间的行会被跳过。
 * 越界参数由 intParam 夹到范围内，不返回 404（这个页面没有页码）。
 */
const VIEWPORT_PX = 400

export async function GET(request: NextRequest): Promise<NextResponse> {
  const blocked = playgroundBlocked()
  if (blocked) return blocked

  const query = request.nextUrl.searchParams
  const total = intParam(query.get('total'), 200, 1, 1000)
  const windowRows = intParam(query.get('window'), 10, 1, 50)
  const itemHeight = intParam(query.get('itemHeight'), 40, 20, 80)
  const mountedRows = Math.max(windowRows, Math.ceil(VIEWPORT_PX / itemHeight))

  const initialRows = Array.from({ length: Math.min(total, mountedRows) }, (_, index) =>
    itemRow(index + 1, 'row')
  ).join('\n')
  const body = `<h1>商品列表（虚拟滚动）</h1>
<div id="viewport">
<div id="spacer">
<ul id="rows">
${initialRows}
</ul>
</div>
</div>`

  const style = [
    `#viewport { position: relative; height: ${VIEWPORT_PX}px; overflow: auto; border: 1px solid #ccc; }`,
    `#spacer { position: relative; height: ${total * itemHeight}px; }`,
    '#rows { position: absolute; top: 0; left: 0; right: 0; margin: 0; padding: 0; }',
    `.row { display: flex; justify-content: space-between; align-items: center; box-sizing: border-box; height: ${itemHeight}px; padding: 0 12px; border-bottom: 1px solid #eee; }`,
  ].join(' ')

  const config = JSON.stringify({ total, mountedRows, itemHeight })
  const script = `
(function () {
  var cfg = ${config};
  var viewport = document.getElementById('viewport');
  var rows = document.getElementById('rows');
  var shownStart = 0;

  function startFor(scrollTop) {
    var last = Math.max(0, cfg.total - cfg.mountedRows);
    return Math.min(last, Math.max(0, Math.floor(scrollTop / cfg.itemHeight)));
  }

  function makeRow(n) {
    var li = document.createElement('li');
    li.className = 'row';
    var title = document.createElement('span');
    title.className = 'title';
    title.textContent = '商品 ' + n;
    var price = document.createElement('span');
    price.className = 'price';
    price.textContent = '¥' + (100 + n);
    li.appendChild(title);
    li.appendChild(price);
    return li;
  }

  function render(start) {
    var end = Math.min(cfg.total, start + cfg.mountedRows);
    rows.textContent = '';
    rows.style.top = start * cfg.itemHeight + 'px';
    for (var index = start; index < end; index++) {
      rows.appendChild(makeRow(index + 1));
    }
    shownStart = start;
  }

  viewport.addEventListener('scroll', function () {
    var start = startFor(viewport.scrollTop);
    if (start !== shownStart) render(start);
  });
})();
`

  return htmlResponse(renderShell('商品列表（虚拟滚动）', body, { style, script }))
}
