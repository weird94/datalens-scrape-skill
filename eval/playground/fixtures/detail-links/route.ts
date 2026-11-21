import { NextRequest, NextResponse } from '../_lib/next-shim'

import { htmlResponse, intParam, playgroundBlocked, renderShell } from '../_lib/shell'
import { BASE, detailHref, hasNoLink, product } from './products'

/**
 * 演练场 · 列表 → 详情页（pattern H1）：列表页。
 *
 * 商品列表按 ?page= 翻页（a.next 是普通链接），每行是 li.item：标题链接 a.title 指向本 fixture 的详情页
 * （/dev-fixtures/playground/detail-links/<id>），旁边是价格。部分行没有链接（「Coming soon」），
 * 部分链接是死链（详情页 404），见 products.ts。用户要的字段（品牌、SKU、完整描述）只在详情页上。
 *
 * query：
 * - items：商品总数（默认 24，1–60）
 * - perPage：每页条数（默认 8，1–30）
 * - page：页码（默认 1；越界或非数字 404）
 * - lateMs / blockAfter / softBlockAfter / run / flaky：原样带进详情链接，调节详情页（见 [id]/route.ts）
 */

const STYLE = `
.pager { margin-top: 16px; }
.pager .next { display: inline-block; padding: 4px 8px; border: 1px solid #333; }
.soon { color: #888; margin-left: 8px; }
`

function rowHtml(id: number, query: URLSearchParams): string {
  const p = product(id)
  const title = hasNoLink(id)
    ? `<span class="title">${p.name}</span><span class="soon">Coming soon</span>`
    : `<a class="title" href="${detailHref(id, query)}">${p.name}</a>`
  return `<li class="item">${title}<span class="price">${p.price}</span></li>`
}

export async function GET(request: NextRequest): Promise<NextResponse> {
  const blocked = playgroundBlocked()
  if (blocked) return blocked

  const query = request.nextUrl.searchParams
  const items = intParam(query.get('items'), 24, 1, 60)
  const perPage = intParam(query.get('perPage'), 8, 1, 30)
  const pages = Math.ceil(items / perPage)
  const pageParam = query.get('page')
  const page = pageParam === null ? 1 : Number(pageParam)
  if (!Number.isInteger(page) || page < 1 || page > pages) {
    return new NextResponse('Not found', { status: 404 })
  }

  const first = (page - 1) * perPage + 1
  const last = Math.min(items, page * perPage)
  const rows = Array.from({ length: last - first + 1 }, (_, index) => rowHtml(first + index, query)).join('\n')
  const nextQuery = new URLSearchParams(query)
  nextQuery.set('page', String(page + 1))
  const pager = page < pages ? `<div class="pager"><a class="next" href="${BASE}?${nextQuery.toString()}">Next page</a></div>` : ''
  const body = `<h1>Products · page ${page} of ${pages}</h1>
<ul class="products">
${rows}
</ul>
${pager}`
  return htmlResponse(renderShell(`Products, page ${page}`, body, { style: STYLE }))
}
