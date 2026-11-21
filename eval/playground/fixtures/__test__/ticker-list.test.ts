import { NextRequest } from '../_lib/next-shim'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { GET as tickerList } from '../ticker-list/route'

const BASE = 'http://localhost:3008'
const PATH = '/dev-fixtures/playground/ticker-list'

async function fetchList(query = ''): Promise<{ status: number; html: string }> {
  const response = await tickerList(new NextRequest(`${BASE}${PATH}${query}`))
  return { status: response.status, html: await response.text() }
}

function countMatches(html: string, pattern: RegExp): number {
  return (html.match(pattern) ?? []).length
}

/** 取出 #list 里的数据行区段。 */
function listOf(html: string): string {
  return html.slice(html.indexOf('<ul id="list">'), html.indexOf('</ul>'))
}

/** 取出页面里的内联脚本正文（renderShell 把 script 包成 <script>\n…\n</script>）。 */
function scriptOf(html: string): string {
  const match = html.match(/<script>\n([\s\S]*?)\n<\/script>/)
  if (!match) throw new Error('页面缺少内联脚本')
  return match[1]
}

describe('playground · ticker-list（D13）', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it('默认 20 行，每个数据行都以「商品 」开头', async () => {
    const { status, html } = await fetchList()
    expect(status).toBe(200)
    expect(countMatches(listOf(html), /<li class="item">/g)).toBe(20)
    const names = [...html.matchAll(/<span class="title">(商品 \d+)<\/span>/g)].map((match) => match[1])
    expect(names).toHaveLength(20)
    expect(names.slice(0, 3)).toEqual(['商品 1', '商品 2', '商品 3'])
  })

  it('rows=5 精确给出 5 行，最后一行是商品 5', async () => {
    const { html } = await fetchList('?rows=5')
    expect(countMatches(listOf(html), /<li class="item">/g)).toBe(5)
    expect(html).toContain('<span class="title">商品 5</span>')
    expect(html).not.toContain('商品 6')
  })

  it('rows 夹到 [1, 50]，缺失或非法值回落到默认 20', async () => {
    const over = await fetchList('?rows=500')
    expect(countMatches(listOf(over.html), /<li class="item">/g)).toBe(50)

    const under = await fetchList('?rows=0')
    expect(countMatches(listOf(under.html), /<li class="item">/g)).toBe(1)

    const garbage = await fetchList('?rows=abc')
    expect(countMatches(listOf(garbage.html), /<li class="item">/g)).toBe(20)

    const missing = await fetchList()
    expect(countMatches(listOf(missing.html), /<li class="item">/g)).toBe(20)
  })

  it('陷阱存在：只有第一行的价格是 ticker，其余行价格是静态的', async () => {
    const { html } = await fetchList('?rows=20')
    expect(countMatches(html, /class="price ticker"/g)).toBe(1)
    expect(html).toContain(
      '<li class="item"><span class="title">商品 1</span><span class="price ticker">¥101</span></li>'
    )
    expect(html).toContain('<li class="item"><span class="title">商品 2</span><span class="price">¥102</span></li>')
    expect(html).toContain('<li class="item"><span class="title">商品 20</span><span class="price">¥120</span></li>')
    // 静态数行就是 20：这一页的陷阱在文本指纹上，不在行数上
    expect(countMatches(listOf(html), /<li class="item">/g)).toBe(20)
  })

  it('脚本每 1000 毫秒把第一行的 ticker 加 1，且只查询 #list .ticker（不碰其它行）', async () => {
    vi.useFakeTimers()
    const { html } = await fetchList('?rows=20')
    const ticker = { textContent: '¥101' }
    const queried: string[] = []
    const fakeDocument = {
      querySelector: (selector: string) => {
        queried.push(selector)
        return selector === '#list .ticker' ? ticker : null
      },
    }

    new Function('document', 'setInterval', scriptOf(html))(fakeDocument, setInterval)
    // 脚本只能通过 querySelector 摸到元素，所以唯一被查询的选择器就是第一行的 ticker
    expect(queried).toEqual(['#list .ticker'])
    expect(ticker.textContent).toBe('¥101')

    vi.advanceTimersByTime(999)
    expect(ticker.textContent).toBe('¥101')

    vi.advanceTimersByTime(1)
    expect(ticker.textContent).toBe('¥102')

    // 再过 1500 毫秒（累计 2500），在 2000 毫秒再跳一次
    vi.advanceTimersByTime(1500)
    expect(ticker.textContent).toBe('¥103')
  })

  it('陷阱存在：首行价格每秒变化，整表文本指纹在两次读取间不同，数据行数却始终是 20', async () => {
    vi.useFakeTimers()
    const { html } = await fetchList('?rows=20')
    const ticker = { textContent: '¥101' }
    const fakeDocument = {
      querySelector: (selector: string) => (selector === '#list .ticker' ? ticker : null),
    }
    // 除第一行价格外的整张列表标记；指纹 = 静态标记 + 当前 ticker 文本，与「整表文本」同形
    const staticMarkup = listOf(html).replace('<span class="price ticker">¥101</span>', '')
    const fingerprint = () => `${staticMarkup}|${ticker.textContent}`

    new Function('document', 'setInterval', scriptOf(html))(fakeDocument, setInterval)
    const first = fingerprint()
    vi.advanceTimersByTime(1000)
    const second = fingerprint()

    expect(second).not.toBe(first)
    expect(ticker.textContent).toBe('¥102')
    // 行数不变：指纹的变化只来自第一行的价格
    expect(countMatches(staticMarkup, /<li class="item">/g)).toBe(20)
  })

  it('生产环境直接 404', async () => {
    vi.stubEnv('NODE_ENV', 'production')
    try {
      const { status } = await fetchList('?rows=20')
      expect(status).toBe(404)
    } finally {
      vi.unstubAllEnvs()
    }
  })
})
