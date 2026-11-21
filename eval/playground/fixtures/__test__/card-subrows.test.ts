import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

import { NextRequest } from '../_lib/next-shim'
import { describe, expect, it, vi } from 'vitest'

import { GET as cardSubrows } from '../card-subrows/route'

const BASE = 'http://localhost:3008'
const PATH = '/dev-fixtures/playground/card-subrows'
/** 仓库根下的 B4 case 目录：用于确认 case.json / expected.json 与路由输出同步。 */
const CASES_URL = new URL('../../cases/', import.meta.url)

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

async function fetchCards(query = ''): Promise<{ status: number; html: string }> {
  const response = await cardSubrows(new NextRequest(`${BASE}${PATH}${query}`))
  return { status: response.status, html: await response.text() }
}

function countMatches(html: string, pattern: RegExp): number {
  return (html.match(pattern) ?? []).length
}

/** 每张卡的 textContent（去掉标签、去掉首尾空白）；与 oracle 的 textContent.trim() 同口径。 */
function cardTexts(html: string): string[] {
  // 卡片的结束是「最后一行副标题的 </div> + 卡片自己的 </div>」，中间不会出现 </div></div>
  return [...html.matchAll(/<div class="card">([\s\S]*?)<\/div><\/div>/g)].map((match) =>
    match[1].replace(/<[^>]+>/g, '').trim()
  )
}

/** 副标题行（div.meta-row）的文本，按出现顺序。 */
function metaRowsOf(html: string): string[] {
  return [...html.matchAll(/<div class="meta-row">([^<]*)<\/div>/g)].map((match) => match[1])
}

/** 卡片标题（div.title），按出现顺序。 */
function titlesOf(html: string): string[] {
  return [...html.matchAll(/<div class="title">([^<]*)<\/div>/g)].map((match) => match[1])
}

/**
 * 与 playground-oracle 的 countRows 同口径：textContent.trim() 以 textPrefix 开头。
 * 只支持本 pattern 用到的两种选择器：div.card 与 div.meta-row。
 */
function countByMatch(html: string, match: MatchSpec): number {
  if (match.selector === 'div.card') {
    return cardTexts(html).filter((text) => text.startsWith(match.textPrefix)).length
  }
  if (match.selector === 'div.meta-row') {
    return metaRowsOf(html).filter((text) => text.trim().startsWith(match.textPrefix)).length
  }
  throw new Error(`本测试只支持 div.card 与 div.meta-row，收到: ${match.selector}`)
}

function readCaseFile<T>(id: string, file: 'case.json' | 'expected.json'): T {
  return JSON.parse(readFileSync(fileURLToPath(new URL(`${id}/${file}`, CASES_URL)), 'utf8')) as T
}

describe('playground · card-subrows（B4）', () => {
  it('默认 12 张卡，每张卡一个标题；标题前三个值正确', async () => {
    const { status, html } = await fetchCards()
    expect(status).toBe(200)
    expect(countMatches(html, /<div class="card">/g)).toBe(12)
    const titles = titlesOf(html)
    expect(titles).toHaveLength(12)
    expect(titles.slice(0, 3)).toEqual(['卡片 1', '卡片 2', '卡片 3'])
    expect(titles[11]).toBe('卡片 12')
  })

  it('陷阱存在：每张卡三行副标题，按 meta-row 计数得 36 行（cards × 3）', async () => {
    const { html } = await fetchCards('?cards=12')
    expect(countMatches(html, /<div class="meta-row">/g)).toBe(36)
    expect(countByMatch(html, { selector: 'div.meta-row', textPrefix: '' })).toBe(36)
  })

  it('副标题顺序固定为类型、日期、来源，类型与来源轮流取值，日期逐卡递增', async () => {
    const { html } = await fetchCards('?cards=4')
    const rows = metaRowsOf(html)
    expect(rows).toHaveLength(12)
    expect(rows.slice(0, 3)).toEqual(['类型：演出', '日期：2026-10-01', '来源：站点甲'])
    expect(rows.slice(3, 6)).toEqual(['类型：展览', '日期：2026-10-02', '来源：站点乙'])
    expect(rows.slice(6, 9)).toEqual(['类型：讲座', '日期：2026-10-03', '来源：站点丙'])
    expect(rows.slice(9, 12)).toEqual(['类型：演出', '日期：2026-10-04', '来源：站点甲'])
  })

  it('每张卡的文字互不相同（日期逐卡不同），即使 50 张也是 50 个不同的卡', async () => {
    const { html } = await fetchCards('?cards=50')
    const cards = cardTexts(html)
    expect(cards).toHaveLength(50)
    expect(new Set(cards).size).toBe(50)
    expect(cards[0]).toBe('卡片 1类型：演出日期：2026-10-01来源：站点甲')
  })

  it('cards 夹到 [1, 50]，缺失或非法值回落到默认 12', async () => {
    const under = await fetchCards('?cards=0')
    expect(countMatches(under.html, /<div class="card">/g)).toBe(1)

    const over = await fetchCards('?cards=500')
    expect(countMatches(over.html, /<div class="card">/g)).toBe(50)

    const garbage = await fetchCards('?cards=abc')
    expect(countMatches(garbage.html, /<div class="card">/g)).toBe(12)

    const missing = await fetchCards()
    expect(countMatches(missing.html, /<div class="card">/g)).toBe(12)
  })

  it('生产环境直接 404', async () => {
    vi.stubEnv('NODE_ENV', 'production')
    try {
      const { status } = await fetchCards()
      expect(status).toBe(404)
    } finally {
      vi.unstubAllEnvs()
    }
  })

  describe('case B04-001 与路由输出同步', () => {
    const caseFile = readCaseFile<CaseFile>('B04-001', 'case.json')
    const expected = readCaseFile<ExpectedFile>('B04-001', 'expected.json')

    it('case.url 指向本路由，query 为 cards=12', () => {
      const url = new URL(caseFile.url, BASE)
      expect(url.pathname).toBe(PATH)
      expect(url.search).toBe('?cards=12')
      expect(caseFile.pattern).toEqual(['B4'])
    })

    it('oracle 的 rowMatch 数出 expectedRows 张卡，标题前三个值与 expectedColumns 一致', async () => {
      const url = new URL(caseFile.url, BASE)
      const { html } = await fetchCards(url.search)
      expect(countByMatch(html, expected.rowMatch)).toBe(expected.expectedRows)
      expect(expected.expectedRows).toBe(12)
      expect(titlesOf(html).slice(0, 3)).toEqual(expected.expectedColumns['标题'])
    })

    it('naive 的 rowMatch 数出陷阱数字 36（副标题行被当成行）', async () => {
      const url = new URL(caseFile.url, BASE)
      const { html } = await fetchCards(url.search)
      expect(expected.trapVerifiedBy).toBe('naive')
      expect(countByMatch(html, expected.naive.rowMatch)).toBe(expected.naive.expectedRows)
      expect(expected.naive.expectedRows).toBe(36)
    })
  })
})
