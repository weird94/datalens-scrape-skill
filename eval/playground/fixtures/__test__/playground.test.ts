import { NextRequest } from '../_lib/next-shim'
import { describe, expect, it } from 'vitest'

import { GET as numberedPager } from '../numbered-pager/[page]/route'
import { GET as navPager } from '../nav-pager/[page]/route'
import { GET as ioScroll } from '../io-scroll/route'
import { GET as distractors } from '../distractors/route'

const BASE = 'http://localhost:3008'

function request(path: string): NextRequest {
  return new NextRequest(`${BASE}${path}`)
}

async function fetchPage(
  handler: (req: NextRequest, ctx: { params: Promise<{ page: string }> }) => Promise<Response>,
  path: string,
  page: string
): Promise<{ status: number; html: string }> {
  const response = await handler(request(path), { params: Promise.resolve({ page }) })
  return { status: response.status, html: await response.text() }
}

/** 只数渲染出来的 DOM：脚本里的字符串模板不算。 */
function countMatches(html: string, pattern: RegExp): number {
  const markup = html.replace(/<script>[\s\S]*?<\/script>/g, '')
  return (markup.match(pattern) ?? []).length
}

describe('playground · numbered-pager（D7 / D12 / E1）', () => {
  it('每页渲染 perPage 行，并且只有图标的箭头', async () => {
    const { status, html } = await fetchPage(numberedPager, '/dev-fixtures/playground/numbered-pager/1?pages=12&perPage=10', '1')
    expect(status).toBe(200)
    expect(countMatches(html, /class="item"/g)).toBe(10)
    expect(html).toContain('class="arrow"')
    expect(html).not.toContain('<span>下一页</span>')
  })

  it('末页的下一页箭头仍是链接且指向自己（不置灰）', async () => {
    const { html } = await fetchPage(numberedPager, '/dev-fixtures/playground/numbered-pager/3?pages=3&perPage=10', '3')
    expect(html).not.toContain('已是最后一页')
    expect(html).toContain('href="/dev-fixtures/playground/numbered-pager/3?pages=3&perPage=10"')
  })

  it('页数超过 6 时只显示窗口：1 2 3 … N', async () => {
    const { html } = await fetchPage(numberedPager, '/dev-fixtures/playground/numbered-pager/1?pages=12', '1')
    expect(html).toContain('…')
    expect(html).toContain('>12</a>')
    expect(html).not.toContain('>5</a>')
  })

  it('越界页码返回 404', async () => {
    const { status } = await fetchPage(numberedPager, '/dev-fixtures/playground/numbered-pager/13?pages=12', '13')
    expect(status).toBe(404)
  })
})

describe('playground · nav-pager（D5）', () => {
  it('首屏 HTML 里没有行，行由脚本晚插入，容器 class 带页码', async () => {
    const { html } = await fetchPage(navPager, '/dev-fixtures/playground/nav-pager/2?pages=6&perPage=10&lateMs=800', '2')
    expect(countMatches(html, /class="item"/g)).toBe(0)
    expect(html).toContain('<div id="slot"><p class="loading">')
    expect(html).toContain('result-list-p2')
    expect(html).toContain('}, 800);')
  })

  it('下一页是普通 <a href>；末页没有下一页链接', async () => {
    const mid = await fetchPage(navPager, '/dev-fixtures/playground/nav-pager/2?pages=3', '2')
    expect(mid.html).toContain('class="next" href="/dev-fixtures/playground/nav-pager/3?pages=3"')
    const last = await fetchPage(navPager, '/dev-fixtures/playground/nav-pager/3?pages=3', '3')
    expect(last.html).toContain('已是最后一页')
    expect(last.html).not.toContain('class="next"')
  })
})

describe('playground · io-scroll（D8 / D9 / E2）', () => {
  it('首屏 30 行、哨兵元素存在、window 滚动模式没有内部容器', async () => {
    const { html } = await fetchPage(ioScroll, '/dev-fixtures/playground/io-scroll?batches=8&batchSize=30', '')
    expect(countMatches(html, /class="item"/g)).toBe(30)
    expect(html).toContain('id="sentinel"')
    expect(html).not.toContain('id="scroller"')
    expect(html).toContain('var root = config.innerScroll ? document.getElementById(\'scroller\') : null;')
  })

  it('innerScroll=1 时列表放在固定高度的 overflow:auto 容器里', async () => {
    const { html } = await fetchPage(ioScroll, '/dev-fixtures/playground/io-scroll?innerScroll=1', '')
    expect(html).toContain('id="scroller"')
    expect(html).toContain('overflow: auto')
    expect(html).toContain('"innerScroll":true')
  })

  it('endText 默认关闭：到底没有文案', async () => {
    const off = await fetchPage(ioScroll, '/dev-fixtures/playground/io-scroll', '')
    expect(off.html).toContain('"endText":false')
    const on = await fetchPage(ioScroll, '/dev-fixtures/playground/io-scroll?endText=1', '')
    expect(on.html).toContain('"endText":true')
  })
})

describe('playground · distractors（D3 / D4 / D6）', () => {
  it('有七种干扰控件，真正的「加载更多」只有一个', async () => {
    const { html } = await fetchPage(distractors, '/dev-fixtures/playground/distractors?totalRows=40', '')
    expect(countMatches(html, /class="chan"/g)).toBe(4)
    expect(countMatches(html, /id="load-more"/g)).toBe(1)
    expect(html).toContain('换一换')
    expect(html).toContain('swiper-button-next')
    expect(html).toContain('看看 有趣好玩 的人是怎么评价的')
    expect(countMatches(html, /class="item"/g)).toBe(10)
  })

  it('mustNotPaginateWith 里的「展开」诱饵存在且只有一个', async () => {
    const { html } = await fetchPage(distractors, '/dev-fixtures/playground/distractors?totalRows=40', '')
    expect(countMatches(html, /class="expand"/g)).toBe(1)
    expect(html).toContain('>展开</button>')
  })

  it('tab=fun 时主列表是「暂时没有数据」，没有加载更多', async () => {
    const { html } = await fetchPage(distractors, '/dev-fixtures/playground/distractors?tab=fun', '')
    expect(html).toContain('暂时没有数据')
    expect(html).not.toContain('id="load-more"')
  })

  it('totalRows 写进脚本，供加载更多按钮结束时移除', async () => {
    const { html } = await fetchPage(distractors, '/dev-fixtures/playground/distractors?totalRows=50', '')
    expect(html).toContain('var total = 50;')
  })
})
