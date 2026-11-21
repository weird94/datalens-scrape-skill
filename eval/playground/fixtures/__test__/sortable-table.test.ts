import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

import { NextRequest } from '../_lib/next-shim'
import { describe, expect, it, vi } from 'vitest'

import { GET as sortableTable } from '../sortable-table/route'

const BASE = 'http://localhost:3008'
const PATH = '/dev-fixtures/playground/sortable-table'

async function fetchTable(query = ''): Promise<{ status: number; html: string }> {
  const response = await sortableTable(new NextRequest(`${BASE}${PATH}${query}`))
  return { status: response.status, html: await response.text() }
}

function countMatches(html: string, pattern: RegExp): number {
  return (html.match(pattern) ?? []).length
}

/** tbody 里的数据行；表头在 thead 里，不在其中。 */
function tbodyOf(html: string): string {
  return html.slice(html.indexOf('<tbody>'), html.indexOf('</tbody>'))
}

/** 表下脚注列表（ol.notes）的内部。 */
function notesOf(html: string): string {
  return html.slice(html.indexOf('<ol class="notes">'), html.indexOf('</ol>'))
}

interface RowSpec {
  selector: string
  textPrefix: string
}

interface B03Expected {
  expectedRows: number
  expectedColumns: Record<string, string[]>
  rowMatch: RowSpec
  naive: { rowMatch: RowSpec; expectedRows: number }
  trapVerifiedBy: string
}

/** 与 playground-oracle countRows 同口径，只覆盖本 case 用到的两个选择器：tbody tr 与 ol.notes li。 */
function rowTextsFor(html: string, selector: string): string[] {
  if (selector === 'tbody tr') {
    return [...tbodyOf(html).matchAll(/<tr[ >][\s\S]*?<\/tr>/g)].map((match) => match[0].replace(/<[^>]+>/g, '').trim())
  }
  if (selector === 'ol.notes li') {
    return [...notesOf(html).matchAll(/<li>([\s\S]*?)<\/li>/g)].map((match) => match[1].replace(/<[^>]+>/g, '').trim())
  }
  throw new Error(`rowTextsFor 不支持 ${selector}`)
}

function countBySpec(html: string, spec: RowSpec): number {
  return rowTextsFor(html, spec.selector).filter((text) => text.startsWith(spec.textPrefix)).length
}

function caseJson(id: string, file: 'case.json' | 'expected.json'): string {
  return readFileSync(fileURLToPath(new URL(`../../cases/${id}/${file}`, import.meta.url)), 'utf8')
}

describe('playground · sortable-table 与 B03-001 case 同步', () => {
  it('rowMatch（tbody tr）数出 expectedRows；naive 的 ol.notes li 数出 naive.expectedRows，陷阱行内容是脚注不是商品', async () => {
    const caseInfo = JSON.parse(caseJson('B03-001', 'case.json')) as { url: string }
    const expected = JSON.parse(caseJson('B03-001', 'expected.json')) as B03Expected
    const { status, html } = await fetchTable(new URL(caseInfo.url, BASE).search)
    expect(status).toBe(200)
    expect(countBySpec(html, expected.rowMatch)).toBe(expected.expectedRows)
    expect(countBySpec(html, expected.naive.rowMatch)).toBe(expected.naive.expectedRows)
    expect(rowTextsFor(html, 'ol.notes li').every((text) => text.startsWith('注'))).toBe(true)
    expect(rowTextsFor(html, 'tbody tr').every((text) => text.startsWith('商品 '))).toBe(true)
    expect(expected.trapVerifiedBy).toBe('naive')
  })

  it('expectedColumns 的键在页面上真实存在（表头按钮「按商品排序」「按价格排序」含这两个字，单元格里也有），值都在 tbody 里', async () => {
    const expected = JSON.parse(caseJson('B03-001', 'expected.json')) as B03Expected
    const { html } = await fetchTable('?rows=12')
    for (const [column, values] of Object.entries(expected.expectedColumns)) {
      expect(html).toContain(column)
      for (const value of values) {
        expect(tbodyOf(html)).toContain(`<td>${value}</td>`)
      }
    }
    expect(html).toContain('<th role="columnheader button" aria-sort="none"><button type="button">按商品排序</button></th>')
  })
})

describe('playground · sortable-table（B3）', () => {
  it('默认 12 行：tbody 里是 12 条「商品 n」数据行，顺序正确', async () => {
    const { status, html } = await fetchTable()
    expect(status).toBe(200)
    expect(countMatches(tbodyOf(html), /<tr class="row">/g)).toBe(12)
    const names = [...tbodyOf(html).matchAll(/<td>(商品 \d+)<\/td>/g)].map((match) => match[1])
    expect(names).toEqual(Array.from({ length: 12 }, (_, index) => `商品 ${index + 1}`))
  })

  it('rows=7 精确给出 7 条数据行，最后一行是商品 7', async () => {
    const { html } = await fetchTable('?rows=7')
    expect(countMatches(tbodyOf(html), /<tr class="row">/g)).toBe(7)
    expect(html).toContain('<tr class="row"><td>商品 7</td>')
    expect(html).not.toContain('商品 8')
  })

  it('前三个商品名与价格正确（价格列 ¥101 起）', async () => {
    const { html } = await fetchTable('?rows=12')
    const names = [...tbodyOf(html).matchAll(/<td>(商品 \d+)<\/td>/g)].map((match) => match[1])
    const prices = [...tbodyOf(html).matchAll(/<td>(¥\d+)<\/td>/g)].map((match) => match[1])
    expect(names.slice(0, 3)).toEqual(['商品 1', '商品 2', '商品 3'])
    expect(prices.slice(0, 3)).toEqual(['¥101', '¥102', '¥103'])
  })

  it('陷阱一：表头 3 个 th 的 role 是 "columnheader button"（真站失败选择器形状），各含一个排序按钮，且不在 tbody 里', async () => {
    const { html } = await fetchTable('?rows=12')
    expect(countMatches(html, /<th role="columnheader button"/g)).toBe(3)
    expect(
      countMatches(html, /<th role="columnheader button" aria-sort="none"><button type="button">按(商品|城市|价格)排序<\/button><\/th>/g)
    ).toBe(3)
    expect(countMatches(tbodyOf(html), /<th/g)).toBe(0)
  })

  it('陷阱一（rows=3）：表头按钮数与数据行数同为 3，计数分不开；靠 tbody 限定与 textPrefix「商品 」排除表头', async () => {
    const { html } = await fetchTable('?rows=3')
    expect(countMatches(html, /<th role="columnheader button"/g)).toBe(3)
    expect(countMatches(tbodyOf(html), /<tr class="row">/g)).toBe(3)
    expect(countMatches(tbodyOf(html), /<th/g)).toBe(0)
    // 表头文本是「按商品排序」，不含 textPrefix「商品 」（带空格），所以按前缀不会命中表头
    const headerHtml = html.slice(html.indexOf('<thead>'), html.indexOf('</thead>'))
    expect(countMatches(headerHtml, /商品 /g)).toBe(0)
  })

  it('陷阱一（计数）：整页 tr 比数据行多 1，表头行会被只按 tr 数的采集器算进去', async () => {
    const { html } = await fetchTable('?rows=12')
    expect(countMatches(html, /<tr[ >]/g)).toBe(13)
    expect(countMatches(tbodyOf(html), /<tr[ >]/g)).toBe(12)
    // 表头行的文本以「按商品排序」开头，textPrefix「商品 」区分得开
    const headerText = html.slice(html.indexOf('<thead>'), html.indexOf('</thead>'))
    expect(headerText).toContain('按商品排序')
    expect(headerText.startsWith('<thead><tr><th')).toBe(true)
  })

  it('陷阱二：脚注是 ol.notes 里 rows 条 li，条数与数据行相同，内容是「注 n：…」而不是商品', async () => {
    const { html } = await fetchTable('?rows=12')
    const notes = notesOf(html)
    expect(countMatches(notes, /<li>/g)).toBe(12)
    expect(countMatches(notes, /<li>注 \d+：/g)).toBe(12)
    expect(countMatches(notes, /<li>商品 /g)).toBe(0)
    // 页面上所有 li 只有脚注这 12 条：只看 li 的启发式会选中它
    expect(countMatches(html, /<li>/g)).toBe(12)
  })

  it('脚注位于表格之后、与 tbody 分离', async () => {
    const { html } = await fetchTable('?rows=12')
    expect(html.indexOf('</table>')).toBeGreaterThan(html.indexOf('</tbody>'))
    expect(html.indexOf('<ol class="notes">')).toBeGreaterThan(html.indexOf('</table>'))
  })

  it('rows 夹到 [1, 50]，缺失或非法值回落到默认 12（越界不返回 404，沿用 shell 的夹取约定）', async () => {
    const over = await fetchTable('?rows=500')
    expect(over.status).toBe(200)
    expect(countMatches(tbodyOf(over.html), /<tr class="row">/g)).toBe(50)
    expect(countMatches(notesOf(over.html), /<li>/g)).toBe(50)

    const under = await fetchTable('?rows=0')
    expect(under.status).toBe(200)
    expect(countMatches(tbodyOf(under.html), /<tr class="row">/g)).toBe(1)

    const garbage = await fetchTable('?rows=abc')
    expect(countMatches(tbodyOf(garbage.html), /<tr class="row">/g)).toBe(12)

    const missing = await fetchTable()
    expect(countMatches(tbodyOf(missing.html), /<tr class="row">/g)).toBe(12)
  })

  it('生产环境直接 404', async () => {
    vi.stubEnv('NODE_ENV', 'production')
    try {
      const { status } = await fetchTable('?rows=12')
      expect(status).toBe(404)
    } finally {
      vi.unstubAllEnvs()
    }
  })
})
