import { NextRequest, NextResponse } from '../_lib/next-shim'

import { htmlResponse, intParam, playgroundBlocked, renderShell } from '../_lib/shell'

/**
 * 演练场 · 表格行 class 不一致 + 插入分组行（pattern A4）。
 *
 * query：
 * - rows：数据行数（默认 30，1–100；越界按 intParam 夹到范围内）
 *
 * 形状：
 * - 表头一行；tbody 里是数据行，每行 3 个单元格：商品 n / 城市 / 评分。
 * - 数据行的 class 按 hl / 无 class / muted 三种循环（第 1 行 hl，第 2 行无 class，第 3 行 muted，…）。
 *   按 class 分组时每一组只剩约三分之一的行，结构树被切碎。
 * - 第 10 行之后、第 20 行之后各插入一条 colspan 的分组标题行（「其他相关结果」「另一组标题」）。
 *   分组标题不是数据：单元格数与数据行不同，文案也不以「商品 」开头。
 *   只有后面还有数据行时才插入，分组标题下面没有内容没有意义。
 *
 * 标准答案：数据行数 = rows，分组标题不计入。
 */

const CITIES = ['北京', '上海', '广州', '深圳', '杭州', '成都']

/** 数据行 class 的循环：hl / 无 class / muted。 */
const ROW_CLASS_CYCLE: readonly (string | null)[] = ['hl', null, 'muted']

/** 分组标题：key 是它所在的数据行号（插在该行之后）。 */
const GROUP_TITLES = new Map<number, string>([
  [10, '其他相关结果'],
  [20, '另一组标题'],
])

function dataRow(itemNumber: number): string {
  const rowClass = ROW_CLASS_CYCLE[(itemNumber - 1) % ROW_CLASS_CYCLE.length]
  const attr = rowClass ? ` class="${rowClass}"` : ''
  const city = CITIES[(itemNumber - 1) % CITIES.length]
  const rating = (4 + (itemNumber % 10) / 10).toFixed(1)
  return `<tr${attr}><td>商品 ${itemNumber}</td><td>${city}</td><td>${rating}</td></tr>`
}

function groupRow(title: string): string {
  return `<tr class="group-title"><td colspan="3">${title}</td></tr>`
}

export async function GET(request: NextRequest): Promise<NextResponse> {
  const blocked = playgroundBlocked()
  if (blocked) return blocked

  const rows = intParam(request.nextUrl.searchParams.get('rows'), 30, 1, 100)

  const lines: string[] = []
  for (let itemNumber = 1; itemNumber <= rows; itemNumber++) {
    lines.push(dataRow(itemNumber))
    const title = GROUP_TITLES.get(itemNumber)
    if (title && itemNumber < rows) lines.push(groupRow(title))
  }

  const body = `<h1>结果列表</h1>
<table id="list">
<thead><tr><th>商品</th><th>城市</th><th>评分</th></tr></thead>
<tbody>
${lines.join('\n')}
</tbody>
</table>`

  return htmlResponse(
    renderShell('结果列表', body, {
      style: 'table { border-collapse: collapse; width: 100%; margin-top: 12px; } th, td { padding: 6px 8px; border-bottom: 1px solid #eee; text-align: left; } tr.hl { background: #fff8e1; } tr.muted { color: #999; } tr.group-title td { background: #f5f5f5; font-weight: bold; }',
    })
  )
}
