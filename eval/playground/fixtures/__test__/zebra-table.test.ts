import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

import { NextRequest } from '../_lib/next-shim'
import {describe, expect, it, vi} from 'vitest'

import { GET as zebraTable } from '../zebra-table/route'

const BASE = 'http://localhost:3008'
const PATH = '/dev-fixtures/playground/zebra-table'
/** 仓库根下的 C4 case 目录：用于确认 case.json / expected.json 与路由输出同步。 */
const CASES_URL = new URL('../../cases/', import.meta.url)

const C4_CASES = ['C04-001', 'C04-002', 'C04-003']

interface MatchSpec {
  selector: string
  textPrefix: string
}

interface NaiveSpec {
  strategy: string
  rowMatch: MatchSpec
  expectedRows: number
}

interface ExpectedFile {
  expectedRows: number
  expectedColumns: Record<string, string[]>
  rowMatch: MatchSpec
  naive: NaiveSpec
  trapVerifiedBy: string
}

interface CaseFile {
  url: string
  pattern: string[]
}

interface DataRow {
  className: string
  cells: string[]
}

async function fetchTable(query = ''): Promise<{ status: number; html: string }> {
  const response = await zebraTable(new NextRequest(`${BASE}${PATH}${query}`))
  return { status: response.status, html: await response.text() }
}

function countMatches(html: string, pattern: RegExp): number {
  return (html.match(pattern) ?? []).length
}

/** 取出 tbody 里的数据行，表头不在其中。 */
function tbodyOf(html: string): string {
  return html.slice(html.indexOf('<tbody>'), html.indexOf('</tbody>'))
}

/** tbody 里的数据行：行 class 与每个单元格的文本。 */
function dataRows(html: string): DataRow[] {
  return [...tbodyOf(html).matchAll(/<tr class="([^"]+)">([\s\S]*?)<\/tr>/g)].map((match) => ({
    className: match[1],
    cells: [...match[2].matchAll(/<td>([^<]*)<\/td>/g)].map((cell) => cell[1]),
  }))
}

/** 表头文字，按列顺序。 */
function headerLabels(html: string): string[] {
  return [...html.matchAll(/<th>([^<]*)<\/th>/g)].map((match) => match[1])
}

/**
 * 与 playground-oracle 的 countRows 同口径：行文本（单元格拼接）以 textPrefix 开头。
 * 只支持本 pattern 用到的两种选择器：`tbody tr` 与 `tbody tr.<class>`。
 */
function countByMatch(html: string, match: MatchSpec): number {
  const classOnly = /^tbody tr\.([\w-]+)$/.exec(match.selector)
  if (match.selector !== 'tbody tr' && classOnly === null) {
    throw new Error(`本测试只支持 tbody tr 与 tbody tr.<class>，收到: ${match.selector}`)
  }
  const wantedClass = classOnly?.[1]
  return dataRows(html).filter(
    (row) =>
      (wantedClass === undefined || row.className === wantedClass) && row.cells.join('').startsWith(match.textPrefix)
  ).length
}

/** 行 class 只用两种，且严格交替。 */
function expectAlternating(rows: DataRow[]): void {
  const [first, second] = rows.map((row) => row.className)
  expect(first).not.toBe(second)
  rows.forEach((row, index) => {
    expect(row.className).toBe(index % 2 === 0 ? first : second)
  })
}

function queryOf(url: string): string {
  const index = url.indexOf('?')
  return index < 0 ? '' : url.slice(index)
}

function readCaseFile<T>(id: string, file: 'case.json' | 'expected.json'): T {
  return JSON.parse(readFileSync(fileURLToPath(new URL(`${id}/${file}`, CASES_URL)), 'utf8')) as T
}

describe('playground · zebra-table（C4）', () => {
  it('默认 40 行：奇偶各 20 行，合计 40 行', async () => {
    const { status, html } = await fetchTable('?rows=40')
    expect(status).toBe(200)
    expect(countMatches(html, /<tr class="odd">/g)).toBe(20)
    expect(countMatches(html, /<tr class="even">/g)).toBe(20)
    expect(countMatches(tbodyOf(html), /<tr class="(odd|even)">/g)).toBe(40)
  })

  it('陷阱存在：奇偶 class 交替，只认一种 class 只拿到一半', async () => {
    const { html } = await fetchTable('?rows=40')
    expect(html).toContain('<tr class="odd"><td>商品 1</td>')
    expect(html).toContain('<tr class="even"><td>商品 2</td>')
    expect(countMatches(html, /<tr class="odd">/g)).toBe(40 / 2)
    // 数据行只有 odd / even 两种 class，没有第三种
    expect(countMatches(tbodyOf(html), /<tr(?! class="(odd|even)")/g)).toBe(0)
  })

  it('表头在 thead 里、没有 class，不混进 tbody 的数据行', async () => {
    const { html } = await fetchTable('?rows=40')
    expect(html).toContain('<thead><tr><th>商品</th><th>城市</th><th>价格</th></tr></thead>')
    expect(countMatches(tbodyOf(html), /<th>/g)).toBe(0)
    // 整页只有表头一行没有 class
    expect(countMatches(html, /<tr>/g)).toBe(1)
  })

  it('每行三个单元格，商品前三个值正确', async () => {
    const { html } = await fetchTable('?rows=40')
    expect(countMatches(tbodyOf(html), /<td>/g)).toBe(40 * 3)
    const names = [...html.matchAll(/<td>(商品 \d+)<\/td>/g)].map((match) => match[1])
    expect(names).toHaveLength(40)
    expect(names.slice(0, 3)).toEqual(['商品 1', '商品 2', '商品 3'])
  })

  it('rows=7 精确给出 7 行，最后一行是 odd', async () => {
    const { html } = await fetchTable('?rows=7')
    expect(countMatches(tbodyOf(html), /<tr class="(odd|even)">/g)).toBe(7)
    expect(html).toContain('<tr class="odd"><td>商品 7</td>')
    expect(html).not.toContain('商品 8')
  })

  it('rows 夹到 [1, 200]，缺失或非法值回落到默认 40', async () => {
    const over = await fetchTable('?rows=500')
    expect(countMatches(tbodyOf(over.html), /<tr class="(odd|even)">/g)).toBe(200)

    const under = await fetchTable('?rows=0')
    expect(countMatches(tbodyOf(under.html), /<tr class="(odd|even)">/g)).toBe(1)

    const garbage = await fetchTable('?rows=abc')
    expect(countMatches(tbodyOf(garbage.html), /<tr class="(odd|even)">/g)).toBe(40)

    const missing = await fetchTable()
    expect(countMatches(tbodyOf(missing.html), /<tr class="(odd|even)">/g)).toBe(40)
  })

  it('英文 + 哈希 class（C04-002 留出集）：两种 class 严格交替，不出现 odd / even，表头与首行正确', async () => {
    const { status, html } = await fetchTable('?rows=40&lang=en&classes=hash')
    expect(status).toBe(200)
    const rows = dataRows(html)
    expect(rows).toHaveLength(40)
    expectAlternating(rows)
    expect(html).not.toMatch(/<tr class="(odd|even)">/)
    expect(headerLabels(html)).toEqual(['Product', 'City', 'Price'])
    expect(rows[0].cells).toEqual(['Item 1', 'Berlin', '$101'])
  })

  it('日文文案（C04-003）：表头与首行正确，class 仍为 odd / even 交替', async () => {
    const { html } = await fetchTable('?rows=40&lang=ja')
    const rows = dataRows(html)
    expect(rows).toHaveLength(40)
    expectAlternating(rows)
    expect(headerLabels(html)).toEqual(['商品', '都市', '価格'])
    expect(rows[0].cells).toEqual(['アイテム 1', '東京', '¥101'])
  })

  it('lang / classes 非法值回落到默认（zh + semantic），输出与无参数完全一致', async () => {
    const fallback = await fetchTable('?rows=3&lang=fr&classes=xx')
    const defaults = await fetchTable('?rows=3')
    expect(fallback.html).toBe(defaults.html)
  })

  it('生产环境直接 404', async () => {
    vi.stubEnv('NODE_ENV', 'production')
    try {
      const { status } = await fetchTable('?rows=40')
      expect(status).toBe(404)
    } finally {
      vi.unstubAllEnvs()
    }
  })

  describe.each(C4_CASES)('case %s 与路由输出同步', (id) => {
    const caseFile = readCaseFile<CaseFile>(id, 'case.json')
    const expected = readCaseFile<ExpectedFile>(id, 'expected.json')
    const query = queryOf(caseFile.url)

    it('case 指向本路由，并标注 C4', () => {
      expect(caseFile.url.startsWith(`${PATH}?`)).toBe(true)
      expect(caseFile.pattern).toContain('C4')
    })

    it('rowMatch 静态计数等于 expectedRows', async () => {
      const { html } = await fetchTable(query)
      expect(countByMatch(html, expected.rowMatch)).toBe(expected.expectedRows)
    })

    it('陷阱：朴素单 class 选择器只拿到一半，计数不等于 expectedRows', async () => {
      expect(expected.trapVerifiedBy).toBe('naive')
      const { html } = await fetchTable(query)
      const naiveCount = countByMatch(html, expected.naive.rowMatch)
      expect(naiveCount).toBe(expected.naive.expectedRows)
      expect(naiveCount).not.toBe(expected.expectedRows)
    })

    it('expectedColumns 的前三个值与页面一致', async () => {
      const { html } = await fetchTable(query)
      const labels = headerLabels(html)
      const rows = dataRows(html)
      for (const [header, values] of Object.entries(expected.expectedColumns)) {
        const index = labels.indexOf(header)
        expect(index).toBeGreaterThanOrEqual(0)
        expect(rows.slice(0, values.length).map((row) => row.cells[index])).toEqual(values)
      }
    })
  })
})
