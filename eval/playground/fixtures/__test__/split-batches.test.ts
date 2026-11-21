import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

import { NextRequest } from '../_lib/next-shim'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { GET as splitBatches } from '../split-batches/route'

const BASE = 'http://localhost:3008'
const PATH = '/dev-fixtures/playground/split-batches'

async function fetchHtml(query: string): Promise<{ status: number; html: string }> {
  const response = await splitBatches(new NextRequest(`${BASE}${PATH}${query}`))
  return { status: response.status, html: await response.text() }
}

/** 去掉脚本后的 DOM：脚本里的字符串模板不算渲染出来的内容。 */
function markupOf(html: string): string {
  return html.replace(/<script>[\s\S]*?<\/script>/g, '')
}

/** #list 的内部标记：只包含列表项。 */
function listInner(html: string): string {
  const match = html.match(/<ul id="list">\n([\s\S]*?)\n<\/ul>/)
  if (!match) throw new Error('没有 #list')
  return match[1]
}

function countRows(markup: string): number {
  return (markup.match(/<li class="item">/g) ?? []).length
}

function scriptOf(html: string): string {
  const match = html.match(/<script>\n([\s\S]*?)\n<\/script>/)
  if (!match) throw new Error('脚本缺失')
  return match[1]
}

/** 脚本顶部的 var 赋值，例如 `var splitMs = 400;`。 */
function scriptVar(html: string, name: string): number {
  const match = scriptOf(html).match(new RegExp(`var ${name} = (-?\\d+);`))
  if (!match) throw new Error(`脚本里没有 ${name}`)
  return Number(match[1])
}

/**
 * 用假 DOM 执行页面脚本，只实现脚本用到的接口：getElementById / insertAdjacentHTML / addEventListener / remove。
 * 调用前要先 vi.useFakeTimers()，脚本里的 setTimeout 才会被控制。
 */
function mountPage(html: string) {
  const hasButton = html.includes('id="load-more"')
  let listMarkup = listInner(html)
  let removed = false
  const clickListeners: Array<() => void> = []

  const list = {
    insertAdjacentHTML(_position: string, fragment: string) {
      listMarkup += fragment
    },
  }
  const button = {
    addEventListener(type: string, listener: () => void) {
      if (type === 'click') clickListeners.push(listener)
    },
    remove() {
      removed = true
    },
  }
  const fakeDocument = {
    getElementById(id: string) {
      if (id === 'list') return list
      if (id === 'load-more') return hasButton ? button : null
      return null
    },
  }

  new Function('document', 'setTimeout', scriptOf(html))(fakeDocument, setTimeout)

  return {
    click() {
      for (const listener of clickListeners) listener()
    },
    rowCount: () => countRows(listMarkup),
    titles: () => [...listMarkup.matchAll(/商品 (\d+)/g)].map((match) => Number(match[1])),
    buttonRemoved: () => removed,
  }
}

describe('playground · split-batches（D10 分两批到达的加载更多）', () => {
  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllEnvs()
  })

  it('首屏只有 perPage 行，#list 里只有数据行，按钮 #load-more 存在；静态数行得 10，不等于 expectedRows 30', async () => {
    const { status, html } = await fetchHtml('?pages=3&perPage=10&splitMs=400')
    expect(status).toBe(200)
    expect(listInner(html)).not.toMatch(/<li(?! class="item")/)
    expect(countRows(listInner(html))).toBe(10)
    expect(markupOf(html)).toContain('<button id="load-more" type="button">加载更多</button>')
    expect(countRows(listInner(html))).not.toBe(30)
  })

  it('首屏第一行的文案与价格', async () => {
    const { html } = await fetchHtml('?pages=3&perPage=10&splitMs=400')
    expect(listInner(html)).toContain(
      '<li class="item"><span class="title">商品 1</span><span class="price">¥101</span></li>'
    )
  })

  it('脚本参数：每批立即追加 floor(perPage * 0.4) = 4 行，其余 6 行延后 splitMs = 400 毫秒', async () => {
    const { html } = await fetchHtml('?pages=3&perPage=10&splitMs=400')
    expect(scriptVar(html, 'pages')).toBe(3)
    expect(scriptVar(html, 'perPage')).toBe(10)
    expect(scriptVar(html, 'immediate')).toBe(4)
    expect(scriptVar(html, 'splitMs')).toBe(400)
  })

  it('陷阱存在：点击后立刻快照只新增 4 行（共 14），400 毫秒之前不会再多', async () => {
    const { html } = await fetchHtml('?pages=3&perPage=10&splitMs=400')
    vi.useFakeTimers()
    const page = mountPage(html)

    page.click()
    expect(page.rowCount()).toBe(14)
    vi.advanceTimersByTime(399)
    expect(page.rowCount()).toBe(14)
    vi.advanceTimersByTime(1)
    expect(page.rowCount()).toBe(20)
  })

  it('走完三批：两次点击后共 30 行，编号连续；第二次点击后按钮即被移除，但最后一批的后半段还没到（24 行）', async () => {
    const { html } = await fetchHtml('?pages=3&perPage=10&splitMs=400')
    vi.useFakeTimers()
    const page = mountPage(html)

    page.click()
    vi.advanceTimersByTime(400)
    expect(page.rowCount()).toBe(20)
    expect(page.buttonRemoved()).toBe(false)

    page.click()
    expect(page.buttonRemoved()).toBe(true)
    expect(page.rowCount()).toBe(24)

    vi.advanceTimersByTime(400)
    expect(page.rowCount()).toBe(30)
    expect(page.titles()).toEqual(Array.from({ length: 30 }, (_, index) => index + 1))
  })

  it('pages=2：一次点击后按钮即移除，等 splitMs 之后共 20 行', async () => {
    const { html } = await fetchHtml('?pages=2&perPage=10&splitMs=400')
    vi.useFakeTimers()
    const page = mountPage(html)

    page.click()
    expect(page.buttonRemoved()).toBe(true)
    expect(page.rowCount()).toBe(14)
    vi.advanceTimersByTime(400)
    expect(page.rowCount()).toBe(20)
  })

  it('pages=1：没有按钮也没有脚本，只有首屏 perPage 行', async () => {
    const { status, html } = await fetchHtml('?pages=1&perPage=10')
    expect(status).toBe(200)
    expect(html).not.toContain('id="load-more"')
    expect(html).not.toContain('<script>')
    expect(countRows(listInner(html))).toBe(10)
  })

  it('非法数值回落到默认值：pages=3、perPage=10、splitMs=400', async () => {
    const { status, html } = await fetchHtml('?pages=abc&perPage=xyz&splitMs=')
    expect(status).toBe(200)
    expect(scriptVar(html, 'pages')).toBe(3)
    expect(scriptVar(html, 'perPage')).toBe(10)
    expect(scriptVar(html, 'splitMs')).toBe(400)
  })

  it('越界数值夹到上下界而不是 404：pages 最大 20、perPage 最大 50、splitMs 最大 3000', async () => {
    const tooLarge = await fetchHtml('?pages=99&perPage=999&splitMs=99999')
    expect(tooLarge.status).toBe(200)
    expect(scriptVar(tooLarge.html, 'pages')).toBe(20)
    expect(scriptVar(tooLarge.html, 'perPage')).toBe(50)
    expect(scriptVar(tooLarge.html, 'splitMs')).toBe(3000)
    expect(countRows(listInner(tooLarge.html))).toBe(50)
  })

  it('越界数值夹到下界：perPage=0 变成 1 行，immediate 为 0，splitMs=-5 变成 0', async () => {
    const tooSmall = await fetchHtml('?pages=2&perPage=0&splitMs=-5')
    expect(tooSmall.status).toBe(200)
    expect(scriptVar(tooSmall.html, 'perPage')).toBe(1)
    expect(scriptVar(tooSmall.html, 'immediate')).toBe(0)
    expect(scriptVar(tooSmall.html, 'splitMs')).toBe(0)
    expect(countRows(listInner(tooSmall.html))).toBe(1)

    vi.useFakeTimers()
    const page = mountPage(tooSmall.html)
    page.click()
    expect(page.rowCount()).toBe(1)
    vi.runOnlyPendingTimers()
    expect(page.rowCount()).toBe(2)
  })

  it('pages 低于下界时夹到 1：没有按钮', async () => {
    const { status, html } = await fetchHtml('?pages=-4&perPage=10&splitMs=400')
    expect(status).toBe(200)
    expect(html).not.toContain('id="load-more"')
    expect(countRows(listInner(html))).toBe(10)
  })
})

/** D10-001 的 case 文件：oracle 实际访问的 url 从这里读，避免测试和 case 各自写一份参数。 */
const D10_CASE_FILE = fileURLToPath(
  new URL('../../cases/D10-001/case.json', import.meta.url)
)

function d10CaseQuery(): string {
  const { url } = JSON.parse(readFileSync(D10_CASE_FILE, 'utf-8')) as { url: string }
  const index = url.indexOf('?')
  if (index < 0) throw new Error('D10-001 的 url 没有 query')
  return url.slice(index)
}

/** D10-001 的 expected.json：naive 与 expectedRows 在这里对照路由输出确认。 */
const D10_EXPECTED_FILE = fileURLToPath(
  new URL('../../cases/D10-001/expected.json', import.meta.url)
)

interface D10Expected {
  expectedRows: number
  naive: { strategy: string; clickSelector: string; expectedRows: number }
  trapVerifiedBy: string
}

describe('playground · split-batches 与 D10-001 的 expected.json', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it('naive 点击一次后立即计数得 naive.expectedRows = 14（首批 10 + 立即到的 4 行），陷阱由 naive 证明', async () => {
    const expected = JSON.parse(readFileSync(D10_EXPECTED_FILE, 'utf-8')) as D10Expected
    expect(expected.naive.strategy).toBe('click-once-now')
    expect(expected.naive.clickSelector).toBe('#load-more')
    expect(expected.trapVerifiedBy).toBe('naive')
    const { html } = await fetchHtml(d10CaseQuery())
    vi.useFakeTimers()
    const page = mountPage(html)
    page.click()
    expect(page.rowCount()).toBe(expected.naive.expectedRows)
    expect(expected.naive.expectedRows).toBe(14)
    expect(expected.naive.expectedRows).not.toBe(expected.expectedRows)
  })

  it('两次点击后推进到所有定时器结束，行数等于 expectedRows = 30（正确交互能拿到全部批次）', async () => {
    const expected = JSON.parse(readFileSync(D10_EXPECTED_FILE, 'utf-8')) as D10Expected
    const { html } = await fetchHtml(d10CaseQuery())
    vi.useFakeTimers()
    const page = mountPage(html)
    page.click()
    page.click()
    vi.runOnlyPendingTimers()
    expect(page.rowCount()).toBe(expected.expectedRows)
    expect(expected.expectedRows).toBe(30)
  })
})

describe('playground · split-batches 生产环境屏蔽', () => {
  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it('NODE_ENV=production 时返回 404', async () => {
    vi.stubEnv('NODE_ENV', 'production')
    const { status } = await fetchHtml('?pages=3&perPage=10&splitMs=400')
    expect(status).toBe(404)
  })
})
