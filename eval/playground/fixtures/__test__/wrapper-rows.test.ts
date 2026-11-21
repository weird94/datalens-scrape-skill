import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

import { NextRequest } from '../_lib/next-shim'
import { describe, expect, it, vi } from 'vitest'

import { GET as wrapperRows } from '../wrapper-rows/route'

const BASE = 'http://localhost:3008'
const PATH = '/dev-fixtures/playground/wrapper-rows'

async function fetchPage(query: string): Promise<{ status: number; html: string }> {
  const response = await wrapperRows(new NextRequest(`${BASE}${PATH}${query}`))
  return { status: response.status, html: await response.text() }
}

/** 按行切开列表：每个 li.row 是一个完整块（行内没有嵌套的 li）。 */
function rowBlocks(html: string): string[] {
  return html.match(/<li class="row">[\s\S]*?<\/li>/g) ?? []
}

function titleText(block: string): string | null {
  const match = block.match(/<a class="title"[^>]*>([^<]*)<\/a>/)
  return match ? match[1] : null
}

function isWrapped(block: string): boolean {
  return block.includes('<div class="top">')
}

function hasThumb(block: string): boolean {
  return /<span class="thumb"[^>]*><\/span>/.test(block)
}

function expectedTitles(count: number): string[] {
  return Array.from({ length: count }, (_, index) => `商品 ${index + 1}`)
}

/** 陷阱写法：只认 li 的直接子元素 a.title（即 li > a.title），包装行的标题在 div.top 里，取不到。 */
function directChildTitle(block: string): string | null {
  const match = block.match(/^<li class="row"><a class="title"[^>]*>([^<]*)<\/a>/)
  return match ? match[1] : null
}

/** 去掉标签后的可见文本（缩略图块没有文字，不影响结果）。 */
function visibleText(block: string): string {
  return block.replace(/<[^>]+>/g, '').trim()
}

/** C02-001 的标准答案：eval/playground/cases/C02-001/expected.json（页面没有表头，所以只看 rowMatch 与行数）。 */
const C02_EXPECTED_PATH = fileURLToPath(
  new URL('../../cases/C02-001/expected.json', import.meta.url)
)

interface C02Expected {
  expectedRows: number
  rowMatch: { selector: string; textPrefix: string }
}

function loadC02Expected(): C02Expected {
  return JSON.parse(readFileSync(C02_EXPECTED_PATH, 'utf8')) as C02Expected
}

describe('playground · wrapper-rows（C2）', () => {
  it('case C02-001：渲染 30 行，全部在 ul.list 里', async () => {
    const { status, html } = await fetchPage('?rows=30&wrapEvery=10')
    expect(status).toBe(200)
    expect(html).toContain('<ul class="list">')
    expect(rowBlocks(html)).toHaveLength(30)
  })

  it('包装行恰好是第 wrapEvery、2×wrapEvery… 行，其余行既没有 div.top 也没有缩略图', async () => {
    const { html } = await fetchPage('?rows=30&wrapEvery=10')
    const blocks = rowBlocks(html)
    blocks.forEach((block, index) => {
      const itemNumber = index + 1
      const shouldWrap = itemNumber % 10 === 0
      expect(isWrapped(block)).toBe(shouldWrap)
      expect(hasThumb(block)).toBe(shouldWrap)
    })
    expect(blocks.filter(isWrapped)).toHaveLength(3)
  })

  it('陷阱存在：按 li > a.title 的子选择器只能取到 27 行，漏掉的 3 行正是包装行', async () => {
    const { html } = await fetchPage('?rows=30&wrapEvery=10')
    const blocks = rowBlocks(html)
    const direct = blocks.filter((block) => block.startsWith('<li class="row"><a class="title"'))
    const missed = blocks.filter((block) => !block.startsWith('<li class="row"><a class="title"'))
    expect(direct).toHaveLength(27)
    expect(missed).toHaveLength(3)
    expect(missed.every(isWrapped)).toBe(true)
  })

  it('同一个标题用 .title 在两种深度下都能取到，30 行各一个，没有重复', async () => {
    const { html } = await fetchPage('?rows=30&wrapEvery=10')
    const titles = rowBlocks(html).map(titleText)
    expect(titles).toEqual(expectedTitles(30))
    expect(new Set(titles).size).toBe(30)
    expect(html.match(/class="title"/g)).toHaveLength(30)
  })

  it('C02-001 的 expected.json 与渲染一致：expectedRows 等于渲染行数，rowMatch.textPrefix 命中每一行（包装行的第 10、20、30 行也命中且有标题）', async () => {
    const expected = loadC02Expected()
    expect(expected.rowMatch.selector).toBe('ul.list > li.row')
    const { html } = await fetchPage('?rows=30&wrapEvery=10')
    const blocks = rowBlocks(html)
    expect(blocks).toHaveLength(expected.expectedRows)
    expect(blocks.every((block) => visibleText(block).startsWith(expected.rowMatch.textPrefix))).toBe(true)
    expect(blocks.map(titleText)).toEqual(expectedTitles(expected.expectedRows))
  })

  it('C02-001 陷阱的标准答案对照：li > a.title 在第 10、20、30 行取不到标题，与标准标题列不一致', async () => {
    const { html } = await fetchPage('?rows=30&wrapEvery=10')
    const directTitles = rowBlocks(html).map(directChildTitle)
    const emptyAt = directTitles.flatMap((title, index) => (title === null ? [index + 1] : []))
    expect(emptyAt).toEqual([10, 20, 30])
    expect(directTitles).not.toEqual(expectedTitles(30))
  })

  it('价格在两种深度下都是行的直接子元素，且是最后一个子元素', async () => {
    const { html } = await fetchPage('?rows=30&wrapEvery=10')
    const blocks = rowBlocks(html)
    blocks.forEach((block, index) => {
      expect(block.endsWith(`<span class="price">¥${101 + index}</span></li>`)).toBe(true)
    })
  })

  it('缩略图块不含文字，所以不会被当成标题', async () => {
    const { html } = await fetchPage('?rows=30&wrapEvery=10')
    const wrapped = rowBlocks(html).filter(isWrapped)
    for (const block of wrapped) {
      expect(block).toMatch(/<span class="thumb" aria-hidden="true"><\/span>/)
      expect(block.match(/<span class="thumb"[^>]*><\/span>/)?.[0]).not.toContain('商品')
    }
  })

  it('越界与非法参数：夹到 [min, max]，非数字用默认值（本路由没有页码，不返回 404）', async () => {
    const tooMany = await fetchPage('?rows=999&wrapEvery=10')
    expect(tooMany.status).toBe(200)
    expect(rowBlocks(tooMany.html)).toHaveLength(100)

    const zero = await fetchPage('?rows=0&wrapEvery=10')
    expect(rowBlocks(zero.html)).toHaveLength(1)

    const garbage = await fetchPage('?rows=abc&wrapEvery=xyz')
    expect(rowBlocks(garbage.html)).toHaveLength(30)
    expect(rowBlocks(garbage.html).filter(isWrapped)).toHaveLength(3)

    const everyOne = await fetchPage('?rows=10&wrapEvery=1')
    const blocks = rowBlocks(everyOne.html)
    expect(blocks.filter(isWrapped)).toHaveLength(5)
    expect(isWrapped(blocks[1])).toBe(true)
    expect(isWrapped(blocks[0])).toBe(false)
  })

  it('默认参数（无 query）：30 行，每 10 行一个包装', async () => {
    const { status, html } = await fetchPage('')
    expect(status).toBe(200)
    const blocks = rowBlocks(html)
    expect(blocks).toHaveLength(30)
    expect(blocks.filter(isWrapped)).toHaveLength(3)
  })

  it('生产环境返回 404', async () => {
    vi.stubEnv('NODE_ENV', 'production')
    try {
      const { status } = await fetchPage('?rows=30&wrapEvery=10')
      expect(status).toBe(404)
    } finally {
      vi.unstubAllEnvs()
    }
  })
})
