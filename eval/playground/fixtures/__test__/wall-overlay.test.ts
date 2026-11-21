import { readFileSync } from 'node:fs'

import { NextRequest } from '../_lib/next-shim'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { GET as wallOverlay } from '../wall-overlay/route'

const BASE = 'http://localhost:3008'
/** 仓库根下的 F3 case 目录：用于确认 case.json / expected.json 与路由输出同步。 */
const CASES_URL = new URL('../../cases/', import.meta.url)
const WALL_CASES = ['F03-001']
const WALL_TEXT = '登录后查看全部内容'

async function fetchHtml(path: string): Promise<{ status: number; html: string }> {
  const response = await wallOverlay(new NextRequest(`${BASE}${path}`))
  return { status: response.status, html: await response.text() }
}

function countMatches(html: string, pattern: RegExp): number {
  return (html.match(pattern) ?? []).length
}

/** #list 里的数据行：li 的可见文字以「商品 」开头。 */
function listRowTexts(html: string): string[] {
  const listMatch = html.match(/<ul id="list">([\s\S]*?)<\/ul>/)
  if (!listMatch) throw new Error('没有 #list')
  const items = listMatch[1].match(/<li[^>]*>[\s\S]*?<\/li>/g) ?? []
  return items.map((item) => item.replace(/<[^>]+>/g, '').trim())
}

describe('playground · wall-overlay（F3 登录墙）', () => {
  it('默认 visible=5、total=20：#list 只渲染前 5 行，之后没有商品 6', async () => {
    const { status, html } = await fetchHtml('/dev-fixtures/playground/wall-overlay?visible=5&total=20')
    expect(status).toBe(200)
    expect(countMatches(html, /<li class="item">/g)).toBe(5)
    expect(listRowTexts(html)).toEqual(['商品 1¥101', '商品 2¥102', '商品 3¥103', '商品 4¥104', '商品 5¥105'])
    expect(html).not.toContain('商品 6')
  })

  it('列表末端有遮罩 div.login-wall，文字「登录后查看全部内容」，位于 #list 之后、同一个 .wall-wrap 里', async () => {
    const { html } = await fetchHtml('/dev-fixtures/playground/wall-overlay?visible=5&total=20')
    expect(countMatches(html, /class="login-wall"/g)).toBe(1)
    expect(html).toContain(`<p>${WALL_TEXT}</p>`)
    const listEnd = html.indexOf('</ul>')
    const wall = html.indexOf('class="login-wall"')
    const wrapStart = html.indexOf('class="wall-wrap"')
    expect(wrapStart).toBeGreaterThan(-1)
    expect(wrapStart).toBeLessThan(html.indexOf('<ul id="list">'))
    expect(wall).toBeGreaterThan(listEnd)
  })

  it('遮罩是绝对定位覆盖容器的样式（盖住列表末端，而不是放在列表外面）', async () => {
    const { html } = await fetchHtml('/dev-fixtures/playground/wall-overlay?visible=5&total=20')
    expect(html).toMatch(/\.wall-wrap \{ position: relative; \}/)
    expect(html).toMatch(/\.login-wall \{ position: absolute; inset: 0;/)
  })

  it('没有任何加载逻辑：没有脚本，滚动或续载不会追加行', async () => {
    const { html } = await fetchHtml('/dev-fixtures/playground/wall-overlay?visible=5&total=20')
    expect(html).not.toContain('<script')
    expect(html).not.toMatch(/IntersectionObserver|addEventListener|fetch\(/)
  })

  it('陷阱存在：静态数行得到 5，等于 expectedRows；而停机文案是墙，不是到底', async () => {
    const { html } = await fetchHtml('/dev-fixtures/playground/wall-overlay?visible=5&total=20')
    expect(countMatches(html, /<li class="item">/g)).toBe(5)
    expect(html).toContain(WALL_TEXT)
    expect(html).not.toMatch(/没有更多|已经到底了|没有其他结果/)
  })

  it('total 不被渲染：页面上没有 total 的数字形式的商品行，也没有总数文案', async () => {
    const { html } = await fetchHtml('/dev-fixtures/playground/wall-overlay?visible=5&total=20')
    expect(html).not.toMatch(/共\s*\d+\s*条/)
    expect(html).not.toContain('商品 20')
    expect(html).not.toContain('商品 21')
  })

  it('visible 等于 total 时列表完整、没有墙（不能把完整列表标成 gated）', async () => {
    const { html } = await fetchHtml('/dev-fixtures/playground/wall-overlay?visible=20&total=20')
    expect(countMatches(html, /<li class="item">/g)).toBe(20)
    expect(html).not.toContain('class="login-wall"')
    expect(html).not.toContain(WALL_TEXT)
  })

  it('默认值：不带参数时 visible=5、total=20，即 5 行加墙；非法值回落到默认', async () => {
    const defaults = await fetchHtml('/dev-fixtures/playground/wall-overlay')
    expect(countMatches(defaults.html, /<li class="item">/g)).toBe(5)
    expect(defaults.html).toContain(WALL_TEXT)

    const invalid = await fetchHtml('/dev-fixtures/playground/wall-overlay?visible=abc&total=xyz')
    expect(countMatches(invalid.html, /<li class="item">/g)).toBe(5)
    expect(invalid.html).toContain(WALL_TEXT)
  })

  it('越界数值被夹到范围内（不是 404）', async () => {
    const tooMany = await fetchHtml('/dev-fixtures/playground/wall-overlay?visible=999&total=50')
    expect(tooMany.status).toBe(200)
    expect(countMatches(tooMany.html, /<li class="item">/g)).toBe(20)
    expect(tooMany.html).toContain(WALL_TEXT)

    const negative = await fetchHtml('/dev-fixtures/playground/wall-overlay?visible=-3&total=20')
    expect(countMatches(negative.html, /<li class="item">/g)).toBe(1)
    expect(negative.html).toContain(WALL_TEXT)

    const bigTotal = await fetchHtml('/dev-fixtures/playground/wall-overlay?visible=5&total=999')
    expect(countMatches(bigTotal.html, /<li class="item">/g)).toBe(5)
    expect(bigTotal.html).toContain(WALL_TEXT)
  })

  it('total 小于 visible 时 shown 被 total 限制，且没有被挡住的内容，因此没有墙', async () => {
    const { html } = await fetchHtml('/dev-fixtures/playground/wall-overlay?visible=5&total=3')
    expect(countMatches(html, /<li class="item">/g)).toBe(3)
    expect(html).not.toContain('class="login-wall"')
  })

  it('total 夹到下界 1 时只剩 1 行，且没有墙', async () => {
    const { html } = await fetchHtml('/dev-fixtures/playground/wall-overlay?visible=5&total=0')
    expect(countMatches(html, /<li class="item">/g)).toBe(1)
    expect(html).not.toContain('class="login-wall"')
  })
})

describe('playground · wall-overlay 生产环境屏蔽', () => {
  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it('NODE_ENV=production 时返回 404', async () => {
    vi.stubEnv('NODE_ENV', 'production')
    const { status } = await fetchHtml('/dev-fixtures/playground/wall-overlay?visible=5&total=20')
    expect(status).toBe(404)
  })
})

interface CaseFile {
  url: string
  pattern: string[]
  variant: Record<string, unknown>
  relatedCode: string[]
}

interface CaseExpected {
  expectedRows: number
  expectedStop: string
  expectedColumns?: Record<string, string[]>
  rowMatch: { selector: string; textPrefix: string }
  oracle: { strategy: string }
  naive?: unknown
  stopSignal?: Array<{ selector: string; exists?: boolean; textIncludes?: string }>
  trapVerifiedBy: string
}

function readCase(id: string): { caseFile: CaseFile; expected: CaseExpected } {
  const dir = new URL(`${id}/`, CASES_URL)
  const caseFile = JSON.parse(readFileSync(new URL('case.json', dir), 'utf-8')) as CaseFile
  const expected = JSON.parse(readFileSync(new URL('expected.json', dir), 'utf-8')) as CaseExpected
  return { caseFile, expected }
}

describe('playground · wall-overlay 的 F03 case 与路由输出同步', () => {
  for (const id of WALL_CASES) {
    it(`${id}：case.url 渲染出 expectedRows 行，停机文案与 stopSignal 一致，陷阱由 stopSignal 核验`, async () => {
      const { caseFile, expected } = readCase(id)
      expect(caseFile.pattern).toEqual(['F3'])
      expect(caseFile.url.startsWith('/dev-fixtures/playground/wall-overlay?')).toBe(true)

      const { status, html } = await fetchHtml(caseFile.url)
      expect(status).toBe(200)

      const prefix = expected.rowMatch.textPrefix
      const rows = listRowTexts(html).filter((text) => text.startsWith(prefix))
      expect(rows).toHaveLength(expected.expectedRows)

      expect(expected.expectedStop).toBe('gated')
      expect(expected.oracle.strategy).toBe('scroll-window')
      expect(expected.trapVerifiedBy).toBe('stopSignal')
      expect(expected.naive).toBeUndefined()

      for (const check of expected.stopSignal ?? []) {
        const exists = check.exists ?? true
        expect(check.selector).toBe('body')
        expect(html.includes(check.textIncludes ?? '')).toBe(exists)
      }

      const titles = [...html.matchAll(/<span class="title">([^<]*)<\/span>/g)].map((match) => match[1])
      for (const [header, values] of Object.entries(expected.expectedColumns ?? {})) {
        expect(html).toContain(`<span>${header}</span>`)
        for (const value of values) expect(titles).toContain(value)
      }
    })
  }
})
