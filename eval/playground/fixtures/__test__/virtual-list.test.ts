import { NextRequest } from '../_lib/next-shim'
import { describe, expect, it } from 'vitest'

import { GET as virtualList } from '../virtual-list/route'

const BASE = 'http://localhost:3008'
const DEFAULT_QUERY = '/dev-fixtures/playground/virtual-list?total=200&window=10&itemHeight=40'
const VIEWPORT_PX = 400

async function fetchPage(path: string): Promise<{ status: number; html: string }> {
  const response = await virtualList(new NextRequest(`${BASE}${path}`))
  return { status: response.status, html: await response.text() }
}

/** 只数渲染出来的行：脚本里的字符串模板不算。 */
function countRows(html: string): number {
  const markup = html.replace(/<script>[\s\S]*?<\/script>/g, '')
  return (markup.match(/class="row"/g) ?? []).length
}

/** 极简假 DOM：只实现 mock 脚本用到的部分（textContent 赋值会清空子节点、addEventListener、scroll 事件）。 */
class FakeElement {
  className = ''
  style: Record<string, string> = {}
  children: FakeElement[] = []
  scrollTop = 0
  private leafText = ''
  private listeners: Array<() => void> = []

  constructor(readonly tagName: string) {}

  get textContent(): string {
    return this.children.length > 0 ? this.children.map((child) => child.textContent).join('') : this.leafText
  }

  set textContent(value: string) {
    this.children = []
    this.leafText = value
  }

  appendChild(child: FakeElement): FakeElement {
    this.children.push(child)
    return child
  }

  addEventListener(_type: string, listener: () => void): void {
    this.listeners.push(listener)
  }

  /** 模拟用户把视口滚到 top 并触发 scroll 事件。 */
  scrollTo(top: number): void {
    this.scrollTop = top
    this.listeners.forEach((listener) => listener())
  }
}

function fakeRow(n: number): FakeElement {
  const li = new FakeElement('li')
  li.className = 'row'
  const title = new FakeElement('span')
  title.textContent = `商品 ${n}`
  const price = new FakeElement('span')
  price.textContent = `¥${100 + n}`
  li.appendChild(title)
  li.appendChild(price)
  return li
}

/** 把 mock 页面挂到假 DOM 上：首屏节点按 HTML 还原，内联脚本照常执行。 */
function mount(html: string): { viewport: FakeElement; rows: FakeElement } {
  const viewport = new FakeElement('div')
  const rows = new FakeElement('ul')
  for (const match of html.matchAll(/class="row"><span class="title">商品 (\d+)</g)) {
    rows.appendChild(fakeRow(Number(match[1])))
  }
  const elements: Record<string, FakeElement> = { viewport, rows }
  const fakeDocument = {
    getElementById: (id: string) => elements[id] ?? null,
    createElement: (tag: string) => new FakeElement(tag),
  }
  const script = /<script>\n([\s\S]*?)\n<\/script>/.exec(html)?.[1]
  if (!script) throw new Error('mock 页面没有内联脚本')
  new Function('document', script)(fakeDocument)
  return { viewport, rows }
}

/** 当前 DOM 里挂着的行号（商品 n → n）。 */
function visibleNumbers(rows: FakeElement): number[] {
  return rows.children.map((li) => Number(/商品 (\d+)/.exec(li.textContent)?.[1]))
}

/**
 * 从顶部开始，每步滚动 stepPx，边滚边累计行号。
 * 每一步都断言 DOM 里恰好挂着 mounted 行（陷阱：任一时刻只有一小段）。
 */
function collectByScrolling(html: string, total: number, itemHeight: number, stepPx: number, mounted: number): Set<number> {
  const { viewport, rows } = mount(html)
  const seen = new Set<number>()
  const maxTop = total * itemHeight - VIEWPORT_PX
  for (let top = 0; top <= maxTop; top += stepPx) {
    viewport.scrollTo(top)
    const visible = visibleNumbers(rows)
    expect(visible).toHaveLength(mounted)
    visible.forEach((n) => seen.add(n))
  }
  return seen
}

describe('playground · virtual-list（A2）', () => {
  it('首屏只挂 window 行（默认 10），静态数行远小于 200：陷阱存在', async () => {
    const { status, html } = await fetchPage(DEFAULT_QUERY)
    expect(status).toBe(200)
    expect(countRows(html)).toBe(10)
    expect(countRows(html)).not.toBe(200)
    expect(html).toContain('商品 10</span>')
    expect(html).not.toContain('商品 11</span>')
  })

  it('spacer 撑开总高度 total × itemHeight；视口固定 400px 且 overflow:auto', async () => {
    const { html } = await fetchPage(DEFAULT_QUERY)
    expect(html).toContain('height: 8000px')
    expect(html).toContain(`height: ${VIEWPORT_PX}px; overflow: auto;`)
    expect(html).toContain('id="viewport"')
    expect(html).toContain('id="spacer"')
  })

  it('脚本拿到的配置与 query 一致', async () => {
    const { html } = await fetchPage(DEFAULT_QUERY)
    expect(html).toContain('{"total":200,"mountedRows":10,"itemHeight":40}')
  })

  it('越界参数夹到范围内，非法参数回落默认值，都不返回 404', async () => {
    const big = await fetchPage('/dev-fixtures/playground/virtual-list?total=5000&window=0&itemHeight=5')
    expect(big.status).toBe(200)
    // total 夹到 1000，itemHeight 夹到 20；window 夹到 1，但 400px 视口要 20 行才填满，挂载行数抬到 20
    expect(countRows(big.html)).toBe(20)
    expect(big.html).toContain('height: 20000px')

    const junk = await fetchPage('/dev-fixtures/playground/virtual-list?total=abc&window=x')
    expect(junk.status).toBe(200)
    expect(countRows(junk.html)).toBe(10)
    expect(junk.html).toContain('height: 8000px')
  })

  it('window 大于 total 时只挂 total 行', async () => {
    const { html } = await fetchPage('/dev-fixtures/playground/virtual-list?total=3&window=10&itemHeight=40')
    expect(countRows(html)).toBe(3)
    expect(html).toContain('商品 3</span>')
    expect(html).not.toContain('商品 4</span>')
  })

  it('增量滚动（每步 40px）边滚边累计，拿到全部 200 行，任一时刻 DOM 只有 10 行', async () => {
    const { html } = await fetchPage(DEFAULT_QUERY)
    const seen = collectByScrolling(html, 200, 40, 40, 10)
    expect(seen.size).toBe(200)
    expect(Math.min(...seen)).toBe(1)
    expect(Math.max(...seen)).toBe(200)
  })

  it('按视口高度（400px）整屏滚动也不漏行', async () => {
    const { html } = await fetchPage(DEFAULT_QUERY)
    const seen = collectByScrolling(html, 200, 40, VIEWPORT_PX, 10)
    expect(seen.size).toBe(200)
  })

  it('一次跳到底（harness 的 scroll-inner 做法）DOM 里只剩最后 10 行：陷阱就在这里', async () => {
    const { html } = await fetchPage(DEFAULT_QUERY)
    const { viewport, rows } = mount(html)
    viewport.scrollTo(200 * 40 - VIEWPORT_PX)
    const visible = visibleNumbers(rows)
    expect(visible).toHaveLength(10)
    expect(visible[0]).toBe(191)
    expect(visible[9]).toBe(200)
  })

  it('变体（total=50、window=5、itemHeight=60）：挂载行数抬到视口行数 7，边滚边累计仍拿到 50 行', async () => {
    const { html } = await fetchPage('/dev-fixtures/playground/virtual-list?total=50&window=5&itemHeight=60')
    expect(countRows(html)).toBe(7)
    const seen = collectByScrolling(html, 50, 60, 60, 7)
    expect(seen.size).toBe(50)
  })

  it('A02-001 声明给 harness 的增量策略（scroll-accumulate，stepPx 200 ≤ 400）边滚边累计拿到全部 200 行', async () => {
    const { html } = await fetchPage(DEFAULT_QUERY)
    const seen = collectByScrolling(html, 200, 40, 200, 10)
    expect(seen.size).toBe(200)
    expect(Math.min(...seen)).toBe(1)
    expect(Math.max(...seen)).toBe(200)
  })
})
