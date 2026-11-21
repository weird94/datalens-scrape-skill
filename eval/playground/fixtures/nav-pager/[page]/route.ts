import { NextRequest, NextResponse } from '../../_lib/next-shim'

import { htmlResponse, intParam, itemRow, playgroundBlocked, renderShell } from '../../_lib/shell'

/**
 * 演练场 · 整页跳转式翻页（pattern D5）。
 *
 * 「下一页」是普通 <a href>，点击后整页导航（不是 JS 切换）。列表行不在首屏 HTML 里，
 * 由脚本在 lateMs 毫秒后才插入，而且每页的容器 class 不同（result-list-p<N>），
 * 所以跳转后立刻去找旧容器会失败（B 站搜索、头条搜索的形状）。
 *
 * query：
 * - pages：总页数（默认 6，1–50）
 * - perPage：每页行数（默认 10，1–50）
 * - lateMs：行晚渲染的毫秒数（默认 800，0–5000）
 */
const BASE = '/dev-fixtures/playground/nav-pager'

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ page: string }> }
): Promise<NextResponse> {
  const blocked = playgroundBlocked()
  if (blocked) return blocked

  const { page: pageParam } = await params
  const query = request.nextUrl.searchParams
  const pages = intParam(query.get('pages'), 6, 1, 50)
  const perPage = intParam(query.get('perPage'), 10, 1, 50)
  const lateMs = intParam(query.get('lateMs'), 800, 0, 5000)
  const page = Number.parseInt(pageParam, 10)
  if (!Number.isInteger(page) || page < 1 || page > pages) {
    return new NextResponse('Not found', { status: 404 })
  }

  const rows = Array.from({ length: perPage }, (_, index) => itemRow((page - 1) * perPage + index + 1)).join('\n')
  const nextLink =
    page < pages
      ? `<a class="next" href="${BASE}/${page + 1}?${query.toString()}">下一页</a>`
      : '<span class="next-disabled">已是最后一页</span>'

  // 晚渲染的容器：class 带页码，首屏 HTML 里没有行
  const script = `
setTimeout(function () {
  var slot = document.getElementById('slot');
  slot.innerHTML = '<ul class="result-list-p${page}">${rows.replace(/'/g, "\\'").replace(/\n/g, '')}</ul>';
}, ${lateMs});
`

  const body = `<h1>搜索结果 第 ${page} / ${pages} 页</h1>
<div id="slot"><p class="loading">加载中…</p></div>
<div class="pager">${nextLink}</div>`

  return htmlResponse(renderShell(`搜索结果 第${page}页`, body, { script }))
}
