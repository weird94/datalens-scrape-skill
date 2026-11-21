import { NextRequest, NextResponse } from '../../_lib/next-shim'

import { htmlResponse, intParam, itemRow, playgroundBlocked, renderShell } from '../../_lib/shell'

/**
 * 演练场 · 数字页码分页器（pattern D7 / D12 / E1）。
 *
 * query：
 * - pages：总页数（默认 12，1–50）
 * - perPage：每页行数（默认 10，1–50）
 * - arrowOnly：1 = 箭头只有图标没有文字（D7 的形状）；0 = 带「下一页」文字
 *
 * 末页的「下一页」箭头保留且不置灰，点了原地不动（D12）。分页器只显示「1 2 3 … N」这样的窗口，
 * 不是完整列表（同一种形状，窗口会滑动）。翻页是普通整页 <a href> 导航，不是 JS 切换。
 */
const BASE = '/dev-fixtures/playground/numbered-pager'

function pagerHtml(page: number, pages: number, query: URLSearchParams, arrowOnly: boolean): string {
  const href = (target: number) => `${BASE}/${target}?${query.toString()}`
  const numbers = pages <= 6 ? Array.from({ length: pages }, (_, index) => index + 1) : [1, 2, 3, pages]
  const numberLinks = numbers
    .map((number) =>
      number === page
        ? `<span class="current">${number}</span>`
        : `<a href="${href(number)}">${number}</a>`
    )
    .join(' ')
  const ellipsis = pages > 6 ? '<span class="ellipsis">…</span>' : ''
  // 末页的箭头仍是链接，指向自己：点了不跳也不报错（D12）
  const nextTarget = page < pages ? href(page + 1) : href(page)
  const arrow = `<a class="arrow" href="${nextTarget}"><svg width="12" height="12" viewBox="0 0 12 12"><path d="M4 2l4 4-4 4" stroke="currentColor" fill="none"/></svg>${arrowOnly ? '' : '<span>下一页</span>'}</a>`
  return `<div class="pager">${numberLinks} ${ellipsis} ${arrow}</div>`
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ page: string }> }
): Promise<NextResponse> {
  const blocked = playgroundBlocked()
  if (blocked) return blocked

  const { page: pageParam } = await params
  const query = request.nextUrl.searchParams
  const pages = intParam(query.get('pages'), 12, 1, 50)
  const perPage = intParam(query.get('perPage'), 10, 1, 50)
  const arrowOnly = intParam(query.get('arrowOnly'), 1, 0, 1) === 1
  const page = Number.parseInt(pageParam, 10)
  if (!Number.isInteger(page) || page < 1 || page > pages) {
    return new NextResponse('Not found', { status: 404 })
  }

  const rows = Array.from({ length: perPage }, (_, index) => itemRow((page - 1) * perPage + index + 1)).join('\n')
  const body = `<h1>商品列表 第 ${page} / ${pages} 页</h1>
<ul id="list">
${rows}
</ul>
${pagerHtml(page, pages, new URLSearchParams(query), arrowOnly)}`

  return htmlResponse(
    renderShell(`商品列表 第${page}页`, body, {
      style: '.pager { margin-top: 16px; display: flex; gap: 8px; align-items: center; } .pager .current { font-weight: bold; } .arrow { display: inline-flex; gap: 4px; align-items: center; padding: 4px 8px; border: 1px solid #333; }',
    })
  )
}
