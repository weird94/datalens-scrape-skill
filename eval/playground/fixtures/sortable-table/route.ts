import { NextRequest, NextResponse } from '../_lib/next-shim'

import { htmlResponse, intParam, playgroundBlocked, renderShell } from '../_lib/shell'

/**
 * 演练场 · 可排序表头 + 表下脚注（pattern B3）。
 *
 * query：
 * - rows：数据行数（默认 12，1–50）
 *
 * 表格三列：商品、城市、价格。每个表头 th 的 role 是 "columnheader button"，与真站 Wikipedia 可排序表头的失败选择器 th[role="columnheader button"] 一致（证据：docs/scrape-site-patterns-and-local-playground-2026-10-19.md 的 B3 行，以及 docs/eval-v41-vs-gemini-2026-10-18/ssl.ndjson 的 list-6）。th 里面是一个排序按钮（「按商品排序」「按城市排序」「按价格排序」）。
 * 数据行全在 tbody 里（「商品 n」、城市、价格）。表格下方是 ol.notes，含 rows 条脚注（「注 n：…」）。
 * 页面不声明总行数，正确行数由 rows 决定。
 *
 * 陷阱（三处看起来都像列表项的东西，都会被误选）：
 * - 表头按钮是可点的控件：表头 th 与其中的按钮各 3 个，数量固定，不随 rows 变化。默认 12 行时计数对不上，纯计数能排除它；rows=3 时数量相等，纯计数排除不了，要靠 tbody 限定或 textPrefix「商品 」。
 * - 脚注是 ol 里的 li，条数恰好等于 rows：只看「同构 li 列表」的启发式会选中它，计数对得上，内容却是脚注。
 * - 直接按 tr 数会把表头行一起算进去，得到 rows + 1。
 *
 * 排序按钮没有绑定行为：静态采集不点击，行序和行数都不变。
 */

const CITIES = ['北京', '上海', '广州', '深圳', '杭州', '成都', '武汉', '南京']
const SORT_COLUMNS = ['商品', '城市', '价格']

const STYLE =
  'table.list { border-collapse: collapse; width: 100%; margin-top: 12px; } ' +
  'table.list th, table.list td { padding: 6px 12px; text-align: left; border-bottom: 1px solid #eee; } ' +
  'table.list th button { font: inherit; background: none; border: 0; padding: 0; color: #1a5fb4; cursor: pointer; } ' +
  'ol.notes { margin-top: 16px; padding-left: 20px; color: #666; font-size: 12px; } '

function headerHtml(): string {
  const cells = SORT_COLUMNS.map(
    (name) => `<th role="columnheader button" aria-sort="none"><button type="button">按${name}排序</button></th>`
  ).join('')
  return `<thead><tr>${cells}</tr></thead>`
}

function rowHtml(index: number): string {
  const city = CITIES[(index - 1) % CITIES.length]
  return `<tr class="row"><td>商品 ${index}</td><td>${city}</td><td>¥${100 + index}</td></tr>`
}

function notesHtml(rows: number): string {
  const items = Array.from(
    { length: rows },
    (_, index) => `<li>注 ${index + 1}：价格以统计当天页面显示为准，仅供参考。</li>`
  ).join('\n')
  return `<ol class="notes">\n${items}\n</ol>`
}

export async function GET(request: NextRequest): Promise<NextResponse> {
  const blocked = playgroundBlocked()
  if (blocked) return blocked

  const rows = intParam(request.nextUrl.searchParams.get('rows'), 12, 1, 50)
  const rowsMarkup = Array.from({ length: rows }, (_, index) => rowHtml(index + 1)).join('\n')
  const body = `<h1>商品价格表</h1>
<table class="list">
${headerHtml()}
<tbody>
${rowsMarkup}
</tbody>
</table>
${notesHtml(rows)}`

  return htmlResponse(renderShell('商品价格表', body, { style: STYLE }))
}
