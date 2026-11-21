import { readFileSync } from 'node:fs'

import { NextRequest } from '../_lib/next-shim'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { GET as hangAfter } from '../hang-after/route'

const BASE = 'http://localhost:3008'
const PATH = '/dev-fixtures/playground/hang-after?batchSize=10&hangAfter=3'
/** 仓库根下的 F5 case 目录：用于确认 case.json / expected.json 与路由输出同步。 */
const CASES_URL = new URL('../../cases/', import.meta.url)

const F5_CASES = ['F05-001', 'F05-002', 'F05-003']

/** 挂起状态下按钮应显示的 loading 文案，按 lang 区分。 */
const LOADING_TEXT: Record<string, string> = { zh: '加载中…', en: 'Loading…', ja: '読み込み中…' }

async function fetchHtml(path: string): Promise<{ status: number; html: string }> {
  const response = await hangAfter(new NextRequest(`${BASE}${path}`))
  return { status: response.status, html: await response.text() }
}

/** 去掉脚本后的 DOM：脚本里的字符串模板不算渲染出来的内容。 */
function markupOf(html: string): string {
  return html.replace(/<script>[\s\S]*?<\/script>/g, '')
}

function countMatches(html: string, pattern: RegExp): number {
  return (markupOf(html).match(pattern) ?? []).length
}

function scriptOf(html: string): string {
  const match = html.match(/<script>([\s\S]*?)<\/script>/)
  if (!match) throw new Error('页面里没有脚本')
  return match[1]
}

/** #list 的内部 HTML（首屏渲染结果）。 */
function listHtmlOf(html: string): string {
  const match = html.match(/<ul id="list">\n([\s\S]*?)\n<\/ul>/)
  if (!match) throw new Error('页面里没有 #list')
  return match[1]
}

/** #load-more 按钮的首屏文案。 */
function buttonTextOf(html: string): string {
  const match = html.match(/<button id="load-more"[^>]*>([^<]*)<\/button>/)
  if (!match) throw new Error('页面里没有 #load-more')
  return match[1]
}

/** 每行的 [标题, 价格] 文本对。 */
function cellsOf(listHtml: string): Array<[string, string]> {
  return Array.from(
    listHtml.matchAll(/<li [^>]*><span [^>]*>([^<]*)<\/span><span [^>]*>([^<]*)<\/span><\/li>/g),
    (match) => [match[1], match[2]] as [string, string]
  )
}

/** 数据行：按 <li 计数，与 class 风格无关（semantic / hash 都适用）。 */
function rowsIn(text: string): number {
  return (text.match(/<li /g) ?? []).length
}

/**
 * 在最小假 DOM 上执行页面脚本：只实现脚本用到的 getElementById / insertAdjacentHTML /
 * textContent / addEventListener / remove。click() = 调用按钮上注册的 click 监听器。
 * 列表与按钮的初始状态取自真正渲染出来的 HTML，不手写。
 */
async function mountPage(path: string) {
  const { html } = await fetchHtml(path)
  const state = {
    listHtml: listHtmlOf(html),
    buttonText: buttonTextOf(html),
    buttonRemoved: false,
    listeners: [] as Array<() => void>,
  }
  const fakeDocument = {
    getElementById(id: string) {
      if (id === 'list') {
        return {
          insertAdjacentHTML: (_position: string, added: string) => {
            state.listHtml += added
          },
        }
      }
      if (id === 'load-more') {
        return {
          get textContent() {
            return state.buttonText
          },
          set textContent(value: string) {
            state.buttonText = value
          },
          addEventListener: (_type: string, listener: () => void) => {
            state.listeners.push(listener)
          },
          remove: () => {
            state.buttonRemoved = true
          },
        }
      }
      return null
    },
  }
  new Function('document', scriptOf(html))(fakeDocument)

  return {
    html,
    rowCount: () => rowsIn(state.listHtml),
    listHtml: () => state.listHtml,
    buttonText: () => state.buttonText,
    buttonRemoved: () => state.buttonRemoved,
    click: () => state.listeners.forEach((listener) => listener()),
  }
}

function readCaseFile<T>(id: string, name: 'case.json' | 'expected.json'): T {
  return JSON.parse(readFileSync(new URL(`${id}/${name}`, CASES_URL), 'utf-8')) as T
}

describe('playground · hang-after（F5 续载挂起）', () => {
  it('首屏只有第 1 批（10 行），下方是「加载更多」按钮', async () => {
    const { status, html } = await fetchHtml(PATH)
    expect(status).toBe(200)
    expect(countMatches(html, /<li /g)).toBe(10)
    expect(markupOf(html)).toContain('<span class="title">商品 10</span><span class="price">¥110</span>')
    expect(markupOf(html)).not.toContain('商品 11')
    expect(html).toContain('<button id="load-more" class="load-more" type="button">加载更多</button>')
  })

  it('页面没有「到底」或「没有更多」之类的结束文案', async () => {
    const { html } = await fetchHtml(PATH)
    expect(markupOf(html)).not.toMatch(/到底|没有更多|已全部|没有其他|no more|end of|all loaded/i)
  })

  it('陷阱存在：静态直接数行得到 10，不等于 expectedRows（30）', async () => {
    const { html } = await fetchHtml(PATH)
    const staticCount = countMatches(html, /<li /g)
    expect(staticCount).toBe(10)
    expect(staticCount).not.toBe(30)
  })

  it('累计到 hangAfter 批（首屏算第 1 批）后挂起：两次点击追加到 30 行，按钮变「加载中…」', async () => {
    const page = await mountPage(PATH)
    expect(page.rowCount()).toBe(10)

    page.click()
    expect(page.rowCount()).toBe(20)
    expect(page.buttonText()).toBe('加载更多')

    page.click()
    expect(page.rowCount()).toBe(30)
    expect(page.buttonText()).toBe('加载中…')
  })

  it('挂起之后继续点击：行数不再增加，按钮不被移除，文案保持「加载中…」', async () => {
    const page = await mountPage(PATH)
    for (let i = 0; i < 10; i++) page.click()
    expect(page.rowCount()).toBe(30)
    expect(page.buttonText()).toBe('加载中…')
    expect(page.buttonRemoved()).toBe(false)
  })

  it('挂起签名（判卷区分 stuck 与 end-of-list 的依据）：点击耗尽后按钮仍在、文案为 loading、页面无结束文案', async () => {
    const page = await mountPage(PATH)
    for (let i = 0; i < 10; i++) page.click()
    expect(page.buttonRemoved()).toBe(false)
    expect(page.buttonText()).toBe(LOADING_TEXT.zh)
    expect(markupOf(page.html)).not.toMatch(/到底|没有更多|已全部|没有其他/)
  })

  it('行号连续：末行是商品 30 / ¥130，之后不出现商品 31', async () => {
    const page = await mountPage(PATH)
    page.click()
    page.click()
    expect(page.listHtml()).toContain('<span class="title">商品 30</span><span class="price">¥130</span>')
    expect(page.listHtml()).not.toContain('商品 31')
  })

  it('挂起行数 = batchSize × hangAfter，与具体数值无关', async () => {
    const page = await mountPage('/dev-fixtures/playground/hang-after?batchSize=5&hangAfter=4')
    expect(page.rowCount()).toBe(5)
    for (let i = 0; i < 8; i++) page.click()
    expect(page.rowCount()).toBe(20)
    expect(page.buttonText()).toBe('加载中…')
    expect(page.buttonRemoved()).toBe(false)
  })

  it('hangAfter=1：首屏即挂起，按钮一开始就是「加载中…」，点击无效', async () => {
    const { html } = await fetchHtml('/dev-fixtures/playground/hang-after?batchSize=10&hangAfter=1')
    expect(html).toContain('<button id="load-more" class="load-more" type="button">加载中…</button>')

    const page = await mountPage('/dev-fixtures/playground/hang-after?batchSize=10&hangAfter=1')
    page.click()
    page.click()
    expect(page.rowCount()).toBe(10)
    expect(page.buttonText()).toBe('加载中…')
  })

  it('脚本里的 batchSize 与 hangAfter 与 query 一致', async () => {
    const { html } = await fetchHtml('/dev-fixtures/playground/hang-after?batchSize=7&hangAfter=5')
    expect(scriptOf(html)).toContain('var batchSize = 7;')
    expect(scriptOf(html)).toContain('var hangAfter = 5;')
  })

  it('默认值 batchSize=10、hangAfter=3；非法值回落到默认', async () => {
    const defaults = await mountPage('/dev-fixtures/playground/hang-after')
    expect(defaults.rowCount()).toBe(10)
    defaults.click()
    defaults.click()
    expect(defaults.rowCount()).toBe(30)
    expect(defaults.buttonText()).toBe('加载中…')

    const invalid = await mountPage('/dev-fixtures/playground/hang-after?batchSize=abc&hangAfter=xyz')
    expect(invalid.rowCount()).toBe(10)
    invalid.click()
    invalid.click()
    expect(invalid.rowCount()).toBe(30)
  })

  it('越界数值被夹到范围内（不是 404）', async () => {
    const tinyBatch = await fetchHtml('/dev-fixtures/playground/hang-after?batchSize=0')
    expect(tinyBatch.status).toBe(200)
    expect(countMatches(tinyBatch.html, /<li /g)).toBe(1)

    const hugeBatch = await fetchHtml('/dev-fixtures/playground/hang-after?batchSize=999')
    expect(hugeBatch.status).toBe(200)
    expect(countMatches(hugeBatch.html, /<li /g)).toBe(50)

    const zeroHang = await mountPage('/dev-fixtures/playground/hang-after?hangAfter=0')
    expect(zeroHang.rowCount()).toBe(10)
    expect(zeroHang.buttonText()).toBe('加载中…')

    const manyHang = await mountPage('/dev-fixtures/playground/hang-after?batchSize=10&hangAfter=99')
    for (let i = 0; i < 25; i++) manyHang.click()
    expect(manyHang.rowCount()).toBe(200)
    expect(manyHang.buttonText()).toBe('加载中…')
  })
})

describe('playground · hang-after 文案与 class 变体', () => {
  it('lang=en：按钮为 Load more，挂起后变为 Loading…，行文案为 Item n / $n', async () => {
    const { html } = await fetchHtml('/dev-fixtures/playground/hang-after?batchSize=8&hangAfter=4&lang=en&classes=hash')
    expect(buttonTextOf(html)).toBe('Load more')
    expect(markupOf(html)).toContain('Item 1')
    expect(markupOf(html)).toContain('$101')

    const page = await mountPage('/dev-fixtures/playground/hang-after?batchSize=8&hangAfter=4&lang=en&classes=hash')
    for (let i = 0; i < 3; i++) page.click()
    expect(page.rowCount()).toBe(32)
    expect(page.buttonText()).toBe('Loading…')
    expect(page.buttonRemoved()).toBe(false)
  })

  it('lang=ja：按钮为 さらに読み込む，挂起后变为 読み込み中…', async () => {
    const path = '/dev-fixtures/playground/hang-after?batchSize=5&hangAfter=6&lang=ja&classes=semantic'
    const { html } = await fetchHtml(path)
    expect(buttonTextOf(html)).toBe('さらに読み込む')
    expect(markupOf(html)).toContain('アイテム 1')

    const page = await mountPage(path)
    for (let i = 0; i < 5; i++) page.click()
    expect(page.rowCount()).toBe(30)
    expect(page.buttonText()).toBe('読み込み中…')
    expect(page.buttonRemoved()).toBe(false)
  })

  it('classes=hash：行、标题、价格、按钮都是哈希 class（没有 item / load-more），挂起行为不变', async () => {
    const path = '/dev-fixtures/playground/hang-after?batchSize=10&hangAfter=3&classes=hash'
    const { html } = await fetchHtml(path)
    expect(markupOf(html)).not.toContain('class="item"')
    expect(markupOf(html)).not.toContain('class="load-more"')
    expect(html).toContain('<button id="load-more" class="m1c5e8" type="button">加载更多</button>')

    const page = await mountPage(path)
    expect(page.rowCount()).toBe(10)
    page.click()
    page.click()
    expect(page.rowCount()).toBe(30)
    expect(page.buttonText()).toBe('加载中…')
  })

  it('lang / classes 非法值回落到默认（zh + semantic），输出与无参数完全一致', async () => {
    const fallback = await fetchHtml('/dev-fixtures/playground/hang-after?lang=fr&classes=xx')
    const plain = await fetchHtml(PATH)
    expect(fallback.html).toBe(plain.html)
  })
})

describe('playground · hang-after 生产环境屏蔽', () => {
  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it('NODE_ENV=production 时返回 404', async () => {
    vi.stubEnv('NODE_ENV', 'production')
    const { status } = await fetchHtml(PATH)
    expect(status).toBe(404)
  })
})

/** 变体货币符号：与 route.ts 的 TEXT[lang].currency 一致。 */
const CURRENCY: Record<string, string> = { zh: '¥', en: '$', ja: '¥' }

describe.each(F5_CASES)('case %s 与路由输出同步', (id) => {
  const caseFile = readCaseFile<{ url: string; pattern: string[]; variant: { lang: string } }>(id, 'case.json')
  const expected = readCaseFile<{
    expectedRows: number
    rowMatch: { selector: string; textPrefix: string }
    oracle: { strategy: string; clickSelector: string }
    naive: { strategy: string; expectedRows: number }
    stopSignal: Array<{ selector: string; exists?: boolean; textIncludes?: string }>
    trapVerifiedBy: string
  }>(id, 'expected.json')
  const caseUrl = new URL(caseFile.url, BASE)
  const batchSize = Number(caseUrl.searchParams.get('batchSize'))

  it('case 指向本路由，并标注 F5；trapVerifiedBy 为 stopSignal', () => {
    expect(caseUrl.pathname).toBe('/dev-fixtures/playground/hang-after')
    expect(caseFile.pattern).toContain('F5')
    expect(expected.trapVerifiedBy).toBe('stopSignal')
  })

  it('陷阱存在：首屏静态数行等于 batchSize，不等于 expectedRows', async () => {
    const { html } = await fetchHtml(caseFile.url)
    expect(countMatches(html, /<li /g)).toBe(batchSize)
    expect(batchSize).not.toBe(expected.expectedRows)
  })

  it('naive 只看首屏：静态数行得 naive.expectedRows（= batchSize），与 expectedRows 不同', async () => {
    expect(expected.naive).toEqual({ strategy: 'static', expectedRows: batchSize })
    const { html } = await fetchHtml(caseFile.url)
    expect(countMatches(html, /<li /g)).toBe(expected.naive.expectedRows)
    expect(expected.naive.expectedRows).not.toBe(expected.expectedRows)
  })

  it('stopSignal：点击耗尽后 #load-more 仍在、文案含 textIncludes（挂起，不是到底）', async () => {
    const [loadingSignal] = expected.stopSignal
    expect(loadingSignal).toEqual({ selector: '#load-more', exists: true, textIncludes: expect.any(String) })
    const page = await mountPage(caseFile.url)
    for (let i = 0; i < 100; i++) page.click()
    expect(page.buttonRemoved()).toBe(false)
    expect(page.buttonText()).toContain(loadingSignal.textIncludes ?? '')
    expect(LOADING_TEXT[caseFile.variant.lang]).toContain(loadingSignal.textIncludes ?? '')
  })

  it('点击耗尽后行数等于 expectedRows，按钮仍在且文案为该语言的 loading 文案（挂起签名）', async () => {
    const page = await mountPage(caseFile.url)
    for (let i = 0; i < 100; i++) page.click()
    expect(page.rowCount()).toBe(expected.expectedRows)
    expect(page.buttonRemoved()).toBe(false)
    expect(page.buttonText()).toBe(LOADING_TEXT[caseFile.variant.lang])
  })

  it('oracle 的 clickSelector 指向本页按钮，rowMatch 的 textPrefix 与每行标题一致', async () => {
    expect(expected.oracle.clickSelector).toBe('#load-more')
    const page = await mountPage(caseFile.url)
    const cells = cellsOf(page.listHtml())
    expect(cells.length).toBeGreaterThan(0)
    expect(cells.every(([title]) => title.startsWith(expected.rowMatch.textPrefix))).toBe(true)
  })

  it('首三行的标题与价格与变体文案一致（页面没有表头，不写 expectedColumns 键）', async () => {
    const page = await mountPage(caseFile.url)
    const cells = cellsOf(page.listHtml()).slice(0, 3)
    const currency = CURRENCY[caseFile.variant.lang]
    expect(cells.map(([title]) => title)).toEqual([1, 2, 3].map((n) => `${expected.rowMatch.textPrefix}${n}`))
    expect(cells.map(([, price]) => price)).toEqual([1, 2, 3].map((n) => `${currency}${100 + n}`))
  })
})
