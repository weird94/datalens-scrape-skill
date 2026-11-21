/**
 * @vitest-environment jsdom
 */
import { readFileSync } from 'node:fs'
import path from 'node:path'

import { NextRequest } from '../_lib/next-shim'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { GET as cardAtomicLines } from '../card-atomic-lines/route'

const BASE = 'http://localhost:3008'
const PATH = '/dev-fixtures/playground/card-atomic-lines'
/** 仓库根下的 case 目录：用于确认 case.json / expected.json 与路由输出同步。 */
const CASES_DIR = path.join(__dirname, '../../cases')

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

interface CaseFile {
  url: string
  pattern: string[]
}

/** 渲染路由输出的 body，返回 document（jsdom，与 oracle 的 querySelectorAll + textContent.trim() 同口径）。 */
async function loadPage(query = ''): Promise<{ status: number }> {
  const response = await cardAtomicLines(new NextRequest(`${BASE}${PATH}${query}`))
  const html = await response.text()
  document.body.innerHTML = html.includes('<body>')
    ? html.slice(html.indexOf('<body>') + '<body>'.length, html.indexOf('</body>'))
    : ''
  return { status: response.status }
}

function countByMatch(match: MatchSpec): number {
  return Array.from(document.querySelectorAll(match.selector)).filter(element =>
    (element.textContent ?? '').trim().startsWith(match.textPrefix)
  ).length
}

function cards(): Element[] {
  return Array.from(document.querySelectorAll('div.f9'))
}

/** 每张卡的内容列里的行（卡片外壳 → 头像 + 内容列 → 行）。 */
function linesOf(card: Element): Element[] {
  const column = card.firstElementChild?.lastElementChild
  return column ? Array.from(column.children) : []
}

function readCaseFile<T>(id: string, file: 'case.json' | 'expected.json'): T {
  return JSON.parse(readFileSync(path.join(CASES_DIR, id, file), 'utf8')) as T
}

afterEach(() => {
  document.body.innerHTML = ''
})

describe('playground · card-atomic-lines（B4 atomic 变体）', () => {
  it('默认 12 张卡；第 4、8、12 张没有媒体行（3 行），其余 4 行', async () => {
    const { status } = await loadPage()
    expect(status).toBe(200)
    expect(cards()).toHaveLength(12)
    expect(cards().map(card => linesOf(card).length)).toEqual([4, 4, 4, 3, 4, 4, 4, 3, 4, 4, 4, 3])
  })

  it('所有行的类名完全相同，行下面那一层包装也完全相同：只靠内容和后代结构区分', async () => {
    await loadPage()
    const lines = cards().flatMap(linesOf)
    expect(new Set(lines.map(line => line.className))).toEqual(new Set(['u7 q2']))
    expect(new Set(lines.map(line => line.firstElementChild?.className))).toEqual(new Set(['u7']))
    expect(lines.every(line => line.children.length === 1)).toBe(true)
  })

  it('陷阱存在：按行（div.q2）计数得 45 = 9 × 4 + 3 × 3', async () => {
    await loadPage('?cards=12&bare=4')
    expect(countByMatch({ selector: 'div.q2', textPrefix: '' })).toBe(45)
  })

  it('bare 调节没有媒体行的卡：bare=2 一半的卡 3 行，共 42 行；bare=0 都是 4 行', async () => {
    await loadPage('?cards=12&bare=2')
    expect(countByMatch({ selector: 'div.q2', textPrefix: '' })).toBe(42)
    await loadPage('?cards=12&bare=0')
    expect(countByMatch({ selector: 'div.q2', textPrefix: '' })).toBe(48)
  })

  it('每张卡的文字互不相同（帖子号与日期逐卡不同）', async () => {
    await loadPage('?cards=50')
    const texts = cards().map(card => (card.textContent ?? '').trim())
    expect(texts).toHaveLength(50)
    expect(new Set(texts).size).toBe(50)
  })

  it('cards 夹到 [1, 50]，缺失或非法值回落到默认 12', async () => {
    await loadPage('?cards=0')
    expect(cards()).toHaveLength(1)
    await loadPage('?cards=500')
    expect(cards()).toHaveLength(50)
    await loadPage('?cards=abc')
    expect(cards()).toHaveLength(12)
  })

  it('生产环境直接 404', async () => {
    vi.stubEnv('NODE_ENV', 'production')
    try {
      const { status } = await loadPage()
      expect(status).toBe(404)
    } finally {
      vi.unstubAllEnvs()
    }
  })

  describe.each([
    { id: 'B04-002', query: '?cards=12&bare=4', naiveRows: 45 },
    { id: 'B04-003', query: '?cards=12&bare=2', naiveRows: 42 },
  ])('case $id 与路由输出同步', ({ id, query, naiveRows }) => {
    const caseFile = readCaseFile<CaseFile>(id, 'case.json')
    const expected = readCaseFile<ExpectedFile>(id, 'expected.json')

    it('case.url 指向本路由', () => {
      const url = new URL(caseFile.url, BASE)
      expect(url.pathname).toBe(PATH)
      expect(url.search).toBe(query)
      expect(caseFile.pattern).toEqual(['B4'])
    })

    it('oracle 的 rowMatch 数出 expectedRows 张卡，正文前三个值与 expectedColumns 一致', async () => {
      await loadPage(new URL(caseFile.url, BASE).search)
      expect(countByMatch(expected.rowMatch)).toBe(expected.expectedRows)
      expect(expected.expectedRows).toBe(12)
      const texts = cards().map(card => (linesOf(card)[1]?.textContent ?? '').trim())
      expect(texts.slice(0, 3)).toEqual(expected.expectedColumns['正文'])
    })

    it('naive 的 rowMatch 数出陷阱数字（每张卡的行被当成行）', async () => {
      await loadPage(new URL(caseFile.url, BASE).search)
      expect(expected.trapVerifiedBy).toBe('naive')
      expect(countByMatch(expected.naive.rowMatch)).toBe(expected.naive.expectedRows)
      expect(expected.naive.expectedRows).toBe(naiveRows)
    })
  })
})
