import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

import { NextRequest } from '../_lib/next-shim'
import { describe, expect, it, vi } from 'vitest'

import { GET as captchaAfter } from '../captcha-after/[page]/route'

const BASE = 'http://localhost:3008'
const PATH = '/dev-fixtures/playground/captcha-after'
/** 仓库根下的 F4 case 目录：用于确认 case.json / expected.json 与路由输出同步。 */
const CASES_URL = new URL('../../cases/', import.meta.url)
/** case 的基础参数；变体只在其后追加 lang / classes。 */
const CASE_PARAMS: Record<string, string> = { pages: '10', perPage: '10', wallAt: '4' }
/**
 * 到底类文案（中 / 英 / 日）。墙页不能出现这些，否则「墙」与「真到底」在结果里就分不开了（E4）。
 */
const END_OF_LIST = /到底|没有更多|没有其他|no more|end of|the end|もうありません|これ以上|以上です|最後/i

/**
 * 一个变体的文案与类名。这里是测试侧独立写的一份，用来核对路由输出；
 * 与 route.ts 的 TEXT / CLASS_NAMES 必须一致。
 */
interface Variant {
  name: string
  caseId: string
  /** 追加到 CASE_PARAMS 之后的变体参数；zh + semantic 为默认，不写参数。 */
  extra: Record<string, string>
  lang: string
  itemClass: string
  titleClass: string
  nextClass: string
  wallBoxClass: string
  wallText: string
  /** 第 1 页页头里应出现的片段（pages 自称 10 页）。 */
  pageHeader: string
  itemTitle: (itemNumber: number) => string
}

const VARIANTS: Variant[] = [
  {
    name: 'zh · 语义类名',
    caseId: 'F04-001',
    extra: {},
    lang: 'zh',
    itemClass: 'item',
    titleClass: 'title',
    nextClass: 'next',
    wallBoxClass: 'captcha-box',
    wallText: '安全验证 拖动下方滑块完成拼图',
    pageHeader: '第 1 / 10 页',
    itemTitle: (itemNumber) => `商品 ${itemNumber}`,
  },
  {
    name: 'en · 哈希类名（留出集）',
    caseId: 'F04-002',
    extra: { lang: 'en', classes: 'hash' },
    lang: 'en',
    itemClass: 'r7c2e9a',
    titleClass: 'r1b4d6f',
    nextClass: 'r4f0b8c',
    wallBoxClass: 'r2a7e5d',
    wallText: 'Security check: drag the slider below to complete the puzzle',
    pageHeader: 'page 1 of 10',
    itemTitle: (itemNumber) => `Item ${itemNumber}`,
  },
  {
    name: 'ja · 语义类名',
    caseId: 'F04-003',
    extra: { lang: 'ja' },
    lang: 'ja',
    itemClass: 'item',
    titleClass: 'title',
    nextClass: 'next',
    wallBoxClass: 'captcha-box',
    wallText: 'セキュリティ確認 下のスライダーをドラッグしてパズルを完成させてください',
    pageHeader: '1 / 10 ページ',
    itemTitle: (itemNumber) => `アイテム ${itemNumber}`,
  },
]

function queryFor(v: Variant, overrides: Record<string, string> = {}): string {
  return `?${new URLSearchParams({ ...CASE_PARAMS, ...v.extra, ...overrides }).toString()}`
}

/** 按完整路径（含 query）请求一页；page 段从路径里取。 */
async function fetchPath(path: string): Promise<{ status: number; html: string }> {
  const page = path.match(/\/captcha-after\/([^?/]+)/)?.[1] ?? ''
  const response = await captchaAfter(new NextRequest(`${BASE}${path}`), {
    params: Promise.resolve({ page }),
  })
  return { status: response.status, html: await response.text() }
}

function fetchPage(page: string, query: string): Promise<{ status: number; html: string }> {
  return fetchPath(`${PATH}/${page}${query}`)
}

/** 只数渲染出来的数据行（按变体的行 class）。 */
function countItems(html: string, v: Variant): number {
  return (html.match(new RegExp(`class="${v.itemClass}"`, 'g')) ?? []).length
}

function itemTitles(html: string, v: Variant): string[] {
  return Array.from(html.matchAll(new RegExp(`<span class="${v.titleClass}">([^<]*)</span>`, 'g')), (match) => match[1])
}

function nextHref(html: string, v: Variant): string | null {
  return html.match(new RegExp(`<a class="${v.nextClass}" href="([^"]*)"`))?.[1] ?? null
}

function isWall(html: string, v: Variant): boolean {
  return html.includes(v.wallText)
}

/** 模拟 next-link oracle：从第 1 页起，沿下一页链接一页页走，直到没有下一页。 */
async function crawl(v: Variant, query: string): Promise<{ rowsPerPage: number[]; lastHtml: string }> {
  const rowsPerPage: number[] = []
  let path: string | null = `${PATH}/1${query}`
  let lastHtml = ''
  while (path !== null) {
    if (rowsPerPage.length > 60) throw new Error('crawl 没有在 60 页内停止')
    const { html } = await fetchPath(path)
    rowsPerPage.push(countItems(html, v))
    lastHtml = html
    path = nextHref(html, v)
  }
  return { rowsPerPage, lastHtml }
}

describe.each(VARIANTS)('playground · captcha-after（F4）· $name', (v) => {
  it('前三页正常：每页 10 行，行标题按页连续编号', async () => {
    const page1 = await fetchPage('1', queryFor(v))
    expect(page1.status).toBe(200)
    expect(countItems(page1.html, v)).toBe(10)
    expect(itemTitles(page1.html, v)[0]).toBe(v.itemTitle(1))
    expect(itemTitles(page1.html, v)[9]).toBe(v.itemTitle(10))

    const page3 = await fetchPage('3', queryFor(v))
    expect(countItems(page3.html, v)).toBe(10)
    expect(itemTitles(page3.html, v)[9]).toBe(v.itemTitle(30))
    expect(isWall(page3.html, v)).toBe(false)
  })

  it('第 1 至 wallAt-1 页都有指向下一页的链接，且 query（含 lang / classes）原样保留', async () => {
    const query = queryFor(v)
    const page1 = await fetchPage('1', query)
    expect(nextHref(page1.html, v)).toBe(`${PATH}/2${query}`)
    const page3 = await fetchPage('3', query)
    expect(nextHref(page3.html, v)).toBe(`${PATH}/4${query}`)
  })

  it('第 wallAt 页：没有任何行、没有下一页链接，只渲染滑块验证码块（HTTP 200）', async () => {
    const page4 = await fetchPage('4', queryFor(v))
    expect(page4.status).toBe(200)
    expect(countItems(page4.html, v)).toBe(0)
    expect(page4.html).not.toContain(`class="${v.titleClass}"`)
    expect(nextHref(page4.html, v)).toBeNull()
    expect(page4.html).toContain(`class="${v.wallBoxClass}"`)
    expect(isWall(page4.html, v)).toBe(true)
    expect(page4.html).toContain('<ul id="list"></ul>')
    expect(page4.html).toContain(`<html lang="${v.lang}">`)
  })

  it('墙页不含到底类文案：墙与真到底在页面上必须可区分（E4）', async () => {
    for (const page of ['4', '5']) {
      const { html } = await fetchPage(page, queryFor(v))
      expect(html).not.toMatch(END_OF_LIST)
    }
  })

  it('墙之后的页不会恢复：第 5、9、10 页仍是验证码', async () => {
    for (const page of ['5', '9', '10']) {
      const { html } = await fetchPage(page, queryFor(v))
      expect(countItems(html, v)).toBe(0)
      expect(nextHref(html, v)).toBeNull()
      expect(isWall(html, v)).toBe(true)
    }
  })

  it('按下一页链接走到底：每页行数为 [10, 10, 10, 0]，共 30 行，停在验证码页', async () => {
    const { rowsPerPage, lastHtml } = await crawl(v, queryFor(v))
    expect(rowsPerPage).toEqual([10, 10, 10, 0])
    expect(rowsPerPage.reduce((sum, count) => sum + count, 0)).toBe(30)
    expect(isWall(lastHtml, v)).toBe(true)
  })

  it('陷阱存在：静态只能数到第 1 页的 10 行；页头自称 10 页（约 100 条），可采的只有 30 行', async () => {
    const page1 = await fetchPage('1', queryFor(v))
    expect(countItems(page1.html, v)).toBe(10)
    expect(page1.html).toContain(v.pageHeader)

    const { rowsPerPage } = await crawl(v, queryFor(v))
    expect(rowsPerPage.reduce((sum, count) => sum + count, 0)).toBe(30)
  })
})

describe('playground · captcha-after（F4）· 通用边界（语义类名、中文）', () => {
  const DEFAULT = VARIANTS[0]

  it('wallAt 大于 pages：最后一页没有下一页链接、仍是正常列表，整条链 30 行，没有验证码', async () => {
    const query = '?pages=3&perPage=10&wallAt=50'
    const last = await fetchPage('3', query)
    expect(countItems(last.html, DEFAULT)).toBe(10)
    expect(itemTitles(last.html, DEFAULT)[0]).toBe('商品 21')
    expect(nextHref(last.html, DEFAULT)).toBeNull()
    expect(isWall(last.html, DEFAULT)).toBe(false)

    const { rowsPerPage, lastHtml } = await crawl(DEFAULT, query)
    expect(rowsPerPage).toEqual([10, 10, 10])
    expect(isWall(lastHtml, DEFAULT)).toBe(false)
  })

  it('wallAt 越界按 intParam 夹到 [1, 50]：wallAt=0 时第 1 页就是验证码；999 夹到 50', async () => {
    const zero = await fetchPage('1', '?pages=10&wallAt=0')
    expect(countItems(zero.html, DEFAULT)).toBe(0)
    expect(isWall(zero.html, DEFAULT)).toBe(true)

    const high49 = await fetchPage('49', '?pages=999&wallAt=999')
    expect(countItems(high49.html, DEFAULT)).toBe(10)
    expect(nextHref(high49.html, DEFAULT)).toBe(`${PATH}/50?pages=999&wallAt=999`)

    const high50 = await fetchPage('50', '?pages=999&wallAt=999')
    expect(isWall(high50.html, DEFAULT)).toBe(true)

    const tooFar = await fetchPage('51', '?pages=999&wallAt=999')
    expect(tooFar.status).toBe(404)
  })

  it('非法页码返回 404：0、超过 pages、非数字', async () => {
    expect((await fetchPage('0', '?pages=10&wallAt=4')).status).toBe(404)
    expect((await fetchPage('11', '?pages=10&wallAt=4')).status).toBe(404)
    expect((await fetchPage('abc', '?pages=10&wallAt=4')).status).toBe(404)
  })

  it('perPage 越界夹到 [1, 50]，非数字回落到默认 10', async () => {
    const low = await fetchPage('1', '?pages=2&perPage=0&wallAt=50')
    expect(countItems(low.html, DEFAULT)).toBe(1)

    const high = await fetchPage('1', '?pages=2&perPage=999&wallAt=50')
    expect(countItems(high.html, DEFAULT)).toBe(50)

    const garbage = await fetchPage('1', '?pages=2&perPage=abc&wallAt=50')
    expect(countItems(garbage.html, DEFAULT)).toBe(10)
  })

  it('lang / classes 非法值回落到 zh 与语义类名', async () => {
    const page1 = await fetchPage('1', '?pages=2&perPage=3&wallAt=50&lang=fr&classes=xx')
    expect(itemTitles(page1.html, DEFAULT)).toEqual(['商品 1', '商品 2', '商品 3'])
    expect(page1.html).toContain('<html lang="zh">')
  })

  it('生产环境返回 404（playgroundBlocked 是第一步）', async () => {
    vi.stubEnv('NODE_ENV', 'production')
    try {
      const { status } = await fetchPage('1', '?pages=10&wallAt=4')
      expect(status).toBe(404)
    } finally {
      vi.unstubAllEnvs()
    }
  })
})

interface ExpectedFile {
  expectedRows: number
  expectedStop: string
  rowMatch: { selector: string; textPrefix: string }
  oracle: { strategy: string; clickSelector?: string }
  naive: { strategy: string; expectedRows: number }
  stopSignal: Array<{ selector: string; exists?: boolean; textIncludes?: string }>
  trapVerifiedBy: string
}

interface CaseFile {
  url: string
}

function readCaseFile<T>(caseId: string, file: 'case.json' | 'expected.json'): T {
  return JSON.parse(readFileSync(fileURLToPath(new URL(`${caseId}/${file}`, CASES_URL)), 'utf8')) as T
}

describe.each(VARIANTS)('F4 case 目录与路由输出同步 · $caseId', (v) => {
  it('case.json 的 url 与变体参数一致', () => {
    const caseFile = readCaseFile<CaseFile>(v.caseId, 'case.json')
    expect(caseFile.url).toBe(`${PATH}/1${queryFor(v)}`)
  })

  it('expected.json 的行数、停机原因、选择器与路由输出一致，并能被下一页链接走完', async () => {
    const expected = readCaseFile<ExpectedFile>(v.caseId, 'expected.json')
    expect(expected.expectedStop).toBe('wall')
    expect(expected.expectedRows).toBe(30)
    expect(expected.rowMatch.selector).toBe(`.${v.itemClass}`)
    expect(expected.rowMatch.textPrefix).toBe(v.itemTitle(1).replace(/\d+$/, ''))
    expect(expected.oracle.strategy).toBe('next-link')
    expect(expected.oracle.clickSelector).toBe(`a.${v.nextClass}`)

    const page1 = await fetchPage('1', queryFor(v))
    expect(itemTitles(page1.html, v).slice(0, 3)).toEqual([1, 2, 3].map((n) => v.itemTitle(n)))

    const { rowsPerPage, lastHtml } = await crawl(v, queryFor(v))
    expect(rowsPerPage.reduce((sum, count) => sum + count, 0)).toBe(expected.expectedRows)
    expect(isWall(lastHtml, v)).toBe(true)
  })

  it('naive 只看第 1 页：静态数行得 naive.expectedRows = 10，与 expectedRows 不同', async () => {
    const expected = readCaseFile<ExpectedFile>(v.caseId, 'expected.json')
    expect(expected.naive).toEqual({ strategy: 'static', expectedRows: 10 })
    expect(expected.trapVerifiedBy).toBe('stopSignal')
    const page1 = await fetchPage('1', queryFor(v))
    expect(countItems(page1.html, v)).toBe(expected.naive.expectedRows)
    expect(expected.naive.expectedRows).not.toBe(expected.expectedRows)
  })

  it('stopSignal 与墙页一致：下一页链接不存在，body 含本变体的验证码文案（停机原因是墙，不是到底）', async () => {
    const expected = readCaseFile<ExpectedFile>(v.caseId, 'expected.json')
    const [noNext, wallSignal] = expected.stopSignal
    expect(noNext).toEqual({ selector: `a.${v.nextClass}`, exists: false })
    expect(wallSignal.selector).toBe('body')
    const text = wallSignal.textIncludes
    expect(text).toBeDefined()
    expect(v.wallText).toContain(text ?? '')

    const wall = await fetchPage('4', queryFor(v))
    expect(nextHref(wall.html, v)).toBeNull()
    expect(wall.html).toContain(text ?? '')
  })
})
