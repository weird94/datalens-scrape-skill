import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

import { NextRequest } from '../_lib/next-shim'
import { describe, expect, it, vi } from 'vitest'

import { GET as sharedSelector } from '../shared-selector/route'

const BASE = 'http://localhost:3008'
const PATH = '/dev-fixtures/playground/shared-selector'
/** 仓库根下的 cases 目录：用于确认 C01-001 的 case.json / expected.json 与路由输出同步。 */
const CASES_URL = new URL('../../cases/', import.meta.url)

interface ExpectedFile {
  expectedRows: number
  expectedColumns: Record<string, string[]>
  rowMatch: { selector: string; textPrefix: string }
  trapVerifiedBy: string
  trapTest: string
}

interface CaseFile {
  id: string
  pattern: string[]
  url: string
}

function readCaseFile<T>(relative: string): T {
  return JSON.parse(readFileSync(fileURLToPath(new URL(relative, CASES_URL)), 'utf8')) as T
}

async function fetchPage(query: string): Promise<{ status: number; html: string }> {
  const response = await sharedSelector(new NextRequest(`${BASE}${PATH}${query}`))
  return { status: response.status, html: await response.text() }
}

/** 按行切开列表：每个 li.post 是一个完整块（行内没有嵌套的 li）。 */
function rowBlocks(html: string): string[] {
  return html.match(/<li class="post">[\s\S]*?<\/li>/g) ?? []
}

/** 去掉标签后的可见文本。 */
function visibleText(block: string): string {
  return block.replace(/<[^>]+>/g, '').trim()
}

function titleText(block: string): string | null {
  const match = block.match(/<span class="title">([^<]*)<\/span>/)
  return match ? match[1] : null
}

/** 按 class 选择 span.stat：返回这一行所有匹配元素的文本，按 DOM 顺序。 */
function statTexts(block: string): string[] {
  return Array.from(block.matchAll(/<span class="stat">([^<]*)<\/span>/g), (match) => match[1])
}

/** 「回复 n」「转发 2n」里的数值。 */
function numberOf(text: string): number {
  const match = text.match(/(\d+)$/)
  return match ? Number(match[1]) : Number.NaN
}

function expectedTitles(count: number): string[] {
  return Array.from({ length: count }, (_, index) => `帖子 ${index + 1}`)
}

describe('playground · shared-selector（C1）', () => {
  it('case C01-001：渲染 20 行，全部在 ul.posts 里', async () => {
    const { status, html } = await fetchPage('?rows=20')
    expect(status).toBe(200)
    expect(html).toContain('<ul class="posts">')
    expect(rowBlocks(html)).toHaveLength(20)
  })

  it('每行标题是「帖子 n」，且每行恰好有两个 span.stat', async () => {
    const { html } = await fetchPage('?rows=20')
    const blocks = rowBlocks(html)
    expect(blocks.map(titleText)).toEqual(expectedTitles(20))
    blocks.forEach((block) => expect(statTexts(block)).toHaveLength(2))
  })

  it('同一行的两个 span.stat 只能按位置区分：第一个是「回复 n」（数值 n），第二个是「转发 2n」（数值 2n）', async () => {
    const { html } = await fetchPage('?rows=20')
    rowBlocks(html).forEach((block, index) => {
      const itemNumber = index + 1
      const [reply, repost] = statTexts(block)
      expect(reply).toBe(`回复 ${itemNumber}`)
      expect(repost).toBe(`转发 ${2 * itemNumber}`)
    })
  })

  it('陷阱存在：同一行的两个 span.stat 数值不同（n 与 2n），按 class 选择会得到两列相同的结果', async () => {
    const { html } = await fetchPage('?rows=20')
    const blocks = rowBlocks(html)
    blocks.forEach((block) => {
      // 两个 span.stat 的开始标签完全相同（class 之外没有 id / data-*），只按 class 选择拿到的是同一组匹配项
      const openingTags = Array.from(block.matchAll(/<span\b[^>]*>/g), (match) => match[0])
      const statTags = openingTags.filter((tag) => tag.includes('class="stat"'))
      expect(statTags).toHaveLength(2)
      expect(new Set(statTags).size).toBe(1)
      // 同一行两个匹配的数值确实不同（n 与 2n）
      const [first, second] = statTexts(block)
      expect(numberOf(first)).not.toBe(numberOf(second))
    })
    // 两个字段若都取第 0 个匹配项，「转发」列会与「回复」列相同；真正的「转发」列在第 1 个匹配项，两列必须不同
    const columnAtZero = blocks.map((block) => statTexts(block)[0])
    const columnAtOne = blocks.map((block) => statTexts(block)[1])
    expect(columnAtZero).not.toEqual(columnAtOne)
  })

  it('越界与非法参数：rows 夹到 [1, 50]，非数字与缺省用默认 20', async () => {
    const tooMany = await fetchPage('?rows=999')
    expect(tooMany.status).toBe(200)
    expect(rowBlocks(tooMany.html)).toHaveLength(50)

    const zero = await fetchPage('?rows=0')
    expect(rowBlocks(zero.html)).toHaveLength(1)

    const garbage = await fetchPage('?rows=abc')
    expect(rowBlocks(garbage.html)).toHaveLength(20)

    const absent = await fetchPage('')
    expect(absent.status).toBe(200)
    expect(rowBlocks(absent.html)).toHaveLength(20)
  })

  it('生产环境返回 404', async () => {
    vi.stubEnv('NODE_ENV', 'production')
    try {
      const { status } = await fetchPage('?rows=20')
      expect(status).toBe(404)
    } finally {
      vi.unstubAllEnvs()
    }
  })

  describe('C01-001 case 与路由输出同步', () => {
    const expected = readCaseFile<ExpectedFile>('C01-001/expected.json')
    const caseFile = readCaseFile<CaseFile>('C01-001/case.json')

    it('case.json：id 为 C01-001，pattern 为 C1，url 指向本路由且 rows=20', async () => {
      expect(caseFile.id).toBe('C01-001')
      expect(caseFile.pattern).toEqual(['C1'])
      const url = new URL(caseFile.url, BASE)
      expect(url.pathname).toBe(PATH)
      const { html } = await fetchPage(url.search)
      expect(rowBlocks(html)).toHaveLength(expected.expectedRows)
    })

    it('rowMatch（li.post，textPrefix「帖子 」）命中每一行，且 expectedColumns 的「帖子」前 3 个值与渲染一致', async () => {
      expect(expected.rowMatch.selector).toBe('li.post')
      const { html } = await fetchPage('?rows=20')
      const blocks = rowBlocks(html)
      expect(blocks).toHaveLength(expected.expectedRows)
      expect(blocks.every((block) => visibleText(block).startsWith(expected.rowMatch.textPrefix))).toBe(true)
      expect(blocks.slice(0, 3).map(titleText)).toEqual(expected.expectedColumns['帖子'])
    })

    it('trapVerifiedBy 为 vitest，且 trapTest 指向本文件里真实存在的 it()', () => {
      expect(expected.trapVerifiedBy).toBe('vitest')
      const self = readFileSync(fileURLToPath(import.meta.url), 'utf8')
      expect(self).toContain(`it('${expected.trapTest}'`)
    })
  })
})
