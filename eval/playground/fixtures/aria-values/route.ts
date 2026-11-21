import { NextRequest, NextResponse } from '../_lib/next-shim'

import { htmlResponse, intParam, playgroundBlocked, renderShell } from '../_lib/shell'

/**
 * 演练场 · 值只在 aria-label 里（pattern C6）。
 *
 * 每行有一个标题「商品 n」，和一个「人数」块。人数块里只有一个 svg 图标，没有任何可见文字；
 * 数值只写在该块的 aria-label 上（例如 aria-label="2 位房客"）。人数按行号循环取 1–4。
 *
 * 陷阱：人数块的 innerText 是空的，所以只读可见文本的采集会得到空列；要读 aria-label 才拿得到数字。
 * 行本身是服务端渲染的，静态数行就能数对——陷阱落在列上，不落在行数上。
 *
 * query：
 * - rows：行数（默认 12，1–50）。越界按 intParam 夹到边界，不返回 404（本页没有路径页码）。
 */

function guestCount(rowNumber: number): number {
  return ((rowNumber - 1) % 4) + 1
}

function rowHtml(rowNumber: number): string {
  const guests = guestCount(rowNumber)
  return `<li class="item"><span class="title">商品 ${rowNumber}</span><span class="guests" role="img" aria-label="${guests} 位房客"><svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true"><circle cx="8" cy="5" r="3" fill="currentColor"/><path d="M2 14c0-3 2.7-5 6-5s6 2 6 5z" fill="currentColor"/></svg></span></li>`
}

export async function GET(request: NextRequest): Promise<NextResponse> {
  const blocked = playgroundBlocked()
  if (blocked) return blocked

  const rowCount = intParam(request.nextUrl.searchParams.get('rows'), 12, 1, 50)
  const rows = Array.from({ length: rowCount }, (_, index) => rowHtml(index + 1)).join('\n')
  const body = `<h1>商品列表</h1>
<ul class="list">
${rows}
</ul>`

  return htmlResponse(
    renderShell('商品列表', body, {
      style: '.guests { display: inline-flex; gap: 4px; align-items: center; color: #555; margin-left: auto; }',
    })
  )
}
