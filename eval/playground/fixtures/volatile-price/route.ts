import { NextRequest, NextResponse } from '../_lib/next-shim'

import { htmlResponse, intParam, playgroundBlocked, renderShell } from '../_lib/shell'

/**
 * 演练场 · 易变 class 的价格块，有折扣的行多一个划线原价（pattern C3）。
 *
 * query：
 * - rows：总行数（默认 20，1–50）
 * - discountEvery：每隔几行是折扣行（默认 3，2–10）。第 discountEvery、2×discountEvery… 行（从 1 起算）是折扣行。
 *
 * 形状：
 * - 每行的价格块 class 是哈希风格的 css-<n>，每次构建都会变，没有语义，不能拿来当选择器。
 * - 无折扣行：价格块的第一个子 div 是现价「¥n」。
 * - 折扣行：价格块的第一个子 div 是划线原价「¥(n+50)」，第二个子 div 才是现价「¥n」。
 *
 * 陷阱：class 不稳定时只能退回位置选择器。`li.row > div > div:first-child` 在折扣行上取到的是划线原价。
 * 正确做法是取「没有划线」的那个子 div：它不依赖位置，也不依赖哈希 class。
 */
const STYLE = `.head, .row { display: flex; gap: 16px; align-items: center; padding: 8px 0; border-bottom: 1px solid #eee; }
.head { font-weight: 600; color: #666; }
.row > span { flex: 1; }
.row > div { display: flex; gap: 8px; }`

/** 哈希风格的类名：确定性（同一行每次渲染一致），行与行之间看不出规律。 */
function hashedClass(seed: number): string {
  return `css-${(Math.imul(seed, 2654435761) >>> 0).toString(36)}`
}

function rowHtml(itemNumber: number, discounted: boolean): string {
  const title = `<span>商品 ${itemNumber}</span>`
  const current = `<div>¥${itemNumber}</div>`
  // 折扣行：第一个子 div 是划线原价，第二个子 div 才是现价
  const original = `<div style="text-decoration:line-through;color:#999">¥${itemNumber + 50}</div>`
  const prices = discounted ? `${original}${current}` : current
  return `<li class="row">${title}<div class="${hashedClass(itemNumber)}">${prices}</div></li>`
}

export async function GET(request: NextRequest): Promise<NextResponse> {
  const blocked = playgroundBlocked()
  if (blocked) return blocked

  const query = request.nextUrl.searchParams
  const rows = intParam(query.get('rows'), 20, 1, 50)
  const discountEvery = intParam(query.get('discountEvery'), 3, 2, 10)

  const items = Array.from({ length: rows }, (_, index) => {
    const itemNumber = index + 1
    return rowHtml(itemNumber, itemNumber % discountEvery === 0)
  }).join('\n')

  const body = `<h1>商品列表</h1>
<div class="head"><span>商品</span><span>现价</span></div>
<ul class="list">
${items}
</ul>`

  return htmlResponse(renderShell('商品列表（价格块哈希 class）', body, { style: STYLE }))
}
