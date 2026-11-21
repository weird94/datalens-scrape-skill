import { readFileSync } from 'node:fs'

import { NextRequest } from '../_lib/next-shim'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { GET as lateList } from '../late-list/route'

const BASE = 'http://localhost:3008'
/** 仓库根下的 A1 case 目录：用于确认 case.json / expected.json 与路由输出同步。 */
const CASES_URL = new URL('../../cases/', import.meta.url)
const LATE_LIST_CASES = ['A01-001', 'A01-002', 'A01-003']

async function fetchHtml(path: string): Promise<{ status: number; html: string }> {
  const response = await lateList(new NextRequest(`${BASE}${path}`))
  return { status: response.status, html: await response.text() }
}

/** 去掉脚本后的 DOM：脚本里的字符串模板不算渲染出来的内容。 */
function markupOf(html: string): string {
  return html.replace(/<script>[\s\S]*?<\/script>/g, '')
}

function countMatches(html: string, pattern: RegExp): number {
  return (markupOf(html).match(pattern) ?? []).length
}

/** 脚本里 innerHTML 赋值的数据行：还原 JSON 字符串字面量。 */
function scriptRows(html: string): string {
  const match = html.match(/innerHTML = ("(?:[^"\\]|\\.)*");/)
  if (!match) throw new Error('脚本里没有 innerHTML 赋值')
  return JSON.parse(match[1]) as string
}

/** 脚本里 setTimeout 的延迟毫秒数。 */
function scriptDelay(html: string): number {
  const match = html.match(/\}, (\d+)\);/)
  if (!match) throw new Error('脚本里没有 setTimeout 延迟')
  return Number(match[1])
}

describe('playground · late-list（A1 列表晚渲染）', () => {
  it('首屏 HTML 没有数据行，列表区只有「加载中…」占位', async () => {
    const { status, html } = await fetchHtml('/dev-fixtures/playground/late-list?delayMs=1500&rows=20')
    expect(status).toBe(200)
    expect(countMatches(html, /class="item"/g)).toBe(0)
    expect(markupOf(html)).not.toMatch(/商品 \d/)
    expect(html).toContain('<ul id="list">\n<li class="loading">加载中…</li>\n</ul>')
  })

  it('脚本在 delayMs 之后用 innerHTML 替换 #list，插入 rows 个数据行', async () => {
    const { html } = await fetchHtml('/dev-fixtures/playground/late-list?delayMs=1500&rows=20')
    expect(html).toContain("document.getElementById('list').innerHTML = ")
    expect(scriptDelay(html)).toBe(1500)

    const rows = scriptRows(html)
    expect(countMatches(rows, /class="item"/g)).toBe(20)
    expect(rows).toContain('<li class="item"><span class="title">商品 1</span><span class="price">¥101</span></li>')
    expect(rows).toContain('<span class="title">商品 20</span><span class="price">¥120</span>')
    expect(rows).not.toContain('商品 21')
  })

  it('陷阱存在：静态直接数行得到 0，不等于 expectedRows（20）', async () => {
    const { html } = await fetchHtml('/dev-fixtures/playground/late-list?delayMs=3000&rows=20')
    const staticCount = countMatches(html, /class="item"/g)
    expect(staticCount).toBe(0)
    expect(staticCount).not.toBe(20)
    expect(scriptRows(html)).toContain('商品 1<')
  })

  it('delayMs 与 rows 的默认值是 1500 ms 和 20 行，非法值回落到默认', async () => {
    const defaults = await fetchHtml('/dev-fixtures/playground/late-list')
    expect(scriptDelay(defaults.html)).toBe(1500)
    expect(countMatches(scriptRows(defaults.html), /class="item"/g)).toBe(20)

    const invalid = await fetchHtml('/dev-fixtures/playground/late-list?delayMs=abc&rows=xyz')
    expect(scriptDelay(invalid.html)).toBe(1500)
    expect(countMatches(scriptRows(invalid.html), /class="item"/g)).toBe(20)
  })

  it('越界数值被夹到范围内（不是 404）', async () => {
    const tooLate = await fetchHtml('/dev-fixtures/playground/late-list?delayMs=99999')
    expect(tooLate.status).toBe(200)
    expect(scriptDelay(tooLate.html)).toBe(6000)

    const negative = await fetchHtml('/dev-fixtures/playground/late-list?delayMs=-5')
    expect(scriptDelay(negative.html)).toBe(0)

    const zeroRows = await fetchHtml('/dev-fixtures/playground/late-list?rows=0')
    expect(countMatches(scriptRows(zeroRows.html), /class="item"/g)).toBe(1)

    const manyRows = await fetchHtml('/dev-fixtures/playground/late-list?rows=999')
    expect(countMatches(scriptRows(manyRows.html), /class="item"/g)).toBe(100)
  })

  it('rows 的数据行字符串不会提前闭合 script 标签', async () => {
    const { html } = await fetchHtml('/dev-fixtures/playground/late-list?rows=3')
    expect(html.match(/<script>/g) ?? []).toHaveLength(1)
    expect(html.match(/<\/script>/g) ?? []).toHaveLength(1)
  })

  it('列头是可见文字，位于 #list 之外：列名「商品 / 价格」有页面上的依据', async () => {
    const { html } = await fetchHtml('/dev-fixtures/playground/late-list?delayMs=1500&rows=20')
    expect(markupOf(html)).toContain('<span>商品</span><span>价格</span>')
    expect(html.indexOf('<span>商品</span>')).toBeLessThan(html.indexOf('<ul id="list">'))
    expect(countMatches(html, /<li/g)).toBe(1)
  })
})

describe('playground · late-list 变体（留出集用）', () => {
  it('lang=en、classes=hashed：英文文案、哈希 class、价格用 $，首屏仍没有数据行', async () => {
    const { status, html } = await fetchHtml(
      '/dev-fixtures/playground/late-list?delayMs=2500&rows=12&lang=en&classes=hashed'
    )
    expect(status).toBe(200)
    expect(countMatches(html, /class="item"/g)).toBe(0)
    expect(markupOf(html)).not.toMatch(/Item \d/)
    expect(markupOf(html)).toContain('<span>Name</span><span>Price</span>')
    expect(markupOf(html)).toContain('<li class="loading">Loading…</li>')
    expect(scriptDelay(html)).toBe(2500)

    const rows = scriptRows(html)
    expect(countMatches(rows, /<li class="k3m9">/g)).toBe(12)
    expect(rows).toContain('<li class="k3m9"><span class="n5p2">Item 1</span><span class="v8q4">$101</span></li>')
    expect(rows).not.toContain('class="item"')
  })

  it('未知的 lang / classes 回落到默认（zh + semantic）', async () => {
    const { html } = await fetchHtml('/dev-fixtures/playground/late-list?rows=2&lang=fr&classes=xx')
    const rows = scriptRows(html)
    expect(countMatches(rows, /class="item"/g)).toBe(2)
    expect(rows).toContain('<li class="item"><span class="title">商品 1</span><span class="price">¥101</span></li>')
  })
})

describe('playground · late-list 生产环境屏蔽', () => {
  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it('NODE_ENV=production 时返回 404', async () => {
    vi.stubEnv('NODE_ENV', 'production')
    const { status } = await fetchHtml('/dev-fixtures/playground/late-list?delayMs=1500&rows=20')
    expect(status).toBe(404)
  })
})

interface CaseFile {
  url: string
}

interface CaseExpected {
  expectedRows: number
  expectedColumns: Record<string, string[]>
  rowMatch: { selector: string; textPrefix: string }
  naive: { strategy: string; expectedRows: number }
  trapVerifiedBy: string
  oracle: { strategy: string; waitMs?: number }
}

function readCase(id: string): { url: string; expected: CaseExpected } {
  const dir = new URL(`${id}/`, CASES_URL)
  const caseFile = JSON.parse(readFileSync(new URL('case.json', dir), 'utf-8')) as CaseFile
  const expected = JSON.parse(readFileSync(new URL('expected.json', dir), 'utf-8')) as CaseExpected
  return { url: caseFile.url, expected }
}

/** 数带前缀的数据行：按 li 的可见文字判断，占位行「加载中…」不以数据行前缀开头。 */
function countRowsWithPrefix(markup: string, prefix: string): number {
  const items = markup.match(/<li class="[^"]*">[\s\S]*?<\/li>/g) ?? []
  return items.filter((item) => item.replace(/<[^>]+>/g, '').trim().startsWith(prefix)).length
}

describe('playground · late-list 的 A01 case 与路由输出同步', () => {
  for (const id of LATE_LIST_CASES) {
    it(`${id}：静态数行为 naive.expectedRows（0），脚本插入后为 expectedRows，waitMs 大于晚渲染时长`, async () => {
      const { url, expected } = readCase(id)
      const { status, html } = await fetchHtml(url)
      expect(status).toBe(200)

      const prefix = expected.rowMatch.textPrefix
      expect(countRowsWithPrefix(markupOf(html), prefix)).toBe(expected.naive.expectedRows)
      expect(countRowsWithPrefix(scriptRows(html), prefix)).toBe(expected.expectedRows)
      expect(expected.naive.strategy).toBe('static')
      expect(expected.oracle.waitMs ?? 0).toBeGreaterThan(scriptDelay(html))
    })

    it(`${id}：expectedColumns 的键是页面上的表头文字，值是脚本插入的单元格文字`, async () => {
      const { url, expected } = readCase(id)
      const { html } = await fetchHtml(url)
      const rows = scriptRows(html)
      for (const [header, values] of Object.entries(expected.expectedColumns)) {
        expect(markupOf(html)).toContain(`<span>${header}</span>`)
        for (const value of values) expect(rows).toContain(`>${value}</span>`)
      }
    })
  }
})
