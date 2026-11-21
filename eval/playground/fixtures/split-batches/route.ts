import { NextRequest, NextResponse } from '../_lib/next-shim'

import { htmlResponse, intParam, itemRow, playgroundBlocked, renderShell } from '../_lib/shell'

/**
 * 演练场 · 分两批到达的「加载更多」（pattern D10：每页只采到一部分）。
 *
 * 首屏 perPage 行直接在 HTML 里。#load-more 每点一次，脚本做两件事：
 * 立即追加 floor(perPage * 0.4) 行，剩余行在 splitMs 毫秒之后才追加。
 * 累计到 pages 批（含首屏）后按钮立即被移除，所以「按钮消失」时最后一批的后半段可能还没到。
 *
 * 陷阱：点击后立刻快照只能看到新增的前半批；只数到按钮消失那一刻，行数会少掉最后一批的后半段。
 *
 * 正确的采集方式是：持续点击直到按钮消失，然后等到 DOM 不再变化，再数行。splitMs 只决定后半段晚到多久，
 * 不应该影响正确结果；它的默认值 400 是一个普通的网络延迟量级。
 *
 * query：
 * - pages：总批数，含首屏（默认 3，1–20）。pages=1 时没有按钮，也没有脚本。
 * - perPage：每批行数（默认 10，1–50）
 * - splitMs：每批后半段晚到的延迟毫秒（默认 400，0–3000）
 *
 * 没有页码路径段，因此没有「非法页码 404」分支；越界的数值参数按 intParam 夹到范围内。
 */

/** 每批先到的比例：floor(perPage * 0.4) 行立即追加，其余 splitMs 之后追加。 */
const IMMEDIATE_RATIO = 0.4

function loadMoreScript(perPage: number, pages: number, splitMs: number): string {
  const immediate = Math.floor(perPage * IMMEDIATE_RATIO)
  return `(function () {
  var pages = ${pages};
  var perPage = ${perPage};
  var splitMs = ${splitMs};
  var immediate = ${immediate};
  var batches = 1;
  var nextNo = perPage + 1;
  var list = document.getElementById('list');
  var button = document.getElementById('load-more');

  function rowsHtml(count) {
    var html = '';
    for (var i = 0; i < count; i++) {
      var no = nextNo++;
      html += '<li class="item"><span class="title">商品 ' + no + '</span><span class="price">¥' + (100 + no) + '</span></li>';
    }
    return html;
  }

  button.addEventListener('click', function () {
    batches += 1;
    list.insertAdjacentHTML('beforeend', rowsHtml(immediate));
    var rest = perPage - immediate;
    setTimeout(function () {
      list.insertAdjacentHTML('beforeend', rowsHtml(rest));
    }, splitMs);
    if (batches >= pages) button.remove();
  });
})();`
}

export async function GET(request: NextRequest): Promise<NextResponse> {
  const blocked = playgroundBlocked()
  if (blocked) return blocked

  const query = request.nextUrl.searchParams
  const pages = intParam(query.get('pages'), 3, 1, 20)
  const perPage = intParam(query.get('perPage'), 10, 1, 50)
  const splitMs = intParam(query.get('splitMs'), 400, 0, 3000)

  const rows = Array.from({ length: perPage }, (_, index) => itemRow(index + 1)).join('\n')
  const button =
    pages > 1 ? '\n<div class="more"><button id="load-more" type="button">加载更多</button></div>' : ''
  const body = `<h1>商品列表</h1>
<ul id="list">
${rows}
</ul>${button}`

  return htmlResponse(
    renderShell('商品列表（分批加载）', body, {
      style:
        '.more { margin-top: 16px; } #load-more { padding: 6px 16px; border: 1px solid #333; background: #fff; font: inherit; }',
      script: pages > 1 ? loadMoreScript(perPage, pages, splitMs) : undefined,
    })
  )
}
