import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'

import { NextRequest } from '../_lib/next-shim'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { GET as detailPage } from '../detail-page/route'

const BASE = 'http://localhost:3008'
/** 仓库根下的 B01-001 case：用于确认 case.json / expected.json 与路由输出同步。 */
const B01_CASE = fileURLToPath(new URL('../../cases/B01-001/case.json', import.meta.url))
const B01_EXPECTED = fileURLToPath(
  new URL('../../cases/B01-001/expected.json', import.meta.url)
)

async function fetchPage(path: string): Promise<{ status: number; html: string }> {
  const response = await detailPage(new NextRequest(`${BASE}${path}`))
  return { status: response.status, html: await response.text() }
}

interface RowDescriptor {
  selector: string
  textPrefix: string
}

/**
 * 与 e2e-harness 的 playground-oracle countRows 同口径：querySelectorAll(selector) 之后，
 * 取 textContent.trim() 以 textPrefix 开头的元素。只支持 `li.<class>`，本 mock 的选择器都是这种形式。
 */
function countRowsLike(html: string, descriptor: RowDescriptor): number {
  const match = /^li\.([\w-]+)$/.exec(descriptor.selector)
  if (!match) throw new Error(`countRowsLike 只支持 li.<class>，收到 ${descriptor.selector}`)
  const className = match[1]
  return [...html.matchAll(/<li class="([^"]*)">([\s\S]*?)<\/li>/g)].filter(
    ([, classes, inner]) =>
      classes.split(/\s+/).includes(className) && inner.replace(/<[^>]+>/g, '').trim().startsWith(descriptor.textPrefix)
  ).length
}

function countMatches(html: string, pattern: RegExp): number {
  return (html.match(pattern) ?? []).length
}

/** 「用户评价」区块：<ul class="reviews"> 到它的 </ul>。 */
function reviewsListOf(html: string): string {
  const start = html.indexOf('<ul class="reviews">')
  const end = html.indexOf('</ul>', start)
  return start === -1 || end === -1 ? '' : html.slice(start, end)
}

/** 「猜你喜欢」区块：<ul class="carousel"> 到它的 </ul>。 */
function carouselListOf(html: string): string {
  const start = html.indexOf('<ul class="carousel">')
  const end = html.indexOf('</ul>', start)
  return start === -1 || end === -1 ? '' : html.slice(start, end)
}

afterEach(() => {
  vi.unstubAllEnvs()
})

describe('playground · detail-page（B1 详情页上的小列表）', () => {
  it('默认参数：3 条评价在 ul.reviews 里，20 项推荐在 ul.carousel 里', async () => {
    const { status, html } = await fetchPage('/dev-fixtures/playground/detail-page?reviews=3&carousel=20')
    expect(status).toBe(200)
    expect(countMatches(reviewsListOf(html), /<li class="review">评价 \d+：/g)).toBe(3)
    expect(countMatches(carouselListOf(html), /<li class="card">/g)).toBe(20)
  })

  it('评价行文案以「评价 n：」开头，按顺序编号，前三条内容固定', async () => {
    const { html } = await fetchPage('/dev-fixtures/playground/detail-page?reviews=3&carousel=20')
    expect(html).toContain('<li class="review">评价 1：物流很快，包装完整。</li>')
    expect(html).toContain('<li class="review">评价 2：音质不错，续航够用。</li>')
    expect(html).toContain('<li class="review">评价 3：价格合适，性价比高。</li>')
    expect(html).not.toContain('评价 4')
  })

  it('推荐行文案以「推荐 n」开头，编号 1–20 连续，没有第 21 项', async () => {
    const { html } = await fetchPage('/dev-fixtures/playground/detail-page?reviews=3&carousel=20')
    expect(html).toContain('<span class="title">推荐 1</span>')
    expect(html).toContain('<span class="title">推荐 20</span>')
    expect(html).not.toContain('推荐 21')
  })

  it('陷阱存在：页面上的 li 总数是 3 + 20 = 23，只按 li 选会把轮播算进去', async () => {
    const { html } = await fetchPage('/dev-fixtures/playground/detail-page?reviews=3&carousel=20')
    expect(countMatches(html, /<li[ >]/g)).toBe(23)
    expect(countMatches(html, /<li class="review">/g)).toBe(3)
    expect(countMatches(carouselListOf(html), /<li class="card">/g)).toBeGreaterThan(3)
  })

  it('评价区块在轮播之前：按 DOM 顺序取第一个列表就是评价', async () => {
    const { html } = await fetchPage('/dev-fixtures/playground/detail-page?reviews=3&carousel=20')
    const reviewsAt = html.indexOf('<ul class="reviews">')
    const carouselAt = html.indexOf('<ul class="carousel">')
    expect(reviewsAt).toBeGreaterThan(-1)
    expect(carouselAt).toBeGreaterThan(reviewsAt)
    expect(html.indexOf('用户评价')).toBeLessThan(reviewsAt)
    expect(html.indexOf('猜你喜欢')).toBeGreaterThan(reviewsAt)
  })

  it('主体是详情：一个 h1 标题、价格，以及至少两段描述段落', async () => {
    const { html } = await fetchPage('/dev-fixtures/playground/detail-page?reviews=3&carousel=20')
    expect(countMatches(html, /<h1>/g)).toBe(1)
    expect(html).toContain('<p class="price">¥199</p>')
    expect(countMatches(html.slice(html.indexOf('<div class="desc">')), /<p>/g)).toBeGreaterThanOrEqual(2)
  })

  it('reviews=0：评价区块只剩「暂无评价」这条非数据行，没有 li.review；carousel=0 同理', async () => {
    const { html } = await fetchPage('/dev-fixtures/playground/detail-page?reviews=0&carousel=0')
    expect(countMatches(html, /<li class="review">/g)).toBe(0)
    expect(reviewsListOf(html)).toContain('<li class="empty">暂无评价</li>')
    expect(countMatches(carouselListOf(html), /<li class="card">/g)).toBe(0)
    expect(carouselListOf(html)).toContain('<li class="empty">暂无推荐</li>')
  })

  it('越界数值按 intParam 夹到范围内，不返回 404：reviews=99→20，carousel=999→50，负数→0', async () => {
    const manyReviews = await fetchPage('/dev-fixtures/playground/detail-page?reviews=99&carousel=20')
    expect(manyReviews.status).toBe(200)
    expect(countMatches(manyReviews.html, /<li class="review">/g)).toBe(20)

    const manyCards = await fetchPage('/dev-fixtures/playground/detail-page?reviews=3&carousel=999')
    expect(manyCards.status).toBe(200)
    expect(countMatches(carouselListOf(manyCards.html), /<li class="card">/g)).toBe(50)
    expect(manyCards.html).toContain('<span class="title">推荐 50</span>')
    expect(manyCards.html).not.toContain('推荐 51')

    const negative = await fetchPage('/dev-fixtures/playground/detail-page?reviews=-5&carousel=-1')
    expect(negative.status).toBe(200)
    expect(countMatches(negative.html, /<li class="review">/g)).toBe(0)
    expect(countMatches(negative.html, /<li class="card">/g)).toBe(0)
  })

  it('非法数值回落默认值：reviews=abc → 3，carousel=xyz → 20', async () => {
    const { html } = await fetchPage('/dev-fixtures/playground/detail-page?reviews=abc&carousel=xyz')
    expect(countMatches(reviewsListOf(html), /<li class="review">/g)).toBe(3)
    expect(countMatches(carouselListOf(html), /<li class="card">/g)).toBe(20)
  })

  it('不带任何参数时同样是默认 3 条评价、20 项推荐', async () => {
    const { html } = await fetchPage('/dev-fixtures/playground/detail-page')
    expect(countMatches(reviewsListOf(html), /<li class="review">/g)).toBe(3)
    expect(countMatches(carouselListOf(html), /<li class="card">/g)).toBe(20)
  })
})

describe('playground · detail-page 与 B01-001 case 同步', () => {
  it('case.json 的 url 能打开；rowMatch 数出 expectedRows（评价），naive 的 li.card 数出 naive.expectedRows（轮播），且陷阱行数确实比答案多', async () => {
    const caseInfo = JSON.parse(await readFile(B01_CASE, 'utf-8')) as { url: string }
    const expected = JSON.parse(await readFile(B01_EXPECTED, 'utf-8')) as {
      expectedRows: number
      trapVerifiedBy: string
      rowMatch: RowDescriptor
      naive: { rowMatch: RowDescriptor; expectedRows: number }
    }
    const { status, html } = await fetchPage(caseInfo.url)
    expect(status).toBe(200)
    expect(countRowsLike(html, expected.rowMatch)).toBe(expected.expectedRows)
    expect(countRowsLike(html, expected.naive.rowMatch)).toBe(expected.naive.expectedRows)
    expect(expected.naive.expectedRows).toBeGreaterThan(expected.expectedRows)
    expect(expected.trapVerifiedBy).toBe('naive')
  })
})

describe('playground · detail-page 生产环境屏蔽', () => {
  it('NODE_ENV=production 时返回 404', async () => {
    vi.stubEnv('NODE_ENV', 'production')
    const { status } = await fetchPage('/dev-fixtures/playground/detail-page?reviews=3&carousel=20')
    expect(status).toBe(404)
  })
})
