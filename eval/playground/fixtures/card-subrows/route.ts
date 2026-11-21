import { NextRequest, NextResponse } from '../_lib/next-shim'

import { htmlResponse, intParam, playgroundBlocked, renderShell } from '../_lib/shell'

/**
 * 演练场 · 卡片内的副标题行被当成行（pattern B4）。
 *
 * 页面是一列卡片（ul.cards）：每张卡一个标题（div.title，「卡片 n」），下面三行副标题（div.meta-row：
 * 类型、日期、来源）。真正的数据行是卡片，副标题行只是卡片的一部分；朴素地按 div.meta-row 计数
 * 会拿到 cards × 3 行（卡片内的副标题行被当成行）。
 *
 * 整张卡的文字互不相同（靠日期逐卡递增）；类型与来源只是各自轮流取 3 个值，相邻几张卡可能重复。
 *
 * query：
 * - cards：卡片数（默认 12，1–50）
 */

const TYPES = ['演出', '展览', '讲座'] as const
const SOURCES = ['站点甲', '站点乙', '站点丙'] as const
const STYLE = `
.card { border: 1px solid #ddd; border-radius: 4px; padding: 8px 12px; margin-bottom: 8px; }
.title { font-weight: 600; }
.meta-row { color: #666; font-size: 12px; }
`

function cardHtml(index: number): string {
  const type = TYPES[(index - 1) % TYPES.length]
  const source = SOURCES[(index - 1) % SOURCES.length]
  // 日期从 2026-10-01 起逐卡加一天（UTC），保证每张卡的日期不同
  const date = new Date(Date.UTC(2026, 9, index)).toISOString().slice(0, 10)
  return `<div class="card"><div class="title">卡片 ${index}</div><div class="meta-row">类型：${type}</div><div class="meta-row">日期：${date}</div><div class="meta-row">来源：${source}</div></div>`
}

export async function GET(request: NextRequest): Promise<NextResponse> {
  const blocked = playgroundBlocked()
  if (blocked) return blocked

  const cards = intParam(request.nextUrl.searchParams.get('cards'), 12, 1, 50)
  const items = Array.from({ length: cards }, (_, offset) => cardHtml(offset + 1)).join('')

  const body = `<h1>活动列表</h1>
<ul class="cards">${items}</ul>`

  return htmlResponse(renderShell('活动列表（卡片副标题）', body, { style: STYLE }))
}
