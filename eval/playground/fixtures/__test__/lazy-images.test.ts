import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'

import { NextRequest } from '../_lib/next-shim'
import {afterEach, describe, expect, it, vi} from 'vitest'

import { GET as lazyImages } from '../lazy-images/route'

const BASE = 'http://localhost:3008'
const PLACEHOLDER = 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7'
/** 仓库根下的 C07-001 case：用于确认 expected.json 与路由输出同步。 */
const C07_EXPECTED = fileURLToPath(
  new URL('../../cases/C07-001/expected.json', import.meta.url)
)

interface ExpectedFile {
  expectedRows: number
  rowMatch: { selector: string; textPrefix: string }
  trapVerifiedBy: string
  trapTest: string
}

async function fetchLazy(path: string): Promise<{ status: number; html: string }> {
  const response = await lazyImages(new NextRequest(`${BASE}${path}`))
  return { status: response.status, html: await response.text() }
}

/** 只看渲染出来的 DOM：脚本里的字符串模板不算。 */
function markupOf(html: string): string {
  return html.replace(/<script>[\s\S]*?<\/script>/g, '')
}

function titlesOf(html: string): string[] {
  return [...markupOf(html).matchAll(/<span class="title">([^<]+)<\/span>/g)].map((match) => match[1])
}

afterEach(() => {
  vi.unstubAllEnvs()
})

describe('playground · lazy-images（C7）', () => {
  it('默认 20 行，标题按顺序编号，列表是 ul.list', async () => {
    const { status, html } = await fetchLazy('/dev-fixtures/playground/lazy-images?rows=20')
    expect(status).toBe(200)
    expect(markupOf(html)).toContain('<ul class="list">')
    const titles = titlesOf(html)
    expect(titles).toHaveLength(20)
    expect(titles.slice(0, 3)).toEqual(['商品 1', '商品 2', '商品 3'])
    expect(titles[19]).toBe('商品 20')
  })

  it('服务端 HTML 里每张图的 src 都是 1×1 占位 gif，真实地址在 data-src 上（陷阱存在）', async () => {
    const { html } = await fetchLazy('/dev-fixtures/playground/lazy-images?rows=20')
    const imgs = [...markupOf(html).matchAll(/<img class="thumb" src="([^"]*)" data-src="([^"]*)" alt="">/g)]
    expect(imgs).toHaveLength(20)
    imgs.forEach(([, src, dataSrc], index) => {
      expect(src).toBe(PLACEHOLDER)
      expect(dataSrc).not.toBe(PLACEHOLDER)
      expect(dataSrc.startsWith('data:image/svg+xml')).toBe(true)
      // 编号严格对应该行：SVG 里的文字是「图 n」，且带 </text> 收尾，不会被「图 10」之类误匹配
      expect(decodeURIComponent(dataSrc)).toContain(`>图 ${index + 1}</text>`)
    })
  })

  it('脚本里有「进入视口才把 data-src 换进 src」的逻辑', async () => {
    const { html } = await fetchLazy('/dev-fixtures/playground/lazy-images?rows=20')
    expect(html).toContain('new IntersectionObserver(')
    expect(html).toContain("img.getAttribute('data-src')")
    expect(html).toContain("querySelectorAll('img.thumb[data-src]')")
  })

  it('rows 越界时由 intParam 夹到 [1, 50]，缺失或非法时用默认 20（没有分页，不 404）', async () => {
    const low = await fetchLazy('/dev-fixtures/playground/lazy-images?rows=0')
    expect(low.status).toBe(200)
    expect(titlesOf(low.html)).toHaveLength(1)

    const high = await fetchLazy('/dev-fixtures/playground/lazy-images?rows=999')
    expect(high.status).toBe(200)
    expect(titlesOf(high.html)).toHaveLength(50)

    const junk = await fetchLazy('/dev-fixtures/playground/lazy-images?rows=abc')
    expect(titlesOf(junk.html)).toHaveLength(20)

    const missing = await fetchLazy('/dev-fixtures/playground/lazy-images')
    expect(titlesOf(missing.html)).toHaveLength(20)
  })

  it('生产环境返回 404', async () => {
    vi.stubEnv('NODE_ENV', 'production')
    const { status } = await fetchLazy('/dev-fixtures/playground/lazy-images?rows=20')
    expect(status).toBe(404)
  })

  it('C07-001 的 expected.json：rowMatch 计数等于 expectedRows；trapVerifiedBy 为 vitest，trapTest 指向本文件里真实存在的 it()', async () => {
    const { html } = await fetchLazy('/dev-fixtures/playground/lazy-images?rows=20')
    const expected = JSON.parse(await readFile(C07_EXPECTED, 'utf-8')) as ExpectedFile
    const matched = titlesOf(html).filter((title) => title.startsWith(expected.rowMatch.textPrefix))
    expect(matched).toHaveLength(expected.expectedRows)
    expect(expected.trapVerifiedBy).toBe('vitest')
    const self = await readFile(fileURLToPath(import.meta.url), 'utf-8')
    expect(self).toContain(`it('${expected.trapTest}'`)
  })
})
