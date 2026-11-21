import { NextRequest, NextResponse } from '../_lib/next-shim'

import { htmlResponse, intParam, playgroundBlocked, renderShell } from '../_lib/shell'

/**
 * 演练场 · 合并单元格表格（pattern C5）。
 *
 * query：
 * - groups：分组数（默认 5，1–20）
 * - perGroup：每组行数，也是分组单元格的 rowspan（默认 4，1–10）
 *
 * 表格三列：分组、商品、价格。每组第一行的分组单元格 rowspan = perGroup，
 * 同组其余行只有「商品」「价格」两个单元格。
 *
 * 陷阱：按行内「第 i 个单元格」取值（分组 = 0、商品 = 1、价格 = 2）时，同组后续行的第 0 个单元格
 * 其实是商品、第 1 个是价格，于是「商品」列读到价格、「价格」列读到空。行数不受影响，只有列会错位。
 *
 * 超出上下界的 query 不返回 404，由 intParam 夹到上下界（同 shell 的约定）。
 */

const STYLE =
  'table.grid { border-collapse: collapse; margin-top: 12px; } ' +
  '.grid th, .grid td { border: 1px solid #ddd; padding: 6px 12px; text-align: left; } ' +
  '.grid td.group { background: #fafafa; vertical-align: middle; }'

function tableHtml(groups: number, perGroup: number): string {
  const rows: string[] = []
  for (let group = 1; group <= groups; group += 1) {
    for (let index = 0; index < perGroup; index += 1) {
      const itemNumber = (group - 1) * perGroup + index + 1
      // 只有每组第一行带分组单元格；后续行没有这个单元格，列位置由 rowspan 撑住
      const groupCell = index === 0 ? `<td class="group" rowspan="${perGroup}">商品分类 ${group}</td>` : ''
      rows.push(
        `<tr class="row">${groupCell}<td class="title">商品 ${itemNumber}</td><td class="price">¥${100 + itemNumber}</td></tr>`
      )
    }
  }
  return `<table class="grid">
<thead><tr><th>分组</th><th>商品</th><th>价格</th></tr></thead>
<tbody>
${rows.join('\n')}
</tbody>
</table>`
}

export async function GET(request: NextRequest): Promise<NextResponse> {
  const blocked = playgroundBlocked()
  if (blocked) return blocked

  const query = request.nextUrl.searchParams
  const groups = intParam(query.get('groups'), 5, 1, 20)
  const perGroup = intParam(query.get('perGroup'), 4, 1, 10)

  const body = `<h1>商品分类表</h1>
${tableHtml(groups, perGroup)}`

  return htmlResponse(renderShell('商品分类表', body, { style: STYLE }))
}
