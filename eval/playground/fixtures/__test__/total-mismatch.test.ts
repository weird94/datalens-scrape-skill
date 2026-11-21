import { NextRequest } from '../_lib/next-shim'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { GET as totalMismatch } from '../total-mismatch/route'

const BASE = 'http://localhost:3008'
const PATH = '/dev-fixtures/playground/total-mismatch'

/** 与 route.ts 基础样式一致的估算：14px × 1.6 行高 + 上下 padding 16px + 边框 1px ≈ 39.4px。 */
const ROW_PX = 39.4
/** 标题（18px × 1.6 + 下边距 12px ≈ 40.8px）加 body 上下 margin 各 24px，合计 ≈ 88.8px。20 行时约 877px，与真实 Chromium 一致。 */
const CHROME_PX = 88.8

async function fetchHtml(query = ''): Promise<{ status: number; html: string }> {
  const response = await totalMismatch(new NextRequest(`${BASE}${PATH}${query}`))
  return { status: response.status, html: await response.text() }
}

/** 去掉脚本后的 DOM：脚本里的字符串模板不算渲染出来的内容。 */
function markupOf(html: string): string {
  return html.replace(/<script>[\s\S]*?<\/script>/g, '')
}

function scriptOf(html: string): string {
  const match = html.match(/<script>\n([\s\S]*?)\n<\/script>/)
  if (!match) throw new Error('页面里没有脚本')
  return match[1]
}

function countComments(markup: string): number {
  return (markup.match(/<li class="comment">/g) ?? []).length
}

function commentRowsOf(html: string): string[] {
  return markupOf(html).match(/<li class="comment">[\s\S]*?<\/li>/g) ?? []
}

function headingOf(html: string): string {
  const match = markupOf(html).match(/<h1>(.*?)<\/h1>/)
  if (!match) throw new Error('页面里没有标题')
  return match[1]
}

/** 页面样式里 body 的底部 padding（vh），没有则为 0。模拟器据此估算页面高度，与真实 CSS 一致。 */
function bodyBottomPaddingVh(html: string): number {
  const match = html.match(/body \{[^}]*padding-bottom: (\d+)vh/)
  return match ? Number(match[1]) : 0
}

interface Simulation {
  /** 模拟结束时列表里的行数。 */
  rows: number
  /** 每次续载追加的行数（不含首批）。 */
  appendSizes: number[]
  /** 每次续载追加的标记，按顺序。 */
  appended: string[]
}

interface SimulationOptions {
  rounds?: number
  innerHeight?: number
  /** 每轮都派发 scroll 事件，即使滚动位置没变（用来检验「到顶后继续滚动」的守卫）。 */
  alwaysDispatch?: boolean
}

/**
 * 在假 DOM 里执行页面脚本，每一轮把 window 滚到底、等续载延迟的定时器，与 oracle 的 scroll-window 同形。
 * 与浏览器一致：滚动位置没有变化就不派发 scroll 事件；文档高度按 route 的 CSS 估算，
 * 所以页面不可滚（视口高于文档）时续载不会触发。只用来验证 mock 的续载逻辑。
 */
function simulateScrollToBottom(html: string, options: SimulationOptions = {}): Simulation {
  const { rounds = 60, innerHeight = 720, alwaysDispatch = false } = options
  const handlers: Array<() => void> = []
  const timers: Array<() => void> = []
  const appended: string[] = []
  let rows = countComments(markupOf(html))
  const paddingBottomPx = (bodyBottomPaddingVh(html) * innerHeight) / 100

  const fakeWindow = {
    innerHeight,
    scrollY: 0,
    addEventListener(type: string, handler: () => void) {
      if (type === 'scroll') handlers.push(handler)
    },
  }
  const fakeDocument = {
    documentElement: {
      get scrollHeight() {
        return CHROME_PX + rows * ROW_PX + paddingBottomPx
      },
    },
    getElementById(id: string) {
      if (id !== 'list') return null
      return {
        insertAdjacentHTML(_position: string, markup: string) {
          appended.push(markup)
          rows += countComments(markup)
        },
      }
    },
  }
  const fakeSetTimeout = (callback: () => void) => {
    timers.push(callback)
    return 0
  }

  new Function('window', 'document', 'setTimeout', scriptOf(html))(fakeWindow, fakeDocument, fakeSetTimeout)

  for (let round = 0; round < rounds; round++) {
    // scrollTo(0, 底部) 会被夹到最大滚动量；位置没变则不派发 scroll 事件。
    const maxScroll = Math.max(0, fakeDocument.documentElement.scrollHeight - innerHeight)
    const moved = maxScroll !== fakeWindow.scrollY
    fakeWindow.scrollY = maxScroll
    if (moved || alwaysDispatch) handlers.forEach((handler) => handler())
    timers.splice(0).forEach((callback) => callback())
  }
  return { rows, appendSizes: appended.map(countComments), appended }
}

describe('playground · total-mismatch（E3 自称总数 ≠ 可采行数）', () => {
  it('标题写自称总数 160，但静态 HTML 里只有首批 20 行', async () => {
    const { status, html } = await fetchHtml('?shown=123&claimed=160&perBatch=20')
    expect(status).toBe(200)
    expect(headingOf(html)).toBe('共 160 条评论')
    const staticRows = countComments(markupOf(html))
    expect(staticRows).toBe(20)
    expect(staticRows).not.toBe(123)
    expect(staticRows).not.toBe(160)
  })

  it('E03-001 的 oracle 滚到底后得到 123 行（expectedRows），不是自称的 160', async () => {
    const { html } = await fetchHtml('?shown=123&claimed=160&perBatch=20')
    const result = simulateScrollToBottom(html)
    expect(result.rows).toBe(123)
    expect(result.rows).not.toBe(160)
    // 首批 20，之后追加 20 x 5 和末批 3，合计 123
    expect(result.appendSizes).toEqual([20, 20, 20, 20, 20, 3])
  })

  it('任何视口高度下都能续载到 shown：首批必然溢出视口，每次续载后滚动位置都能后移', async () => {
    const { html } = await fetchHtml('?shown=123&claimed=160&perBatch=20')
    // 页面底部 padding 至少 100vh，保证文档恒大于视口；否则视口够高时页面不可滚，续载根本不会触发。
    expect(bodyBottomPaddingVh(html)).toBeGreaterThanOrEqual(100)
    for (const innerHeight of [600, 720, 900, 1080, 1600, 2400]) {
      const result = simulateScrollToBottom(html, { innerHeight })
      expect(result.rows, `innerHeight=${innerHeight}`).toBe(123)
      expect(result.appendSizes, `innerHeight=${innerHeight}`).toEqual([20, 20, 20, 20, 20, 3])
    }
  })

  it('到达 shown 之后继续滚动不再追加，也没有到底文案或加载指示', async () => {
    const { html } = await fetchHtml('?shown=123&claimed=160&perBatch=20')
    expect(simulateScrollToBottom(html, { rounds: 6 }).rows).toBe(123)
    expect(simulateScrollToBottom(html, { rounds: 60, alwaysDispatch: true }).rows).toBe(123)

    const markup = markupOf(html)
    expect(markup).not.toMatch(/到底|没有更多|加载|loading/)
  })

  it('列表里只有 li.comment 数据行，textPrefix「评论 」能把它和其他元素区分开', async () => {
    const { html } = await fetchHtml('?shown=123&claimed=160&perBatch=20')
    const markup = markupOf(html)
    expect(markup.match(/<li/g)).toHaveLength(20)
    expect(markup.match(/<li class="comment"><span class="name">评论 \d+<\/span>/g)).toHaveLength(20)
    expect(markup.match(/<h1>共 160 条评论<\/h1>/g)).toHaveLength(1)
  })

  it('服务端渲染的首批行与脚本续载行逐字一致（同一个 commentRow 的两份实现）', async () => {
    // 首批 20 行全部由服务端渲染
    const server = await fetchHtml('?shown=20&claimed=160&perBatch=20')
    const serverRows = commentRowsOf(server.html)
    expect(serverRows).toHaveLength(20)

    // perBatch=1：服务端只渲染第 1 行，第 2–20 行全部由脚本里的 commentRow 产出
    const scripted = await fetchHtml('?shown=20&claimed=160&perBatch=1')
    expect(commentRowsOf(scripted.html)).toHaveLength(1)
    const result = simulateScrollToBottom(scripted.html)
    expect(result.rows).toBe(20)
    expect(result.appended).toHaveLength(19)
    result.appended.forEach((markup, index) => {
      expect(markup).toBe(serverRows[index + 1])
    })
  })

  it('续载追加的行与首批结构一致，末批只补到 shown', async () => {
    const { html } = await fetchHtml('?shown=123&claimed=160&perBatch=20')
    const result = simulateScrollToBottom(html)
    expect(result.appended[0]).toContain(
      '<li class="comment"><span class="name">评论 21</span><span class="text">第 21 条评论的内容。</span></li>'
    )
    expect(result.appended[5]).toContain('评论 121')
    expect(result.appended[5]).toContain('评论 123')
    expect(result.appended[5]).not.toContain('评论 124')
  })

  it('shown 不超过 perBatch 时只有首批，没有任何续载', async () => {
    const small = await fetchHtml('?shown=10&claimed=160&perBatch=20')
    expect(countComments(markupOf(small.html))).toBe(10)
    expect(simulateScrollToBottom(small.html).appendSizes).toEqual([])
  })

  it('shown 跨过一个批次时，按 perBatch 分批追加直到 shown', async () => {
    const { html } = await fetchHtml('?shown=50&claimed=160&perBatch=20')
    const result = simulateScrollToBottom(html)
    expect(result.rows).toBe(50)
    expect(result.appendSizes).toEqual([20, 10])
  })

  it('claimed 只影响标题，不影响可采行数', async () => {
    const { html } = await fetchHtml('?shown=123&claimed=999')
    expect(headingOf(html)).toBe('共 999 条评论')
    expect(simulateScrollToBottom(html).rows).toBe(123)
  })

  it('默认值是 shown=123、claimed=160、perBatch=20', async () => {
    const { html } = await fetchHtml('')
    expect(headingOf(html)).toBe('共 160 条评论')
    expect(countComments(markupOf(html))).toBe(20)
    expect(simulateScrollToBottom(html).rows).toBe(123)
  })

  it('越界值夹到范围内，非法值回落到默认（不是 404）', async () => {
    const low = await fetchHtml('?shown=0&claimed=0&perBatch=0')
    expect(low.status).toBe(200)
    expect(headingOf(low.html)).toBe('共 1 条评论')
    expect(countComments(markupOf(low.html))).toBe(1)
    expect(simulateScrollToBottom(low.html).rows).toBe(1)

    const high = await fetchHtml('?shown=99999&claimed=99999&perBatch=99999')
    expect(high.status).toBe(200)
    expect(headingOf(high.html)).toBe('共 1000 条评论')
    expect(countComments(markupOf(high.html))).toBe(100)
    expect(simulateScrollToBottom(high.html).rows).toBe(500)

    const invalid = await fetchHtml('?shown=abc&claimed=xyz&perBatch=')
    expect(invalid.status).toBe(200)
    expect(headingOf(invalid.html)).toBe('共 160 条评论')
    expect(countComments(markupOf(invalid.html))).toBe(20)
    expect(simulateScrollToBottom(invalid.html).rows).toBe(123)
  })
})

describe('playground · total-mismatch 生产环境屏蔽', () => {
  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it('NODE_ENV=production 时返回 404', async () => {
    vi.stubEnv('NODE_ENV', 'production')
    const { status } = await fetchHtml('?shown=123&claimed=160&perBatch=20')
    expect(status).toBe(404)
  })
})
