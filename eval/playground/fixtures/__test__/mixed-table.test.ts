import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

import { NextRequest } from '../_lib/next-shim'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { GET as mixedTable } from '../mixed-table/route'

const BASE = 'http://localhost:3008'

/** A04-001 的标准答案：eval/playground/cases/A04-001/expected.json。 */
const A04_EXPECTED_PATH = fileURLToPath(
  new URL('../../cases/A04-001/expected.json', import.meta.url)
)

interface A04Expected {
  expectedRows: number
  expectedColumns: Record<string, string[]>
  rowMatch: { selector: string; textPrefix: string }
  naive: { expectedRows: number; rowMatch: { selector: string; textPrefix: string } }
}

function loadA04Expected(): A04Expected {
  return JSON.parse(readFileSync(A04_EXPECTED_PATH, 'utf8')) as A04Expected
}

async function fetchTable(path: string): Promise<{ status: number; html: string }> {
  const response = await mixedTable(new NextRequest(`${BASE}${path}`))
  return { status: response.status, html: await response.text() }
}

/** 只看 tbody 里面的行（表头不算）。 */
function tbodyOf(html: string): string {
  const start = html.indexOf('<tbody>')
  const end = html.indexOf('</tbody>')
  return start === -1 || end === -1 ? '' : html.slice(start, end)
}

function countMatches(html: string, pattern: RegExp): number {
  return (html.match(pattern) ?? []).length
}

/** 按 rowMatch 的语义数行：tbody 里的 tr（可限定 class），去掉标签后的文本以 textPrefix 开头。 */
function countTbodyRows(html: string, textPrefix: string, className?: string): number {
  const rows = tbodyOf(html).match(/<tr[^>]*>[\s\S]*?<\/tr>/g) ?? []
  return rows.filter((row) => {
    if (className && !row.startsWith(`<tr class="${className}">`)) return false
    return row.replace(/<[^>]+>/g, '').trim().startsWith(textPrefix)
  }).length
}

afterEach(() => {
  vi.unstubAllEnvs()
})

describe('playground · mixed-table（A4）', () => {
  it('默认 30 行数据；tbody 里另有 2 条分组标题，共 32 个 tr（陷阱存在）', async () => {
    const { status, html } = await fetchTable('/dev-fixtures/playground/mixed-table?rows=30')
    expect(status).toBe(200)
    expect(countMatches(html, /<td>商品 \d+<\/td>/g)).toBe(30)
    expect(countMatches(html, /colspan="3"/g)).toBe(2)
    expect(countMatches(tbodyOf(html), /<tr[ >]/g)).toBe(32)
  })

  it('数据行的 class 按 hl / 无 / muted 循环，每种各 10 行', async () => {
    const { html } = await fetchTable('/dev-fixtures/playground/mixed-table?rows=30')
    expect(countMatches(html, /<tr class="hl"><td>商品 /g)).toBe(10)
    expect(countMatches(html, /<tr><td>商品 /g)).toBe(10)
    expect(countMatches(html, /<tr class="muted"><td>商品 /g)).toBe(10)
  })

  it('分组标题插在第 10 行与第 20 行之后，不插在数据行之间的其他位置', async () => {
    const { html } = await fetchTable('/dev-fixtures/playground/mixed-table?rows=30')
    const row10 = html.indexOf('<td>商品 10</td>')
    const row11 = html.indexOf('<td>商品 11</td>')
    const row20 = html.indexOf('<td>商品 20</td>')
    const row21 = html.indexOf('<td>商品 21</td>')
    const titleA = html.indexOf('其他相关结果')
    const titleB = html.indexOf('另一组标题')
    expect(row10).toBeLessThan(titleA)
    expect(titleA).toBeLessThan(row11)
    expect(row20).toBeLessThan(titleB)
    expect(titleB).toBeLessThan(row21)
    expect(html).toContain('<tr class="group-title"><td colspan="3">其他相关结果</td></tr>')
  })

  it('前三行的城市与评分按固定规则生成', async () => {
    const { html } = await fetchTable('/dev-fixtures/playground/mixed-table?rows=30')
    expect(html).toContain('<tr class="hl"><td>商品 1</td><td>北京</td><td>4.1</td></tr>')
    expect(html).toContain('<tr><td>商品 2</td><td>上海</td><td>4.2</td></tr>')
    expect(html).toContain('<tr class="muted"><td>商品 3</td><td>广州</td><td>4.3</td></tr>')
  })

  it('A04-001 的 expected.json 与渲染一致：rowMatch 数出 expectedRows，naive 选择器数出 naive.expectedRows，expectedColumns 前 3 行逐列相符', async () => {
    const expected = loadA04Expected()
    const { html } = await fetchTable('/dev-fixtures/playground/mixed-table?rows=30')

    expect(expected.rowMatch.selector).toBe('tbody tr')
    expect(countTbodyRows(html, expected.rowMatch.textPrefix)).toBe(expected.expectedRows)

    expect(expected.naive.rowMatch.selector).toBe('tbody tr.hl')
    expect(countTbodyRows(html, expected.naive.rowMatch.textPrefix, 'hl')).toBe(expected.naive.expectedRows)

    const headers = (html.match(/<th>[^<]*<\/th>/g) ?? []).map((cell) => cell.slice('<th>'.length, -'</th>'.length))
    const dataRows = Array.from(
      html.matchAll(/<tr(?: class="[^"]*")?><td>([^<]*)<\/td><td>([^<]*)<\/td><td>([^<]*)<\/td><\/tr>/g),
      (match) => [match[1], match[2], match[3]]
    )
    for (const [column, values] of Object.entries(expected.expectedColumns)) {
      const index = headers.indexOf(column)
      expect(index, `表头应有「${column}」`).toBeGreaterThanOrEqual(0)
      expect(dataRows.slice(0, values.length).map((row) => row[index])).toEqual(values)
    }
  })

  it('rows=5 没有分组标题；rows=20 只有第 10 行之后的一条（第 20 行之后没有内容，不插入）', async () => {
    const five = await fetchTable('/dev-fixtures/playground/mixed-table?rows=5')
    expect(countMatches(five.html, /<td>商品 \d+<\/td>/g)).toBe(5)
    expect(countMatches(five.html, /colspan="3"/g)).toBe(0)

    const twenty = await fetchTable('/dev-fixtures/playground/mixed-table?rows=20')
    expect(countMatches(twenty.html, /<td>商品 \d+<\/td>/g)).toBe(20)
    expect(countMatches(twenty.html, /colspan="3"/g)).toBe(1)
    expect(twenty.html).not.toContain('另一组标题')
  })

  it('rows 越界按 intParam 夹到 [1, 100]，非法值用默认 30', async () => {
    const huge = await fetchTable('/dev-fixtures/playground/mixed-table?rows=500')
    expect(huge.status).toBe(200)
    expect(countMatches(huge.html, /<td>商品 \d+<\/td>/g)).toBe(100)

    const zero = await fetchTable('/dev-fixtures/playground/mixed-table?rows=0')
    expect(countMatches(zero.html, /<td>商品 \d+<\/td>/g)).toBe(1)

    const junk = await fetchTable('/dev-fixtures/playground/mixed-table?rows=abc')
    expect(countMatches(junk.html, /<td>商品 \d+<\/td>/g)).toBe(30)
  })

  it('不带任何站点名或站点 class 名（markup 保持通用）', async () => {
    const { html } = await fetchTable('/dev-fixtures/playground/mixed-table')
    expect(html).not.toContain('企查查')
    expect(html).not.toContain('frtrt')
    expect(html).not.toContain('blur')
  })

  it('生产环境下 playgroundBlocked 直接返回 404', async () => {
    vi.stubEnv('NODE_ENV', 'production')
    const { status } = await fetchTable('/dev-fixtures/playground/mixed-table?rows=30')
    expect(status).toBe(404)
  })
})
