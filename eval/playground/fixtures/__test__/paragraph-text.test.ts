import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

import { NextRequest } from '../_lib/next-shim'
import { describe, expect, it, vi } from 'vitest'

import { GET as paragraphText } from '../paragraph-text/route'

const BASE = 'http://localhost:3008'
const PATH = '/dev-fixtures/playground/paragraph-text'
/** 仓库根下的 cases 目录：用于确认 C09-001 的 case 与路由输出同步。 */
const CASES_URL = new URL('../../cases/', import.meta.url)

interface ExpectedFile {
  expectedRows: number
  rowMatch: { selector: string; textPrefix: string }
  naive: { strategy: string; rowMatch: { selector: string; textPrefix: string }; expectedRows: number }
  trapVerifiedBy: string
}

interface CaseFile {
  url: string
  status: string
}

function readCaseFile(id: string, file: 'expected.json' | 'case.json'): unknown {
  return JSON.parse(readFileSync(fileURLToPath(new URL(`${id}/${file}`, CASES_URL)), 'utf8'))
}

async function fetchPage(query: string): Promise<{ status: number; html: string }> {
  const response = await paragraphText(new NextRequest(`${BASE}${PATH}${query}`))
  return { status: response.status, html: await response.text() }
}

/** 正文区（div.content）内的全部 <p> 的内部 HTML。 */
function paragraphInners(html: string): string[] {
  const content = html.match(/<div class="content">([\s\S]*?)<\/div>/)?.[1] ?? ''
  return Array.from(content.matchAll(/<p>([\s\S]*?)<\/p>/g), (match) => match[1])
}

/** 去掉标签后的文本，等价于这里 textContent 能读到的内容。 */
function visibleText(fragment: string): string {
  return fragment.replace(/<[^>]+>/g, '').trim()
}

/** 等价于选择器 `div.content p span`：只认包在 span 里的段落文字。 */
function spanTexts(html: string): string[] {
  return paragraphInners(html).flatMap((inner) =>
    Array.from(inner.matchAll(/<span>([\s\S]*?)<\/span>/g), (match) => visibleText(match[1]))
  )
}

describe('playground · paragraph-text（C9）', () => {
  it('默认 7 段，每段的 textContent 都以「段落 」开头，按序编号', async () => {
    const { status, html } = await fetchPage('')
    expect(status).toBe(200)
    const inners = paragraphInners(html)
    expect(inners).toHaveLength(7)
    const texts = inners.map(visibleText)
    texts.forEach((text, index) => {
      expect(text.startsWith('段落 ')).toBe(true)
      expect(text.startsWith(`段落 ${index + 1}：`)).toBe(true)
    })
  })

  it('默认 withSpan=1：只有第 1 段的文字包在 span 里，其余 6 段的 p 没有任何子元素', async () => {
    const { html } = await fetchPage('?paras=7&withSpan=1')
    const inners = paragraphInners(html)
    expect(inners).toHaveLength(7)
    expect(inners[0]).toMatch(/^<span>段落 1：[^<]*<\/span>$/)
    for (const inner of inners.slice(1)) {
      expect(inner).not.toContain('<')
      expect(inner.startsWith('段落 ')).toBe(true)
    }
  })

  it('陷阱：`div.content p span` 只命中 withSpan 段，其余段落的文字不在任何 span 里', async () => {
    const { html } = await fetchPage('?paras=7&withSpan=1')
    expect(spanTexts(html)).toHaveLength(1)
    expect(spanTexts(html)[0].startsWith('段落 1：')).toBe(true)
    // 直接持有文本的段落仍然存在于 p 上，只认 span 的选择器会丢掉它们
    expect(paragraphInners(html).filter((inner) => !inner.includes('<span>')).map(visibleText)).toHaveLength(6)
  })

  it('withSpan=3 时前 3 段在 span 里，第 4–7 段直接持有文本', async () => {
    const { html } = await fetchPage('?paras=7&withSpan=3')
    const inners = paragraphInners(html)
    expect(inners).toHaveLength(7)
    expect(spanTexts(html)).toHaveLength(3)
    inners.forEach((inner, index) => {
      if (index < 3) {
        expect(inner).toContain('<span>')
      } else {
        expect(inner).not.toContain('<span>')
        expect(inner.startsWith(`段落 ${index + 1}：`)).toBe(true)
      }
    })
  })

  it('withSpan 超过 paras 时全部段落都包在 span 里', async () => {
    const { html } = await fetchPage('?paras=4&withSpan=20')
    expect(paragraphInners(html)).toHaveLength(4)
    expect(spanTexts(html)).toHaveLength(4)
  })

  it('paras 越界按 intParam 夹到 [1, 20]，非数字回落到默认 7', async () => {
    const high = await fetchPage('?paras=999')
    expect(high.status).toBe(200)
    expect(paragraphInners(high.html)).toHaveLength(20)

    const low = await fetchPage('?paras=0')
    expect(low.status).toBe(200)
    expect(paragraphInners(low.html)).toHaveLength(1)

    const garbage = await fetchPage('?paras=abc')
    expect(garbage.status).toBe(200)
    expect(paragraphInners(garbage.html)).toHaveLength(7)
  })

  it('withSpan 越界按 intParam 夹到 [1, 20]，0 与非数字都回落到下界 1 或默认 1', async () => {
    const high = await fetchPage('?paras=7&withSpan=99')
    expect(spanTexts(high.html)).toHaveLength(7)

    const low = await fetchPage('?paras=7&withSpan=0')
    expect(spanTexts(low.html)).toHaveLength(1)

    const garbage = await fetchPage('?paras=7&withSpan=abc')
    expect(spanTexts(garbage.html)).toHaveLength(1)
  })

  it('生产环境返回 404（playgroundBlocked 是第一步）', async () => {
    vi.stubEnv('NODE_ENV', 'production')
    try {
      const { status } = await fetchPage('?paras=7&withSpan=1')
      expect(status).toBe(404)
    } finally {
      vi.unstubAllEnvs()
    }
  })

  describe('C09-001 case 与路由输出同步', () => {
    const expected = readCaseFile('C09-001', 'expected.json') as ExpectedFile
    const caseFile = readCaseFile('C09-001', 'case.json') as CaseFile

    it('case.json 的 url 指向本路由，且 status 为非空字符串', async () => {
      expect(caseFile.url).toBe('/dev-fixtures/playground/paragraph-text?paras=7&withSpan=1')
      // status 由 oracle 的 --write 改写（oracle-verified / oracle-failed），这里只校验它存在，不钉死具体值
      expect(typeof caseFile.status).toBe('string')
      expect(caseFile.status.length).toBeGreaterThan(0)
      const { status } = await fetchPage(caseFile.url.slice(PATH.length))
      expect(status).toBe(200)
    })

    it('oracle（rowMatch：div.content p，textPrefix「段落 」）静态计数等于 expectedRows', async () => {
      const { html } = await fetchPage(caseFile.url.slice(PATH.length))
      const matched = paragraphInners(html).map(visibleText).filter((text) => text.startsWith(expected.rowMatch.textPrefix))
      expect(expected.rowMatch.selector).toBe('div.content p')
      expect(matched).toHaveLength(expected.expectedRows)
      expect(expected.expectedRows).toBe(7)
    })

    it('naive（rowMatch：div.content p span）静态计数等于 naive.expectedRows，陷阱由 naive 核验', async () => {
      const { html } = await fetchPage(caseFile.url.slice(PATH.length))
      expect(expected.trapVerifiedBy).toBe('naive')
      expect(expected.naive.strategy).toBe('static')
      expect(expected.naive.rowMatch.selector).toBe('div.content p span')
      const matched = spanTexts(html).filter((text) => text.startsWith(expected.naive.rowMatch.textPrefix))
      expect(matched).toHaveLength(expected.naive.expectedRows)
      expect(expected.naive.expectedRows).toBe(1)
    })
  })
})
