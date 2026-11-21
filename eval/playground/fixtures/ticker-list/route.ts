import { NextRequest, NextResponse } from '../_lib/next-shim'

import { htmlResponse, intParam, playgroundBlocked, renderShell } from '../_lib/shell'

/**
 * 演练场 · 首项实时跳动的榜单（pattern D13）。
 *
 * query：
 * - rows：数据行数（默认 20，1–50）
 *
 * 列表 #list 里每一行都是「商品 n」加一个价格。只有第一行的价格单元格带 ticker 类（span.price.ticker），
 * 脚本每 1000 毫秒把它的数值加 1；其余行的价格是静态的。
 *
 * 陷阱：第一行的文本每秒都在变，所以「整个列表的文本指纹」在没有新行的情况下也一直在变。
 * 用指纹判断「有没有新行 / 页面是否稳定」的检测器会判不出停止，只能一直点到上限。
 * 正确的行数只由 rows 决定，与跳动的数值无关。
 *
 * 单页，没有页码参数，因此没有 404 分支；越界的数值参数按 intParam 夹到范围内。
 */

const TICK_MS = 1000

function priceOf(index: number): number {
  return 100 + index
}

function rowHtml(index: number): string {
  // 第一行的价格单元格是 ticker，其余行是静态价格
  const priceClass = index === 1 ? 'price ticker' : 'price'
  return `<li class="item"><span class="title">商品 ${index}</span><span class="${priceClass}">¥${priceOf(index)}</span></li>`
}

function tickerScript(): string {
  return `
(function () {
  var ticker = document.querySelector('#list .ticker');
  if (!ticker) return;
  var value = ${priceOf(1)};
  setInterval(function () {
    value += 1;
    ticker.textContent = '¥' + value;
  }, ${TICK_MS});
})();
`
}

export async function GET(request: NextRequest): Promise<NextResponse> {
  const blocked = playgroundBlocked()
  if (blocked) return blocked

  const rows = intParam(request.nextUrl.searchParams.get('rows'), 20, 1, 50)
  const rowsMarkup = Array.from({ length: rows }, (_, index) => rowHtml(index + 1)).join('\n')
  const body = `<h1>实时榜单</h1>
<ul id="list">
${rowsMarkup}
</ul>`

  return htmlResponse(
    renderShell('实时榜单', body, {
      style: '.price { min-width: 64px; text-align: right; font-variant-numeric: tabular-nums; }',
      script: tickerScript(),
    })
  )
}
