import { NextRequest, NextResponse } from '../_lib/next-shim'

import { htmlResponse, intParam, playgroundBlocked, renderShell } from '../_lib/shell'

/**
 * 演练场 · 段落直接持有文本（pattern C9）。
 *
 * 正文区里每个 <p> 都是一个段落，但段落的文字有两种放法：
 * - 前 withSpan 段：文字包在 <span> 里（p > span），和只认 span 的选择器匹配得上；
 * - 其余段落：文字直接放在 <p> 里，p 没有任何子元素（p 的唯一文本节点）。
 *
 * 陷阱：只认 `div.content p span` 的选择器只能拿到前 withSpan 段，其余段落整段丢失。
 * 静态 HTML 无脚本，行数本身没有问题，丢的是「段落直接持有文本」的那部分。
 *
 * query：
 * - paras：段落总数（默认 7，1–20）
 * - withSpan：前 withSpan 段的文字包在 span 里（默认 1，1–20；超过 paras 时等同于全部段落都包 span）
 */

function paragraphText(number: number): string {
  return `段落 ${number}：这里是第 ${number} 段的正文，用来演示段落里的文字是否被完整读到。`
}

function paragraphHtml(number: number, wrapInSpan: boolean): string {
  const text = paragraphText(number)
  return wrapInSpan ? `<p><span>${text}</span></p>` : `<p>${text}</p>`
}

export async function GET(request: NextRequest): Promise<NextResponse> {
  const blocked = playgroundBlocked()
  if (blocked) return blocked

  const query = request.nextUrl.searchParams
  const paras = intParam(query.get('paras'), 7, 1, 20)
  const withSpan = intParam(query.get('withSpan'), 1, 1, 20)

  const paragraphs = Array.from({ length: paras }, (_, index) =>
    paragraphHtml(index + 1, index < withSpan)
  ).join('\n')
  const body = `<h1>正文段落</h1>
<div class="content">
${paragraphs}
</div>`

  return htmlResponse(renderShell('正文段落演示', body, { style: '.content p { margin: 0 0 12px; }' }))
}
