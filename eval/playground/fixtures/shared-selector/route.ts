import { NextRequest, NextResponse } from '../_lib/next-shim'

import { htmlResponse, intParam, playgroundBlocked, renderShell } from '../_lib/shell'

/**
 * 演练场 · 多个字段共用同一个选择器（pattern C1）。
 *
 * 每行 li.post 有一个标题「帖子 n」，标题后面是两个计数，它们的 class 完全相同（stat），
 * 只能靠出现的先后顺序区分：
 * - 第一个 span.stat 是「回复 n」（数值 n）
 * - 第二个 span.stat 是「转发 2n」（数值 2n）
 *
 * query：
 * - rows：行数（默认 20，1–50）
 *
 * 陷阱：若「回复」与「转发」两个字段都只按 span.stat 这个 class 取值，两个字段解析到的是同一个
 * 元素（同一个匹配列表的第一项），两列内容会重复；若再按位置错配，两列又会整体错位。
 * 正确做法是在同一行内按位置（第几个 span.stat）区分两个字段，而不是只按 class 取。
 */
const STYLE = `.post { display: flex; gap: 16px; padding: 8px 0; border-bottom: 1px solid #eee; }
.post .stat { color: #555; }`

function postHtml(itemNumber: number): string {
  const title = `<span class="title">帖子 ${itemNumber}</span>`
  const replies = `<span class="stat">回复 ${itemNumber}</span>`
  const reposts = `<span class="stat">转发 ${2 * itemNumber}</span>`
  return `<li class="post">${title}${replies}${reposts}</li>`
}

export async function GET(request: NextRequest): Promise<NextResponse> {
  const blocked = playgroundBlocked()
  if (blocked) return blocked

  const query = request.nextUrl.searchParams
  const rows = intParam(query.get('rows'), 20, 1, 50)

  const items = Array.from({ length: rows }, (_, index) => postHtml(index + 1)).join('\n')

  const body = `<h1>帖子列表</h1>
<ul class="posts">
${items}
</ul>`

  return htmlResponse(renderShell('帖子列表（共用选择器）', body, { style: STYLE }))
}
