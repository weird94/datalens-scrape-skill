import { NextRequest, NextResponse } from '../_lib/next-shim'

import { htmlResponse, intParam, playgroundBlocked, renderShell } from '../_lib/shell'

/**
 * 演练场 · 同一元素被拆成两层的列表（pattern C2）。
 *
 * query：
 * - rows：总行数（默认 30，1–100）
 * - wrapEvery：每隔几行多一层包装（默认 10，2–20）。第 wrapEvery、2×wrapEvery… 行（从 1 起算）的标题
 *   外面多一层 div.top，并且行内多一个缩略图块；其余行没有这两样。
 *
 * 陷阱：标题在两种深度下都是同一个 a.title，价格在两种深度下都是行的直接子元素。
 * 若按 li > a 这种子选择器取标题，只能取到未包装的行；若再按 li > div > a 另拆一列，
 * 两列各缺一半、合起来才是完整标题。正确做法是用不依赖层级的选择器（如 .title）让同一个字段
 * 在两种深度下都解析到同一个标题，而不是拆成两列。
 */
const STYLE = `.row { display: flex; gap: 16px; align-items: center; padding: 8px 0; border-bottom: 1px solid #eee; }
.row .thumb { display: inline-block; width: 40px; height: 40px; background: #ddd; flex: none; }
.row .top { flex: 1; }
.row .price { color: #b00020; }`

function rowHtml(itemNumber: number, wrapped: boolean): string {
  const title = `<a class="title" href="#item-${itemNumber}">商品 ${itemNumber}</a>`
  const price = `<span class="price">¥${100 + itemNumber}</span>`
  if (!wrapped) {
    return `<li class="row">${title}${price}</li>`
  }
  // 包装行：标题外多一层 div.top，行内多一个缩略图块（不含文字）
  return `<li class="row"><span class="thumb" aria-hidden="true"></span><div class="top">${title}</div>${price}</li>`
}

export async function GET(request: NextRequest): Promise<NextResponse> {
  const blocked = playgroundBlocked()
  if (blocked) return blocked

  const query = request.nextUrl.searchParams
  const rows = intParam(query.get('rows'), 30, 1, 100)
  const wrapEvery = intParam(query.get('wrapEvery'), 10, 2, 20)

  const items = Array.from({ length: rows }, (_, index) => {
    const itemNumber = index + 1
    return rowHtml(itemNumber, itemNumber % wrapEvery === 0)
  }).join('\n')

  const body = `<h1>商品列表</h1>
<ul class="list">
${items}
</ul>`

  return htmlResponse(renderShell('商品列表（包装层混用）', body, { style: STYLE }))
}
