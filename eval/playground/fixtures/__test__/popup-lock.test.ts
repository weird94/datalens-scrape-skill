import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

import { NextRequest } from '../_lib/next-shim'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { GET as popupLock } from '../popup-lock/route'

const BASE = 'http://localhost:3008'
const PATH = '/dev-fixtures/playground/popup-lock'
const VIEWPORT = 800

async function fetchPage(query: string): Promise<{ status: number; html: string }> {
  const response = await popupLock(new NextRequest(`${BASE}${PATH}${query}`))
  return { status: response.status, html: await response.text() }
}

/** 去掉内联脚本后的 DOM 片段：脚本里的字符串模板也含 <li class="item">，不能算进静态行数。 */
function markupOf(html: string): string {
  return html.replace(/<script>[\s\S]*?<\/script>/g, '')
}

function countRows(html: string): number {
  return (markupOf(html).match(/<li class="item">/g) ?? []).length
}

function rowTitles(html: string): string[] {
  return Array.from(markupOf(html).matchAll(/<span class="title">([^<]*)<\/span>/g), (match) => match[1])
}

function clientScript(html: string): string {
  const match = html.match(/<script>\n([\s\S]*?)\n<\/script>/)
  if (!match) throw new Error('页面里没有内联脚本')
  return match[1]
}

interface PopupPage {
  rows: () => number
  overflow: () => string
  popupOpen: () => boolean
  scrollToBottom: () => void
  clickClose: () => void
}

/**
 * 在最小假 DOM 里执行页面自带的脚本，只实现脚本实际用到的接口。
 * 目的：验证「弹窗期间滚动不续载、关闭后续载恢复」这个陷阱在 mock 里是真的，不只是 markup 上看起来像。
 * 定时器由调用方用 vi.useFakeTimers() 控制（脚本里的 setTimeout 会被替换）。
 */
function mountPage(html: string): PopupPage {
  let rowCount = countRows(html)
  let overflow = ''
  let popup: { remove: () => void } | null = null
  let closeHandler: (() => void) | null = null
  let scrollY = 0
  const scrollListeners: Array<() => void> = []

  const list = {
    insertAdjacentHTML: (_position: string, markup: string) => {
      rowCount += countRows(markup)
    },
  }

  const windowStub = {
    innerHeight: VIEWPORT,
    get scrollY() {
      return scrollY
    },
    addEventListener: (type: string, fn: () => void) => {
      if (type === 'scroll') scrollListeners.push(fn)
    },
  }

  const documentStub = {
    documentElement: {
      get scrollHeight() {
        // 页面高度随行数增长；200vh 的 body 保证首批 10 行也能滚动
        return Math.max(VIEWPORT * 2, 1600 + rowCount * 87)
      },
    },
    body: {
      style: {
        get overflow() {
          return overflow
        },
        set overflow(value: string) {
          overflow = value
        },
      },
      appendChild: (node: { remove: () => void }) => {
        popup = node
      },
    },
    getElementById: (id: string) => {
      if (id === 'list') return list
      if (id === 'popup-tpl') {
        return { content: { cloneNode: () => ({ remove: () => (popup = null) }) } }
      }
      return null
    },
    querySelector: (selector: string) => {
      if (selector === '.popup') return popup
      if (selector === '.popup-close') {
        return popup
          ? {
              addEventListener: (_type: string, fn: () => void) => {
                closeHandler = fn
              },
            }
          : null
      }
      return null
    },
  }

  new Function('window', 'document', clientScript(html))(windowStub, documentStub)

  return {
    rows: () => rowCount,
    overflow: () => overflow,
    popupOpen: () => popup !== null,
    scrollToBottom: () => {
      scrollY = Math.max(0, documentStub.documentElement.scrollHeight - VIEWPORT)
      for (const fn of scrollListeners) fn()
    },
    clickClose: () => {
      closeHandler?.()
    },
  }
}

/**
 * 先用真实计时器取页面（路由本身不依赖计时器），再装上假计时器挂载脚本，
 * 这样脚本里的 setTimeout 由测试控制。
 */
async function mountWith(query: string): Promise<PopupPage> {
  vi.useRealTimers()
  const { html } = await fetchPage(query)
  vi.useFakeTimers()
  return mountPage(html)
}

/** D11-001 的 case.json / expected.json：oracle 实际访问的 url 与 naive / expectedRows 从这里读。 */
function readD11Case<T>(file: 'case.json' | 'expected.json'): T {
  const path = fileURLToPath(new URL(`../../cases/D11-001/${file}`, import.meta.url))
  return JSON.parse(readFileSync(path, 'utf-8')) as T
}

interface D11Expected {
  expectedRows: number
  oracle: { strategy: string; dismissSelector: string }
  naive: { strategy: string; expectedRows: number }
  trapVerifiedBy: string
}

/** 滚动若干轮，模拟 scroll-window oracle 的反复 scrollTo。 */
function scrollRounds(page: PopupPage, rounds: number): void {
  for (let round = 0; round < rounds; round += 1) page.scrollToBottom()
}

describe('playground · popup-lock 与 D11-001 的 expected.json', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it('naive（不关弹窗，一直滚到底）只拿到第 2 批：得 naive.expectedRows = 20，弹窗已锁住滚动', async () => {
    const expected = readD11Case<D11Expected>('expected.json')
    expect(expected.naive.strategy).toBe('scroll-window')
    expect(expected.trapVerifiedBy).toBe('naive')
    const { url } = readD11Case<{ url: string }>('case.json')
    const page = await mountWith(url.slice(url.indexOf('?')))
    scrollRounds(page, 6)
    expect(page.rows()).toBe(expected.naive.expectedRows)
    expect(expected.naive.expectedRows).toBe(20)
    expect(page.popupOpen()).toBe(true)
    expect(page.overflow()).toBe('hidden')
    expect(expected.naive.expectedRows).not.toBe(expected.expectedRows)
  })

  it('正确交互：墙钟到点弹窗 → 点关闭 → 滚动续载，最终得 expectedRows = 40', async () => {
    const expected = readD11Case<D11Expected>('expected.json')
    expect(expected.oracle.strategy).toBe('dismiss-then-scroll')
    expect(expected.oracle.dismissSelector).toBe('.popup-close')
    const { url } = readD11Case<{ url: string }>('case.json')
    const page = await mountWith(url.slice(url.indexOf('?')))
    vi.advanceTimersByTime(2000)
    expect(page.popupOpen()).toBe(true)
    expect(page.rows()).toBe(10)
    page.clickClose()
    expect(page.popupOpen()).toBe(false)
    scrollRounds(page, 6)
    expect(page.rows()).toBe(expected.expectedRows)
    expect(expected.expectedRows).toBe(40)
    vi.advanceTimersByTime(5000)
    expect(page.popupOpen()).toBe(false)
  })
})

describe('playground · popup-lock（D11）', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it('默认 40 行目标，服务端只渲染首批 10 行，标题与价格按序', async () => {
    const { status, html } = await fetchPage('')
    expect(status).toBe(200)
    expect(countRows(html)).toBe(10)
    const titles = rowTitles(html)
    expect(titles[0]).toBe('商品 1')
    expect(titles[9]).toBe('商品 10')
    expect(html).toContain('<span class="price">¥101</span>')
    expect(html).toContain('<span class="price">¥110</span>')
  })

  it('静态直接数行得到 10，不等于 rows=40 的正确值（陷阱存在）', async () => {
    const { html } = await fetchPage('?rows=40&popupAfterMs=2000')
    expect(countRows(html)).toBe(10)
    expect(countRows(html)).not.toBe(40)
  })

  it('rows 不超过一批时首批即是全部，静态数行就是全部', async () => {
    const { html } = await fetchPage('?rows=5')
    expect(countRows(html)).toBe(5)
    expect(clientScript(html)).toContain('var TOTAL = 5;')
    expect(clientScript(html)).toContain('var loaded = 5;')
  })

  it('弹窗模板放在 <template> 里：去掉模板后的 markup 中没有遮罩，模板内恰有一个遮罩与「关闭」按钮', async () => {
    const { html } = await fetchPage('?rows=40&popupAfterMs=2000')
    const template = html.match(/<template id="popup-tpl">([\s\S]*?)<\/template>/)
    expect(template).not.toBeNull()
    const outside = markupOf(html).replace(/<template id="popup-tpl">[\s\S]*?<\/template>/, '')
    expect(outside).not.toMatch(/class="popup/)
    expect(template![1].match(/class="popup"/g)).toHaveLength(1)
    expect(template![1]).toContain('<button class="popup-close" type="button">关闭</button>')
  })

  it('内联脚本可解析，包含锁滚动、续载守卫、批数触发与墙钟触发', async () => {
    const { html } = await fetchPage('?rows=40&popupAfterMs=2000')
    const script = clientScript(html)
    expect(() => new Function(script)).not.toThrow()
    expect(script).toContain("document.body.style.overflow = 'hidden'")
    expect(script).toContain("document.body.style.overflow = ''")
    expect(script).toContain('if (locked || loaded >= TOTAL) return;')
    expect(script).toContain('var TOTAL = 40;')
    expect(script).toContain('var POPUP_AFTER = 2000;')
    expect(script).toContain('var POPUP_AT = 20;')
    expect(script).toContain('setTimeout(showPopup, POPUP_AFTER);')
  })

  it('rows 不超过一批时：完整列表不弹窗（墙钟到点也不弹）', async () => {
    const page = await mountWith('?rows=5&popupAfterMs=2000')
    page.scrollToBottom()
    vi.advanceTimersByTime(5000)
    expect(page.rows()).toBe(5)
    expect(page.popupOpen()).toBe(false)
    expect(page.overflow()).toBe('')
  })

  it('已加载行数恰好等于 rows 时不弹窗（没有需要锁住的续载）', async () => {
    const page = await mountWith('?rows=20&popupAfterMs=2000')
    page.scrollToBottom()
    expect(page.rows()).toBe(20)
    vi.advanceTimersByTime(5000)
    expect(page.popupOpen()).toBe(false)
    expect(page.overflow()).toBe('')
  })

  it('弹窗前的滚动正常续载：popupAfterBatch=3 时第 2 批不弹窗，第 3 批弹出并挡住之后的滚动', async () => {
    const page = await mountWith('?rows=40&popupAfterMs=2000&popupAfterBatch=3')
    page.scrollToBottom()
    expect(page.rows()).toBe(20)
    expect(page.popupOpen()).toBe(false)
    page.scrollToBottom()
    expect(page.rows()).toBe(30)
    expect(page.popupOpen()).toBe(true)
    page.scrollToBottom()
    expect(page.rows()).toBe(30)
  })

  it('墙钟触发：无滚动时 popupAfterMs 到点弹出，弹窗期间 body 锁滚动、滚动不续载', async () => {
    const page = await mountWith('?rows=40&popupAfterMs=2000&popupAfterBatch=3')
    vi.advanceTimersByTime(1999)
    expect(page.popupOpen()).toBe(false)
    vi.advanceTimersByTime(1)
    expect(page.popupOpen()).toBe(true)
    expect(page.overflow()).toBe('hidden')
    page.scrollToBottom()
    page.scrollToBottom()
    page.scrollToBottom()
    expect(page.rows()).toBe(10)
  })

  it('快速采集器（不推进时间）：滚到第 2 批即弹窗并挡住，与墙钟无关（陷阱：弹窗期间滚动完全无效）', async () => {
    const page = await mountWith('?rows=40&popupAfterMs=2000')
    page.scrollToBottom()
    expect(page.rows()).toBe(20)
    expect(page.popupOpen()).toBe(true)
    expect(page.overflow()).toBe('hidden')
    for (let round = 0; round < 5; round += 1) {
      page.scrollToBottom()
    }
    expect(page.rows()).toBe(20)
  })

  it('popupAfterMs 设得很大时仍在第 2 批挡住，快速采集器拿不到第 3 批', async () => {
    const page = await mountWith('?rows=40&popupAfterMs=10000')
    page.scrollToBottom()
    expect(page.rows()).toBe(20)
    expect(page.popupOpen()).toBe(true)
    page.scrollToBottom()
    expect(page.rows()).toBe(20)
  })

  it('popupAfterBatch=1：首屏即弹窗，之后滚动不续载', async () => {
    const page = await mountWith('?rows=40&popupAfterBatch=1')
    expect(page.popupOpen()).toBe(true)
    expect(page.rows()).toBe(10)
    page.scrollToBottom()
    expect(page.rows()).toBe(10)
  })

  it('点关闭后移除遮罩、恢复 overflow，滚动续载到 40 行并稳定；弹窗只出现一次', async () => {
    const page = await mountWith('?rows=40&popupAfterMs=2000')
    page.scrollToBottom()
    expect(page.popupOpen()).toBe(true)
    expect(page.rows()).toBe(20)

    page.clickClose()
    expect(page.popupOpen()).toBe(false)
    expect(page.overflow()).toBe('')

    for (let round = 0; round < 6; round += 1) {
      page.scrollToBottom()
    }
    expect(page.rows()).toBe(40)
    // 墙钟仍会走到 popupAfterMs，但弹窗已出现过，不应再弹
    vi.advanceTimersByTime(5000)
    expect(page.popupOpen()).toBe(false)
    page.scrollToBottom()
    expect(page.rows()).toBe(40)
  })

  it('rows 越界按 intParam 夹到 [1, 100]，非数字回落到默认 40', async () => {
    const high = await fetchPage('?rows=999')
    expect(high.status).toBe(200)
    expect(countRows(high.html)).toBe(10)
    expect(clientScript(high.html)).toContain('var TOTAL = 100;')

    const low = await fetchPage('?rows=0')
    expect(low.status).toBe(200)
    expect(countRows(low.html)).toBe(1)
    expect(clientScript(low.html)).toContain('var TOTAL = 1;')

    const garbage = await fetchPage('?rows=abc')
    expect(garbage.status).toBe(200)
    expect(clientScript(garbage.html)).toContain('var TOTAL = 40;')
  })

  it('popupAfterMs 越界夹到 [0, 10000]，非数字回落到默认 2000', async () => {
    const high = await fetchPage('?popupAfterMs=99999')
    expect(clientScript(high.html)).toContain('var POPUP_AFTER = 10000;')

    const low = await fetchPage('?popupAfterMs=-5')
    expect(clientScript(low.html)).toContain('var POPUP_AFTER = 0;')

    const garbage = await fetchPage('?popupAfterMs=abc')
    expect(clientScript(garbage.html)).toContain('var POPUP_AFTER = 2000;')
  })

  it('popupAfterBatch 越界夹到 [1, 10]，非数字回落到默认 2（POPUP_AT 分别为 10 / 100 / 20）', async () => {
    const low = await fetchPage('?popupAfterBatch=0')
    expect(clientScript(low.html)).toContain('var POPUP_AT = 10;')

    const high = await fetchPage('?popupAfterBatch=99')
    expect(clientScript(high.html)).toContain('var POPUP_AT = 100;')

    const garbage = await fetchPage('?popupAfterBatch=abc')
    expect(clientScript(garbage.html)).toContain('var POPUP_AT = 20;')
  })

  it('生产环境返回 404（playgroundBlocked 是第一步）', async () => {
    vi.stubEnv('NODE_ENV', 'production')
    try {
      const { status } = await fetchPage('?rows=40')
      expect(status).toBe(404)
    } finally {
      vi.unstubAllEnvs()
    }
  })
})
