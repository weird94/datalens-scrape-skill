import { NextResponse } from '../_lib/next-shim'

import { playgroundBlocked, renderShell } from '../_lib/shell'

/**
 * 演练场 · 403 拦截页（pattern F2）。
 *
 * 真站的形状：整页直接返回 403，页面上只有一段「访问被拒绝」的提示，没有任何列表项，也没有重试按钮。
 * 采集器若只看行数，会把它读成「0 行、没有更多」，这与真的空结果分不开；
 * 所以这里的 stopSignal 落在正文文案上：页面处于拦截状态，而不是空结果。
 *
 * 没有动态段，也没有 query 参数。HTTP 状态固定 403（生产环境仍 404）。
 * 可采行数 = 0。
 *
 * 对应 case：eval/playground/cases/F02-001。
 */

const TITLE = '访问被拒绝'
const NOTICE = '访问被拒绝（403）：请求过于频繁或来源受限。'

export function GET(): NextResponse {
  const blocked = playgroundBlocked()
  if (blocked) return blocked

  const body = `<h1>${TITLE}</h1>
<p class="notice">${NOTICE}</p>`

  return new NextResponse(renderShell(TITLE, body), {
    status: 403,
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'no-store',
    },
  })
}
