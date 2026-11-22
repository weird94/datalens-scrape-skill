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
    const extended = await fetchList('?related=1&warranty=1')
    expect(linkOf(rowsOf(extended.html)[0])).toBe(`${PATH}/1?related=1&warranty=1`)
    const withReviews = await fetchList('?related=1&reviews=1&reviewPager=1')
    expect(linkOf(rowsOf(withReviews.html)[0])).toBe(`${PATH}/1?related=1&reviews=1&reviewPager=1`)
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

  it('related=1：主记录前面（DOM 顺序在前）有两张相关商品卡片，复用 .name / .maker a / .price 和 .read-more；主记录的按钮限定在 article 里', async () => {
    const { html } = await fetchDetail('3', '?related=1')
    const later = renderedLater(html)
    expect(later.indexOf('<aside class="related">')).toBeGreaterThanOrEqual(0)
    expect(later.indexOf('<aside class="related">')).toBeLessThan(later.indexOf('<article class="product-detail">'))
    const cards = later.match(/<div class="product-card">[\s\S]*?<\/div>/g) ?? []
    expect(cards).toHaveLength(2)
    expect(cards[0]).toContain('<h3 class="name"><a href="/dev-fixtures/playground/detail-links/4">Product 4</a></h3>')
    expect(cards[0]).toContain(`<p class="maker">by <a href="/brands/${BRANDS[4].toLowerCase()}">${BRANDS[4]}</a></p>`)
    expect(cards[0]).toContain('<button class="read-more" type="button">Read more</button>')
    // 第一个 .maker a 是相关卡片的（Product 4 的品牌），不是本商品的 td.brand。
    expect(later.match(/class="maker">by <a[^>]*>([^<]*)</)?.[1]).toBe(BRANDS[4])
    expect(later).toContain(`<td class="brand">${BRANDS[3]}</td>`)
    expect(html).toContain("document.querySelector('article.product-detail .read-more')")
    expect(html).toContain("document.querySelectorAll('.related .read-more')")
  })

  it('warranty=1：规格表多一行 td.warranty；id % 3 === 0 的商品主记录里没有保修（真正缺，不是换了位置）', async () => {
    for (const id of ['1', '4', '5']) {
      const later = renderedLater((await fetchDetail(id, '?warranty=1')).html)
      expect(later).toContain(`<tr><th>Warranty</th><td class="warranty">${1 + (Number(id) % 3)} years</td></tr>`)
    }
    for (const id of ['3', '12']) {
      const later = renderedLater((await fetchDetail(id, '?warranty=1&related=1')).html)
      const record = later.slice(later.indexOf('<article'))
      expect(record).not.toMatch(/warranty/i)
    }
  })

  it('不带 related / warranty / reviews 时详情页与原来一样（H01-001 不受影响）', async () => {
    for (const id of ['3', '4']) {
      const { html } = await fetchDetail(id)
      expect(html).not.toMatch(/related|warranty|product-card|review/)
      expect(html).toContain("document.querySelector('.read-more')")
      expect(html).toContain("document.querySelector('.summary').replaceWith(full)")
    }
  })

  it('reviews=1：主记录里有评价区，条数因商品而异（含 0 条）；前 2 条直接显示，其余在「Show all N reviews」后面', async () => {
    const reviewsOf = (html: string): string[] => html.match(/<li class="review">[\s\S]*?<\/li>/g) ?? []
    // 6 条：2 条在页面上，4 条在按钮后面（脚本里的 MORE_REVIEWS）。
    const six = await fetchDetail('6', '?reviews=1')
    const record = renderedLater(six.html)
    expect(record).toContain('<section class="reviews"><h2>Reviews (6)</h2><ul class="review-list">')
    expect(reviewsOf(record)).toHaveLength(2)
    expect(record).toContain('<button class="show-reviews" type="button">Show all 6 reviews</button>')
    const hidden = JSON.parse(six.html.match(/const MORE_REVIEWS = ("(?:[^"\\]|\\.)*");/)?.[1] ?? '""') as string
    expect(reviewsOf(hidden)).toHaveLength(4)
    expect(six.html).toContain("document.querySelector('.review-list').insertAdjacentHTML('beforeend', MORE_REVIEWS)")
    expect(six.html).toContain('showReviews.remove()')
    // 每条：作者、星级（分数只在 aria-label）、日期（datetime）、正文。
    expect(reviewsOf(record)[0]).toMatch(/^<li class="review"><span class="author">[^<]+<\/span> <span class="rating" aria-label="Rated [1-5] out of 5">[★☆]{5}<\/span> <time class="date" datetime="2026-\d\d-\d\d">[^<]+<\/time><p class="text">Review 1 of product 6: [^<]+<\/p><\/li>$/)
    // 1 条：没有按钮；0 条：只有一句说明。
    const one = renderedLater((await fetchDetail('3', '?reviews=1')).html)
    expect(reviewsOf(one)).toHaveLength(1)
    expect(one).not.toContain('show-reviews')
    const none = renderedLater((await fetchDetail('5', '?reviews=1')).html)
    expect(none).toContain('<section class="reviews"><h2>Reviews (0)</h2><p class="no-reviews">No reviews yet.</p></section>')
    expect(reviewsOf(none)).toHaveLength(0)
    // 评价区在主记录 article 里，两套模板都是。
    for (const id of ['6', '8']) {
      const later = renderedLater((await fetchDetail(id, '?reviews=1')).html)
      expect(later.indexOf('<section class="reviews">')).toBeGreaterThan(later.indexOf('<article'))
      expect(later.indexOf('<section class="reviews">')).toBeLessThan(later.indexOf('</article>'))
    }
  })

  it('reviews=1 + related=1：相关卡片里也有同 class 的 li.review（Top review），主记录的按钮和列表限定在 article 里', async () => {
    const { html } = await fetchDetail('2', '?reviews=1&related=1')
    const later = renderedLater(html)
    const aside = later.slice(0, later.indexOf('<article'))
    // 相关商品 3（1 条）和 4（4 条）各带一条 Top review。
    expect(aside.match(/<li class="review">/g)).toHaveLength(2)
    expect(aside).toContain('Top review: Review 1 of product 3:')
    // 卡片里的也在 section.reviews 里：只靠 ".reviews li.review" 分不开，要靠主记录（root）。
    expect(aside).toContain('<section class="reviews"><ul class="review-list"><li class="review">')
    expect(later.slice(later.indexOf('<article')).match(/<li class="review">/g)).toHaveLength(2)
    expect(html).toContain("document.querySelector('article.product-detail .show-reviews')")
    expect(html).toContain("document.querySelector('article.product-detail .review-list')")
  })

  it('reviewPager=1：多出来的评价在另一个 URL（a.reviews-next → reviewPage=2），第 2 页只列其余的', async () => {
    const first = renderedLater((await fetchDetail('6', '?reviews=1&reviewPager=1')).html)
    expect(first.match(/<li class="review">/g)).toHaveLength(2)
    expect(first).not.toContain('show-reviews')
    expect(first).toContain(`<a class="reviews-next" href="${PATH}/6?reviews=1&amp;reviewPager=1&amp;reviewPage=2">Next reviews ›</a>`)
    const second = await fetchDetail('6', '?reviews=1&reviewPager=1&reviewPage=2')
    const later = renderedLater(second.html)
    expect(later.match(/<li class="review">/g)).toHaveLength(4)
    expect(later).toContain('Review 3 of product 6:')
    expect(later).not.toContain('reviews-next')
    expect(second.html).not.toContain('MORE_REVIEWS')
  })

  it('reviewStep=N：其余评价在「Load more reviews」后面，每点一次插 N 条，插完按钮才消失', async () => {
    const { html } = await fetchDetail('6', '?reviews=1&reviewStep=1')
    const record = renderedLater(html)
    expect(record.match(/<li class="review">/g)).toHaveLength(2)
    expect(record).toContain('<button class="load-more-reviews" type="button">Load more reviews</button>')
    expect(record).not.toContain('show-reviews')
    const items = JSON.parse(html.match(/const MORE_REVIEW_ITEMS = (\[[\s\S]*?\]);\n/)?.[1] ?? '[]') as string[]
    expect(items).toHaveLength(4)
    expect(items[0]).toContain('Review 3 of product 6:')
    expect(html).toContain('MORE_REVIEW_ITEMS.splice(0, 1)')
    expect(html).toContain('if (!MORE_REVIEW_ITEMS.length) loadMore.remove();')
    // 不带 reviewStep 时还是一次全出来的「Show all N reviews」。
    expect(renderedLater((await fetchDetail('6', '?reviews=1')).html)).toContain('Show all 6 reviews')
  })

  it('reviewsLateMs=N：主记录先出来，评价区只有标题和「Loading reviews…」，N 毫秒后列表和按钮才插进去', async () => {
    const { html } = await fetchDetail('6', '?reviews=1&reviewsLateMs=2500')
    const record = renderedLater(html)
    expect(record).toContain('<section class="reviews"><h2>Reviews (6)</h2><div class="reviews-body"><p class="loading-reviews">Loading reviews…</p></div></section>')
    expect(record).not.toContain('<li class="review">')
    expect(html).toContain("document.querySelector('.reviews-body').innerHTML = ")
    expect(html).toContain('}, 2500);')
    const late = JSON.parse(html.match(/\.reviews-body'\)\.innerHTML = ("(?:[^"\\]|\\.)*");/)?.[1] ?? '""') as string
    expect(late.match(/<li class="review">/g)).toHaveLength(2)
    expect(late).toContain('Show all 6 reviews')
    // 按钮的脚本在列表插进去之后才挂上。
    expect(html.indexOf("querySelector('.show-reviews')")).toBeGreaterThan(html.indexOf('.reviews-body'))
    // 没有评价的商品：一直是 0 条的说明，没有晚到的列表。
    const none = await fetchDetail('5', '?reviews=1&reviewsLateMs=2500')
    expect(none.html).not.toContain('reviews-body')
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

describe('H01-002 case 目录与路由输出同步', () => {
  const caseDir = new URL('../../cases/H01-002/', import.meta.url)
  const caseFile = JSON.parse(readFileSync(fileURLToPath(new URL('case.json', caseDir)), 'utf8')) as { url: string; message: string }
  const expected = JSON.parse(readFileSync(fileURLToPath(new URL('expected.json', caseDir)), 'utf8')) as {
    expectedRows: number
    detail: { noLink: number[]; deadLinks: number[]; noWarranty: number[]; warrantyFill: string; expectedStatus: Record<string, number>; relatedBeforeRecord: number }
  }

  it('行数与路由一致，详情链接带上 related / warranty；用户要的字段里有保修', async () => {
    const rows = await crawl(caseFile.url.slice(PATH.length))
    expect(rows).toHaveLength(expected.expectedRows)
    expect(linkOf(rows[0])).toBe(`${PATH}/1?related=1&warranty=1`)
    expect(caseFile.message).toMatch(/warranty/i)
  })

  it('详情页的答案：各状态的数目、没有保修的编号与保修填充率、主记录前的相关卡片数', async () => {
    const rows = await crawl(caseFile.url.slice(PATH.length))
    const ids = rows.map((row) => Number(titleOf(row).split(' ')[1]))
    const linked = rows.filter((row) => linkOf(row) !== null)
    expect(ids.filter((_, i) => linkOf(rows[i]) === null)).toEqual(expected.detail.noLink)
    const dead: number[] = []
    const noWarranty: number[] = []
    for (const row of linked) {
      const href = linkOf(row) as string
      const id = href.slice(PATH.length + 1).split('?')[0]
      const { status, html } = await fetchDetail(id, `${href.slice(href.indexOf('?'))}&lateMs=0`)
      if (status === 404) {
        dead.push(Number(id))
        continue
      }
      const later = renderedLater(html)
      expect(later.slice(0, later.indexOf('<article')).match(/class="product-card"/g)).toHaveLength(expected.detail.relatedBeforeRecord)
      if (!later.slice(later.indexOf('<article')).includes('class="warranty"')) noWarranty.push(Number(id))
    }
    expect(dead).toEqual(expected.detail.deadLinks)
    expect(noWarranty).toEqual(expected.detail.noWarranty)
    const ok = linked.length - dead.length
    expect(expected.detail.expectedStatus).toMatchObject({ ok, empty: dead.length, 'no-link': expected.detail.noLink.length })
    expect(expected.detail.warrantyFill).toBe(`${ok - noWarranty.length}/${ok}`)
  })
})

describe('H01-003 case 目录与路由输出同步', () => {
  const caseDir = new URL('../../cases/H01-003/', import.meta.url)
  const caseFile = JSON.parse(readFileSync(fileURLToPath(new URL('case.json', caseDir)), 'utf8')) as { url: string; message: string }
  const expected = JSON.parse(readFileSync(fileURLToPath(new URL('expected.json', caseDir)), 'utf8')) as {
    expectedRows: number
    detail: {
      noLink: number[]
      deadLinks: number[]
      expectedStatus: Record<string, number>
      children: { countsById: Record<string, number>; totalRows: number; pagesWithNone: number[]; inlinePerPage: number; behindShowAll: number[]; naiveNoExpandTotal: number }
    }
  }

  it('行数与路由一致，详情链接带上 related / reviews；用户要的是每件商品的评价', async () => {
    const rows = await crawl(caseFile.url.slice(PATH.length))
    expect(rows).toHaveLength(expected.expectedRows)
    expect(linkOf(rows[0])).toBe(`${PATH}/1?related=1&reviews=1`)
    expect(caseFile.message).toMatch(/reviews/i)
  })

  it('子列表的答案：每件商品主记录里的评价条数（页面上的 + 按钮后面的）、合计、0 条的商品、不展开时的合计', async () => {
    const rows = await crawl(caseFile.url.slice(PATH.length))
    const linked = rows.filter((row) => linkOf(row) !== null)
    const counts: Record<string, number> = {}
    const dead: number[] = []
    const behind: number[] = []
    let inline = 0
    for (const row of linked) {
      const href = linkOf(row) as string
      const id = href.slice(PATH.length + 1).split('?')[0]
      const { status, html } = await fetchDetail(id, `${href.slice(href.indexOf('?'))}&lateMs=0`)
      if (status === 404) {
        dead.push(Number(id))
        continue
      }
      const later = renderedLater(html)
      const record = later.slice(later.indexOf('<article'))
      const shown = (record.match(/<li class="review">/g) ?? []).length
      const hidden = JSON.parse(html.match(/const MORE_REVIEWS = ("(?:[^"\\]|\\.)*");/)?.[1] ?? '""') as string
      const more = (hidden.match(/<li class="review">/g) ?? []).length
      if (more) behind.push(Number(id))
      expect(shown).toBe(Math.min(shown + more, expected.detail.children.inlinePerPage))
      inline += shown
      counts[id] = shown + more
    }
    expect(dead).toEqual(expected.detail.deadLinks)
    expect(counts).toEqual(expected.detail.children.countsById)
    expect(Object.values(counts).reduce((a, b) => a + b, 0)).toBe(expected.detail.children.totalRows)
    expect(Object.entries(counts).filter(([, n]) => n === 0).map(([id]) => Number(id))).toEqual(expected.detail.children.pagesWithNone)
    expect(behind).toEqual(expected.detail.children.behindShowAll)
    expect(inline).toBe(expected.detail.children.naiveNoExpandTotal)
    expect(expected.detail.expectedStatus).toMatchObject({ ok: linked.length - dead.length, empty: dead.length, 'no-link': expected.detail.noLink.length })
  })
})
