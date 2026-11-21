import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

import { NextRequest } from '../_lib/next-shim'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { GET as rowspanTable } from '../rowspan-table/route'

const BASE = 'http://localhost:3008'
const PATH = '/dev-fixtures/playground/rowspan-table'
/** 仓库根下的 cases 目录：用于确认 C05-001 的 expected.json 与路由输出同步。 */
const CASES_URL = new URL('../../cases/', import.meta.url)

/** expectedColumns 的键（表头文字）到单元格 class 的映射：按 class 取值才是正确的列对齐方式。 */
const COLUMN_CLASS: Record<string, string> = { 商品: 'title', 价格: 'price' }

interface MatchSpec {
  selector: string
  textPrefix: string
}

interface ExpectedFile {
  expectedRows: number
  expectedColumns: Record<string, string[]>
  rowMatch: MatchSpec
  naive: { strategy: string; rowMatch: MatchSpec; expectedRows: number }
  trapVerifiedBy: string
}

function readExpected(id: string): ExpectedFile {
  return JSON.parse(readFileSync(fileURLToPath(new URL(`${id}/expected.json`, CASES_URL)), 'utf8')) as ExpectedFile
}

async function fetchTable(query: string): Promise<{ status: number; html: string }> {
  const response = await rowspanTable(new NextRequest(`${BASE}${PATH}${query}`))
  return { status: response.status, html: await response.text() }
}

/** 去标签后的 textContent（与 playground-oracle 的 textContent.trim() 同口径，不补空白）。 */
function textContentOf(fragment: string): string {
  return fragment.replace(/<[^>]+>/g, '').trim()
}

/** oracle 的 `table tr`：页面上所有 tr（含表头）按 textContent 前缀计数。 */
function countTableRows(html: string, textPrefix: string): number {
  return [...html.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/g)].filter((row) =>
    textContentOf(row[1]).startsWith(textPrefix)
  ).length
}

/** `tbody tr td:nth-child(n)`：tbody 里每行第 n 个 td（从 1 起）的文本，逐行返回。 */
function tbodyCellsAtNthChild(html: string, nthChild: number): string[] {
  const tbody = html.slice(html.indexOf('<tbody>'), html.indexOf('</tbody>'))
  return [...tbody.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/g)].flatMap((row) => {
    const cell = [...row[1].matchAll(/<td[^>]*>([^<]*)<\/td>/g)][nthChild - 1]
    return cell ? [cell[1]] : []
  })
}

/** 数据行的 HTML 片段（每段从 <tr class="row"> 开始，到 </tr> 结束）。 */
function dataRowChunks(html: string): string[] {
  return html
    .split('<tr class="row">')
    .slice(1)
    .map((chunk) => chunk.split('</tr>')[0])
}

/** 按行内位置取单元格文本，和 collector 的「第 i 个单元格」取值方式一致。 */
function cellTexts(rowChunk: string): string[] {
  return [...rowChunk.matchAll(/<td[^>]*>([^<]*)<\/td>/g)].map((match) => match[1])
}

/** 近似 innerText：去标签、压空白。 */
function rowText(rowChunk: string): string {
  return rowChunk.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()
}

/** 按 class 取单元格文本（正确的列对齐方式）。 */
function cellByClass(rowChunk: string, className: string): string | null {
  const match = rowChunk.match(new RegExp(`<td class="${className}"[^>]*>([^<]*)</td>`))
  return match ? match[1] : null
}

describe('playground · rowspan-table（C5）', () => {
  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it('默认参数渲染 5 组 × 4 行 = 20 个数据行，表头不是数据行', async () => {
    const { status, html } = await fetchTable('?groups=5&perGroup=4')
    expect(status).toBe(200)
    expect(dataRowChunks(html)).toHaveLength(20)
    // 表头行没有 class="row"，rowMatch 的 textPrefix 也要能把它排除在外
    expect(html).toContain('<thead><tr><th>分组</th><th>商品</th><th>价格</th></tr></thead>')
  })

  it('每组第一行的分组单元格 rowspan = perGroup，同组后续行只剩两个单元格', async () => {
    const { html } = await fetchTable('?groups=5&perGroup=4')
    const rows = dataRowChunks(html)
    rows.forEach((row, position) => {
      const isGroupStart = position % 4 === 0
      if (isGroupStart) {
        expect(row).toContain('<td class="group" rowspan="4">')
        expect(cellTexts(row)).toHaveLength(3)
      } else {
        expect(row).not.toContain('class="group"')
        expect(cellTexts(row)).toHaveLength(2)
      }
    })
  })

  it('陷阱存在：按第 i 个单元格取值时，同组后续行的「商品」列读到价格，「价格」列为空', async () => {
    const { html } = await fetchTable('?groups=5&perGroup=4')
    const rows = dataRowChunks(html)
    // 第 2 行（商品 2）：第 0 格是商品、第 1 格是价格
    const naiveSecond = cellTexts(rows[1])
    expect(naiveSecond[0]).toBe('商品 2')
    expect(naiveSecond[1]).toBe('¥102')
    expect(naiveSecond[2]).toBeUndefined()
    // 第 3 行同理
    const naiveThird = cellTexts(rows[2])
    expect(naiveThird[1]).toBe('¥103')
    expect(naiveThird[2]).toBeUndefined()
  })

  it('按 class 取值时列正确对齐：前 3 个商品与价格', async () => {
    const { html } = await fetchTable('?groups=5&perGroup=4')
    const rows = dataRowChunks(html)
    expect(rows.slice(0, 3).map((row) => cellByClass(row, 'title'))).toEqual(['商品 1', '商品 2', '商品 3'])
    expect(rows.slice(0, 3).map((row) => cellByClass(row, 'price'))).toEqual(['¥101', '¥102', '¥103'])
    // 第 2 组第一行是商品 5
    expect(cellByClass(rows[4], 'title')).toBe('商品 5')
    expect(cellByClass(rows[4], 'price')).toBe('¥105')
  })

  it('textPrefix「商品」区分数据行与表头：所有数据行都以「商品」开头，表头以「分组」开头', async () => {
    const { html } = await fetchTable('?groups=5&perGroup=4')
    const dataRows = dataRowChunks(html)
    expect(dataRows.every((row) => rowText(row).startsWith('商品'))).toBe(true)
    const headerText = rowText(html.match(/<thead>[\s\S]*?<\/thead>/)?.[0] ?? '')
    expect(headerText.startsWith('分组')).toBe(true)
    expect(headerText.startsWith('商品')).toBe(false)
  })

  it('行数随参数变化：groups × perGroup', async () => {
    const wide = await fetchTable('?groups=2&perGroup=7')
    expect(dataRowChunks(wide.html)).toHaveLength(14)
    expect(wide.html).toContain('rowspan="7"')
  })

  it('越界参数不返回 404，由 intParam 夹到上下界', async () => {
    const over = await fetchTable('?groups=99&perGroup=99')
    expect(over.status).toBe(200)
    expect(dataRowChunks(over.html)).toHaveLength(20 * 10)

    const under = await fetchTable('?groups=0&perGroup=0')
    expect(under.status).toBe(200)
    expect(dataRowChunks(under.html)).toHaveLength(1)
  })

  it('非法参数用默认值（5 组 × 4 行）', async () => {
    const { status, html } = await fetchTable('?groups=abc&perGroup=')
    expect(status).toBe(200)
    expect(dataRowChunks(html)).toHaveLength(20)
  })

  it('production 环境返回 404', async () => {
    vi.stubEnv('NODE_ENV', 'production')
    const { status } = await fetchTable('?groups=5&perGroup=4')
    expect(status).toBe(404)
  })

  describe('C05-001 case 与路由输出同步', () => {
    const expected = readExpected('C05-001')
    const query = '?groups=5&perGroup=4'

    it('rowMatch（table tr，textPrefix「商品」）静态计数等于 expectedRows', async () => {
      const { html } = await fetchTable(query)
      expect(countTableRows(html, expected.rowMatch.textPrefix)).toBe(expected.expectedRows)
    })

    it('陷阱：naive「tbody tr td:nth-child(2)」只命中分组首行的商品格，计数等于 naive.expectedRows 且不等于 expectedRows', async () => {
      expect(expected.trapVerifiedBy).toBe('naive')
      const { html } = await fetchTable(query)
      const naiveCount = tbodyCellsAtNthChild(html, 2).filter((text) =>
        text.startsWith(expected.naive.rowMatch.textPrefix)
      ).length
      expect(naiveCount).toBe(expected.naive.expectedRows)
      expect(naiveCount).not.toBe(expected.expectedRows)
    })

    it('expectedColumns 的前三个值与按 class 取值的结果一致', async () => {
      const { html } = await fetchTable(query)
      const headers = [...html.matchAll(/<th>([^<]*)<\/th>/g)].map((match) => match[1])
      const rows = dataRowChunks(html)
      for (const [header, values] of Object.entries(expected.expectedColumns)) {
        expect(headers).toContain(header)
        const className = COLUMN_CLASS[header]
        if (className === undefined) throw new Error(`COLUMN_CLASS 未登记的列: ${header}`)
        expect(rows.slice(0, values.length).map((row) => cellByClass(row, className))).toEqual(values)
      }
    })
  })
})
