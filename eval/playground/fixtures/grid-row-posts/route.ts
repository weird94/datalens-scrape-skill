import { NextRequest, NextResponse } from '../_lib/next-shim'

import { htmlResponse, intParam, playgroundBlocked, renderShell } from '../_lib/shell'

/**
 * 演练场 · 网格按行分组、行里只有卡片（pattern B6，case B06-001 / B06-002）。
 *
 * 账号主页的帖子网格：容器下每个「行」元素装着 cols 张卡片，卡片只有一个帖子链接和一张封面图，
 * 没有任何可见文字。识别会选中「行」（同构的兄弟元素），分析得到的主行没有字段，
 * 卡片是挂在行下面的嵌套列表。数据行应该是卡片（每张卡一行：链接 + 封面图），不是行。
 *
 * 形状来自 2026-11-03 在一个图片社交平台账号主页上的复现（主页帖子网格 0 行），
 * 类名、属性、文案都不是那个站的。
 *
 * query：
 * - posts：卡片总数（默认 12，1–60）；最后一行可以不满
 * - cols：每行几张（默认 3，2–6）
 * - classes：semantic（默认，语义类名）或 hash（无语义短哈希，留出集）
 */

interface ClassSet {
  grid: string
  row: string
  cell: string
  thumb: string
}

const CLASS_SETS: Record<'semantic' | 'hash', ClassSet> = {
  semantic: { grid: 'post-grid', row: 'grid-row', cell: 'grid-cell', thumb: 'thumb' },
  hash: { grid: 'h3k a9q', row: 'x7d p0m w2c', cell: 'r5t z1v', thumb: 'n8e' },
}

/** 每张卡一张 240×240 的 SVG 封面（不能用 1×1 占位图：采集把 1×1 当成没加载的空图）。 */
function coverSrc(index: number): string {
  const hue = (index * 47) % 360
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="240" height="240"><rect width="240" height="240" fill="hsl(${hue},55%,60%)"/></svg>`
  return `data:image/svg+xml,${encodeURIComponent(svg)}#post-${index}`
}

function firstClass(classes: string): string {
  return classes.split(' ')[0] ?? classes
}

function styleFor(set: ClassSet, cols: number): string {
  return `
.${firstClass(set.grid)} { display: flex; flex-direction: column; gap: 4px; max-width: 720px; }
.${firstClass(set.row)} { display: grid; grid-template-columns: repeat(${cols}, 1fr); gap: 4px; }
.${firstClass(set.cell)} { aspect-ratio: 1 / 1; background: #eee; }
.${firstClass(set.cell)} a { display: block; width: 100%; height: 100%; }
.${firstClass(set.thumb)} { width: 100%; height: 100%; object-fit: cover; }
`
}

function cellHtml(set: ClassSet, index: number): string {
  // 卡片只有链接 + 封面图：没有文字，img 的 alt 也是空的
  return `<div class="${set.cell}"><a href="/dev-fixtures/playground/grid-row-posts/p/${index}/" role="link" tabindex="0"><img class="${set.thumb}" src="${coverSrc(index)}" alt="" width="240" height="240"></a></div>`
}

export async function GET(request: NextRequest): Promise<NextResponse> {
  const blocked = playgroundBlocked()
  if (blocked) return blocked

  const params = request.nextUrl.searchParams
  const posts = intParam(params.get('posts'), 12, 1, 60)
  const cols = intParam(params.get('cols'), 3, 2, 6)
  const set = CLASS_SETS[params.get('classes') === 'hash' ? 'hash' : 'semantic']

  const rows: string[] = []
  for (let start = 1; start <= posts; start += cols) {
    const cells: string[] = []
    for (let index = start; index < start + cols && index <= posts; index += 1) {
      cells.push(cellHtml(set, index))
    }
    rows.push(`<div class="${set.row}">${cells.join('')}</div>`)
  }

  const body = `<header><h1>riverside.town</h1><p>${posts} posts</p></header>
<main><div class="${set.grid}">${rows.join('')}</div></main>`

  return htmlResponse(renderShell('Posts grid', body, { style: styleFor(set, cols) }))
}
