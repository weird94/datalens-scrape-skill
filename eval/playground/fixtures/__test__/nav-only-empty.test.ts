import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

import { NextRequest } from '../_lib/next-shim'
import { describe, expect, it, vi } from 'vitest'

import { GET as navOnlyEmpty } from '../nav-only-empty/route'

const BASE = 'http://localhost:3008'
const PATH = '/dev-fixtures/playground/nav-only-empty'
const CASE_ID = 'B02-001'
/** 仓库根下的 B2 case 目录：用于确认 case.json / expected.json 与路由输出同步。 */
const CASES_URL = new URL('../../cases/', import.meta.url)
const GATE_TEXT = '登录后即可查看内容'

async function fetchNav(query: string): Promise<{ status: number; html: string }> {
  const response = await navOnlyEmpty(new NextRequest(`${BASE}${PATH}${query}`))
  return { status: response.status, html: await response.text() }
}

/** 导航区（nav.channels）的内层 HTML。 */
function navInner(html: string): string {
  return html.match(/<nav class="channels">([\s\S]*?)<\/nav>/)?.[1] ?? ''
}

/** 导航里每个 li 的文本，按 DOM 顺序。 */
function navTexts(html: string): string[] {
  return Array.from(navInner(html).matchAll(/<li><a href="#">([^<]*)<\/a><\/li>/g), (match) => match[1].trim())
}

/** 主体（main）的内层 HTML。 */
function mainInner(html: string): string {
  return html.match(/<main>([\s\S]*?)<\/main>/)?.[1] ?? ''
}

/** 结果区域（main .result）的内层 HTML。 */
function resultInner(html: string): string {
  return mainInner(html).match(/<div class="result">([\s\S]*?)<\/div>/)?.[1] ?? ''
}

/** 数 li 元素个数（开标签 <li 后跟空白或 >）。 */
function countLi(fragment: string): number {
  return (fragment.match(/<li[\s>]/g) ?? []).length
}

/** 筛选条按钮文字。 */
function filterLabels(html: string): string[] {
  return Array.from(mainInner(html).matchAll(/<button type="button">([^<]*)<\/button>/g), (match) => match[1])
}

function readCaseFile<T>(file: 'case.json' | 'expected.json'): T {
  return JSON.parse(readFileSync(fileURLToPath(new URL(`${CASE_ID}/${file}`, CASES_URL)), 'utf8')) as T
}

interface ExpectedFile {
  expectedRows: number
  expectedStop: string
  rowMatch: { selector: string; textPrefix: string }
  naive: { strategy: string; rowMatch: { selector: string; textPrefix: string }; expectedRows: number }
  stopSignal: Array<{ selector: string; exists?: boolean; textIncludes?: string }>
  trapVerifiedBy: string
  oracle: { strategy: string }
}

interface CaseFile {
  url: string
  pattern: string[]
}

describe('playground · nav-only-empty（B2）· 默认变体（navItems=6）', () => {
  it('HTTP 200（门控页在浏览器里也是 200），顶部导航 6 个 li，文案为「频道 1」到「频道 6」', async () => {
    const { status, html } = await fetchNav('?navItems=6')
    expect(status).toBe(200)
    expect(navTexts(html)).toEqual(['频道 1', '频道 2', '频道 3', '频道 4', '频道 5', '频道 6'])
  })

  it('结果区域（main .result）没有任何 li：0 行', async () => {
    const { html } = await fetchNav('?navItems=6')
    expect(countLi(resultInner(html))).toBe(0)
  })

  it('主体（main）里根本没有 li：导航的 li 只在 nav 里', async () => {
    const { html } = await fetchNav('?navItems=6')
    expect(countLi(mainInner(html))).toBe(0)
  })

  it('结果区域只有提示文字「登录后即可查看内容」，没有其他文本', async () => {
    const { html } = await fetchNav('?navItems=6')
    expect(resultInner(html)).toContain(GATE_TEXT)
    expect(resultInner(html).replace(/<[^>]*>/g, '').trim()).toBe(GATE_TEXT)
  })

  it('筛选条是三个按钮「筛选 a / b / c」，不是结果列表', async () => {
    const { html } = await fetchNav('?navItems=6')
    expect(filterLabels(html)).toEqual(['筛选 a', '筛选 b', '筛选 c'])
  })

  it('陷阱存在：朴素做法数 nav li（频道 前缀）得 6，与 expectedRows 0 不同', async () => {
    const { html } = await fetchNav('?navItems=6')
    const expected = readCaseFile<ExpectedFile>('expected.json')
    const naiveCount = navTexts(html).filter((text) => text.startsWith(expected.naive.rowMatch.textPrefix)).length
    expect(naiveCount).toBe(expected.naive.expectedRows)
    expect(expected.naive.expectedRows).toBe(6)
    expect(expected.naive.expectedRows).not.toBe(expected.expectedRows)
  })
})

describe('playground · nav-only-empty（B2）· navItems 变体（结果区域始终 0 行）', () => {
  it.each([
    ['?navItems=1', 1],
    ['?navItems=3', 3],
    ['?navItems=20', 20],
  ])('%s：导航 %i 个 li，结果区域仍是 0 行', async (query, count) => {
    const { html } = await fetchNav(query)
    expect(navTexts(html)).toHaveLength(count)
    expect(navTexts(html)[count - 1]).toBe(`频道 ${count}`)
    expect(countLi(resultInner(html))).toBe(0)
  })

  it('navItems 越界按 intParam 夹到 [1, 20]：0 → 1，999 → 20；非数字与缺失回落到默认 6', async () => {
    expect(navTexts((await fetchNav('?navItems=0')).html)).toHaveLength(1)
    expect(navTexts((await fetchNav('?navItems=999')).html)).toHaveLength(20)
    expect(navTexts((await fetchNav('?navItems=abc')).html)).toHaveLength(6)
    expect(navTexts((await fetchNav('')).html)).toHaveLength(6)
  })

  it('任何 navItems 下，结果区域都没有行，提示文字都在', async () => {
    for (const query of ['', '?navItems=1', '?navItems=20', '?navItems=999']) {
      const { html } = await fetchNav(query)
      expect(countLi(resultInner(html))).toBe(0)
      expect(resultInner(html)).toContain(GATE_TEXT)
    }
  })
})

describe('playground · nav-only-empty（B2）· 通用边界', () => {
  it('生产环境返回 404（playgroundBlocked 是第一步）', async () => {
    vi.stubEnv('NODE_ENV', 'production')
    try {
      const { status } = await fetchNav('?navItems=6')
      expect(status).toBe(404)
    } finally {
      vi.unstubAllEnvs()
    }
  })
})

describe('playground · nav-only-empty（B2）· case 目录与路由输出同步', () => {
  it('case.json 的 url 与 pattern 与路由一致', () => {
    const caseFile = readCaseFile<CaseFile>('case.json')
    expect(caseFile.url).toBe(`${PATH}?navItems=6`)
    expect(caseFile.pattern).toEqual(['B2'])
  })

  it('expected.json 的行数、停机原因与选择器和路由输出一致', async () => {
    const expected = readCaseFile<ExpectedFile>('expected.json')
    expect(expected.expectedRows).toBe(0)
    expect(expected.expectedStop).toBe('gated')
    expect(expected.rowMatch).toEqual({ selector: 'main .result li', textPrefix: '' })
    expect(expected.oracle.strategy).toBe('static')

    const { html } = await fetchNav('?navItems=6')
    expect(countLi(resultInner(html))).toBe(expected.expectedRows)
  })

  it('stopSignal 与路由输出一致：main 含提示文字，且 trapVerifiedBy 为 naive', async () => {
    const expected = readCaseFile<ExpectedFile>('expected.json')
    expect(expected.stopSignal).toEqual([{ selector: 'main', textIncludes: GATE_TEXT }])
    expect(expected.trapVerifiedBy).toBe('naive')

    const { html } = await fetchNav('?navItems=6')
    expect(mainInner(html)).toContain(expected.stopSignal[0].textIncludes ?? '')
  })
})
