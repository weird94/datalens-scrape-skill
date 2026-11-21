import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

import { NextRequest } from '../_lib/next-shim'
import { describe, expect, it, vi } from 'vitest'

import { GET as listPage } from '../detail-links/route'
import { GET as detailPage } from '../detail-links/[id]/route'

const BASE = 'http://localhost:3008'
const PATH = '/dev-fixtures/playground/detail-links'
const CASE_DIR = new URL('../../cases/H01-001/', import.meta.url)
const BRANDS = ['Northwind', 'Acme', 'Globex', 'Initech', 'Umbrella', 'Stark']

async function fetchList(query: string): Promise<{ status: number; html: string }> {
  const response = await listPage(new NextRequest(`${BASE}${PATH}${query}`))
  return { status: response.status, html: await response.text() }
}

async function fetchDetail(id: string, query = ''): Promise<{ status: number; html: string }> {
  const response = await detailPage(new NextRequest(`${BASE}${PATH}/${id}${query}`), { params: Promise.resolve({ id }) })
  return { status: response.status, html: await response.text() }
}

/** 只看服务端吐出的 DOM：脚本里的字符串模板不算。 */
const markup = (html: string): string => html.replace(/<script>[\s\S]*?<\/script>/g, '')
/** 脚本里晚插入的详情 HTML（DETAIL 常量）。 */
function renderedLater(html: string): string {
  const raw = html.match(/const DETAIL = ("(?:[^"\\]|\\.)*");/)?.[1]
  return raw ? (JSON.parse(raw) as string) : ''
}
const rowsOf = (html: string): string[] => [...html.matchAll(/<li class="item">([\s\S]*?)<\/li>/g)].map(([, inner]) => inner)
const titleOf = (row: string): string => row.match(/class="title"[^>]*>([^<]*)</)?.[1] ?? ''
const linkOf = (row: string): string | null => row.match(/<a class="title" href="([^"]*)"/)?.[1] ?? null
const nextOf = (html: string): string | null => html.match(/<a class="next" href="([^"]*)"/)?.[1]?.replace(/&amp;/g, '&') ?? null

/** 按下一页链接走完列表，返回所有行。 */
async function crawl(query: string): Promise<string[]> {
  const rows: string[] = []
  let next: string | null = `${PATH}${query}`
  for (let guard = 0; next && guard < 20; guard += 1) {
    const { html } = await fetchList(next.slice(PATH.length))
    rows.push(...rowsOf(html))
    next = nextOf(html)
  }
  return rows
}

describe('playground · detail-links（H1）· 列表页', () => {
  it('24 件分 3 页，每页 8 行，a.next 保留 query，末页没有下一页', async () => {
    const page1 = await fetchList('?items=24&perPage=8')
    expect(page1.status).toBe(200)
    expect(rowsOf(page1.html)).toHaveLength(8)
    expect(nextOf(page1.html)).toBe(`${PATH}?items=24&perPage=8&page=2`)
    const page3 = await fetchList('?items=24&perPage=8&page=3')
    expect(rowsOf(page3.html).map(titleOf)).toEqual(Array.from({ length: 8 }, (_, i) => `Product ${17 + i}`))
    expect(nextOf(page3.html)).toBeNull()
    const rows = await crawl('?items=24&perPage=8')
    expect(rows.map(titleOf)).toEqual(Array.from({ length: 24 }, (_, i) => `Product ${i + 1}`))
  })

  it('id % 10 === 7 的行没有链接；其余行的链接指向本 fixture 的详情页，并带上调节详情页的 query', async () => {
    const rows = await crawl('?items=24&perPage=8&lateMs=200&blockAfter=5&run=x&flaky=1&softBlockAfter=9&unrelated=1')
    const missing = rows.filter((row) => linkOf(row) === null).map(titleOf)
    expect(missing).toEqual(['Product 7', 'Product 17'])
    expect(linkOf(rows[0])).toBe(`${PATH}/1?lateMs=200&blockAfter=5&softBlockAfter=9&run=x&flaky=1`)
    const plain = await fetchList('')
    expect(linkOf(rowsOf(plain.html)[0])).toBe(`${PATH}/1`)
  })

  it('越界或非数字的页码 404；生产环境 404', async () => {
    expect((await fetchList('?items=24&perPage=8&page=4')).status).toBe(404)
    expect((await fetchList('?page=abc')).status).toBe(404)
    vi.stubEnv('NODE_ENV', 'production')
    try {
      expect((await fetchList('')).status).toBe(404)
      expect((await fetchDetail('1')).status).toBe(404)
    } finally {
      vi.unstubAllEnvs()
    }
  })
})

describe('playground · detail-links（H1）· 详情页', () => {
  it('晚渲染：首屏只有 Loading…，商品详情在 lateMs 后由脚本插入', async () => {
    const { status, html } = await fetchDetail('1', '?lateMs=800')
    expect(status).toBe(200)
    expect(markup(html)).toContain('<p class="loading">Loading…</p>')
    expect(markup(html)).not.toContain('class="name"')
    expect(html).toContain('}, 800);')
    expect(renderedLater(html)).toContain('<h1 class="name">Product 1</h1>')
  })

  it('两套模板：多数商品的品牌在 table.specs 的 td.brand；每第 4 件只在 p.maker 的链接里', async () => {
    const usual = renderedLater((await fetchDetail('3')).html)
    expect(usual).toContain(`<td class="brand">${BRANDS[3]}</td>`)
    expect(usual).not.toContain('class="maker"')
    const compact = renderedLater((await fetchDetail('8')).html)
    expect(compact).not.toContain('class="brand"')
    expect(compact).toMatch(new RegExp(`<p class="maker">by <a href="[^"]+">${BRANDS[8 % 6]}</a></p>`))
    expect(compact).toContain('<td class="sku">SKU-0008</td>')
  })

  it('完整描述在「Read more」后面：插入前只有摘要，点击后 300ms 换成 .full-text、按钮移除', async () => {
    const { html } = await fetchDetail('2')
    expect(renderedLater(html)).toContain('<p class="summary">A short note about product 2…</p><button class="read-more" type="button">Read more</button>')
    expect(renderedLater(html)).not.toContain('full-text')
    expect(html).toContain("full.className = 'full-text'")
    expect(html).toContain('Full description of product 2: made to last')
    expect(html).toContain('button.remove()')
  })

  it('死链与非法 id：id % 9 === 0、0、非数字都是 HTTP 404', async () => {
    for (const id of ['9', '18', '0', 'abc', '501']) expect((await fetchDetail(id)).status).toBe(404)
  })

  it('blockAfter：同一个 run 的第 N 次之后都是验证码页（HTTP 200），不同 run 分开计数', async () => {
    const run = `block-${Math.random()}`
    const statuses: string[] = []
    for (const id of ['1', '2', '9', '3', '4']) {
      const { status, html } = await fetchDetail(id, `?blockAfter=3&run=${run}`)
      statuses.push(html.includes('class="captcha-box"') ? `captcha ${status}` : String(status))
    }
    expect(statuses).toEqual(['200', '200', '404', 'captcha 200', 'captcha 200'])
    const wall = await fetchDetail('1', `?blockAfter=3&run=${run}`)
    expect(wall.html).toContain('Verify you are human')
    expect(wall.html).not.toContain('class="name"')
    expect((await fetchDetail('1', `?blockAfter=3&run=other-${run}`)).html).not.toContain('captcha')
  })

  it('softBlockAfter：第 N 次之后是只有导航和 Loading… 的空壳（HTTP 200），没有脚本、没有拦截文案', async () => {
    const run = `soft-${Math.random()}`
    await fetchDetail('1', `?softBlockAfter=1&run=${run}`)
    const shell = await fetchDetail('2', `?softBlockAfter=1&run=${run}`)
    expect(shell.status).toBe(200)
    expect(shell.html).toContain('<p class="loading">Loading…</p>')
    expect(shell.html).not.toContain('<script>')
    expect(shell.html).not.toMatch(/captcha|verify|blocked|denied/i)
  })

  it('flaky=1：id % 5 === 0 的详情页在同一个 run 里第一次 503、之后正常；其它 id 不受影响', async () => {
    const run = `flaky-${Math.random()}`
    expect((await fetchDetail('5', `?flaky=1&run=${run}`)).status).toBe(503)
    expect((await fetchDetail('5', `?flaky=1&run=${run}`)).status).toBe(200)
    expect((await fetchDetail('4', `?flaky=1&run=${run}`)).status).toBe(200)
    expect((await fetchDetail('10', '?run=no-flaky')).status).toBe(200)
  })

  it('flaky=2：id % 5 === 0 的详情页在同一个 run 里只有第二次请求 503', async () => {
    const run = `flaky2-${Math.random()}`
    const statuses: number[] = []
    for (let i = 0; i < 4; i += 1) statuses.push((await fetchDetail('5', `?flaky=2&run=${run}`)).status)
    expect(statuses).toEqual([200, 503, 200, 200])
    expect((await fetchDetail('4', `?flaky=2&run=${run}`)).status).toBe(200)
    expect((await fetchDetail('4', `?flaky=2&run=${run}`)).status).toBe(200)
  })

  it('badge=1：每个详情页都挂一个 fixed 的 reCAPTCHA 徽标，内容照常晚渲染', async () => {
    const { status, html } = await fetchDetail('3', '?badge=1&lateMs=500')
    expect(status).toBe(200)
    expect(markup(html)).toMatch(/<div class="grecaptcha-badge" style="position:fixed[^"]*"><iframe title="reCAPTCHA"/)
    expect(renderedLater(html)).toContain('<h1 class="name">Product 3</h1>')
    expect(markup((await fetchDetail('3')).html)).not.toContain('grecaptcha')
  })
})

describe('H01-001 case 目录与路由输出同步', () => {
  const caseFile = JSON.parse(readFileSync(fileURLToPath(new URL('case.json', CASE_DIR)), 'utf8')) as { url: string }
  const expected = JSON.parse(readFileSync(fileURLToPath(new URL('expected.json', CASE_DIR)), 'utf8')) as {
    expectedRows: number
    naive: { expectedRows: number }
    detail: { noLink: number[]; deadLinks: number[]; secondLayout: number[]; expectedStatus: Record<string, number>; naiveBrandFill: string }
  }

  it('行数、静态行数（陷阱）与路由一致', async () => {
    const query = caseFile.url.slice(PATH.length)
    const rows = await crawl(query)
    expect(rows).toHaveLength(expected.expectedRows)
    expect(rowsOf((await fetchList(query)).html)).toHaveLength(expected.naive.expectedRows)
  })

  it('详情页的答案：没有链接、死链、第二套模板的编号，以及各状态的数目', async () => {
    const rows = await crawl(caseFile.url.slice(PATH.length))
    const ids = rows.map((row) => Number(titleOf(row).split(' ')[1]))
    expect(ids.filter((_, i) => linkOf(rows[i]) === null)).toEqual(expected.detail.noLink)
    const linked = ids.filter((_, i) => linkOf(rows[i]) !== null)
    const dead: number[] = []
    const compact: number[] = []
    for (const id of linked) {
      const { status, html } = await fetchDetail(String(id), '?lateMs=0')
      if (status === 404) dead.push(id)
      else if (!renderedLater(html).includes('class="brand"')) compact.push(id)
    }
    expect(dead).toEqual(expected.detail.deadLinks)
    expect(compact).toEqual(expected.detail.secondLayout)
    expect(expected.detail.expectedStatus).toMatchObject({ ok: linked.length - dead.length, empty: dead.length, 'no-link': expected.detail.noLink.length })
    expect(expected.detail.naiveBrandFill).toBe(`${linked.length - dead.length - compact.length}/${linked.length - dead.length}`)
  })
})
