import { readFileSync } from 'node:fs'

import { NextRequest } from '../_lib/next-shim'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { GET as thinPages } from '../thin-pages/route'

const BASE = 'http://localhost:3008'

async function fetchPage(query: string): Promise<{ status: number; html: string }> {
  const response = await thinPages(new NextRequest(`${BASE}/dev-fixtures/playground/thin-pages${query}`))
  return { status: response.status, html: await response.text() }
}

function countMatches(html: string, pattern: RegExp): number {
  return (html.match(pattern) ?? []).length
}

const KINDS = [
  { kind: 'empty', heading: '本店暂无评价', title: '本店评价' },
  { kind: 'deleted', heading: '当前内容已被删除，无法查看', title: '内容已删除' },
  { kind: 'gated', heading: '请先登录后查看', title: '请先登录' },
  { kind: 'challenge', heading: '访问过于频繁，请稍后再试', title: '访问受限' },
] as const

describe('playground · thin-pages（A5 瘦页 / 软 404 / 门控 / 拦截页）', () => {
  it.each(KINDS)('kind=$kind 返回 200，只有一个标题和一段说明，没有任何列表项', async ({ kind, heading, title }) => {
    const { status, html } = await fetchPage(`?kind=${kind}`)
    expect(status).toBe(200)
    expect(html).toContain(`<title>${title}</title>`)
    expect(countMatches(html, /<h1>/g)).toBe(1)
    expect(html).toContain(`<h1>${heading}</h1>`)
    expect(countMatches(html, /<p>/g)).toBe(1)
    expect(countMatches(html, /<ul[\s>]/g)).toBe(0)
    expect(countMatches(html, /<li[\s>]/g)).toBe(0)
    expect(countMatches(html, /class="item"/g)).toBe(0)
  })

  it('静态数行的陷阱不存在：rowMatch 的 li.item 在每种页面都是 0，与 expectedRows 0 一致', async () => {
    for (const { kind } of KINDS) {
      const { html } = await fetchPage(`?kind=${kind}`)
      expect(countMatches(html, /<li class="item"/g)).toBe(0)
    }
  })

  it('只有 gated 有登录按钮，其他三种没有任何按钮', async () => {
    const gated = await fetchPage('?kind=gated')
    expect(gated.html).toContain('<button type="button" class="btn">登录</button>')
    expect(countMatches(gated.html, /<button[\s>]/g)).toBe(1)

    for (const kind of ['empty', 'deleted', 'challenge']) {
      const { html } = await fetchPage(`?kind=${kind}`)
      expect(countMatches(html, /<button[\s>]/g)).toBe(0)
    }
  })

  it('不弹窗、不挂脚本、按钮不带 href 或事件：所有 kind 都不含 script、dialog 或 onclick', async () => {
    for (const { kind } of KINDS) {
      const { html } = await fetchPage(`?kind=${kind}`)
      expect(html).not.toContain('<script')
      expect(html).not.toMatch(/<dialog|role="dialog"|onclick|href=/)
    }
  })

  it('markup 不含真实站点名或品牌名，文案是中文', async () => {
    const forbidden = /拼多多|雪球|淘宝|京东|微博|小红书|闲鱼|企查查|Shopee|YouTube|Trustpilot|Airbnb|Booking|Spotify|Wikipedia/i
    for (const { kind } of KINDS) {
      const { html } = await fetchPage(`?kind=${kind}`)
      expect(html).not.toMatch(forbidden)
    }
  })

  it('非法或缺失的 kind 返回 404（不是默认页）', async () => {
    for (const query of ['', '?', '?kind=', '?kind=unknown', '?kind=EMPTY', '?kind=gone']) {
      const { status, html } = await fetchPage(query)
      expect(status).toBe(404)
      expect(html).toBe('Not found')
    }
  })
})

describe('playground · thin-pages 生产环境屏蔽', () => {
  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it('NODE_ENV=production 时返回 404', async () => {
    vi.stubEnv('NODE_ENV', 'production')
    const { status } = await fetchPage('?kind=empty')
    expect(status).toBe(404)
  })
})

function caseFileUrl(id: string, file: 'case.json' | 'expected.json'): URL {
  return new URL(`../../cases/${id}/${file}`, import.meta.url)
}

interface A05Case {
  id: string
  url: string
  variant: { kind: string }
}

interface A05Expected {
  expectedRows: number
  expectedStop: string
  expectedColumns: Record<string, string[]>
  rowMatch: { selector: string; textPrefix: string }
  stopSignal: { selector: string; textIncludes: string }[]
  trapVerifiedBy: string
  naive?: unknown
}

describe('playground · thin-pages 的 case 判据（A05）', () => {
  // rowMatch 用 selector 'li' 与空串 textPrefix：页面上任何 li 都会被数到，口径比只数 li.item 宽，
  // 若将来有人在瘦页里塞了列表，判据会立刻失败。空串 startsWith('') 对所有 li 为真，oracle 会真的数 DOM。
  // 陷阱是停机信号（页面没有列表，关键是停机原因），不可计数，所以不写 naive，trapVerifiedBy 为 stopSignal。
  // expectedStop 词表与 route.ts 文件头注释一致；与设计文档 §3.2 的枚举是否统一由 owner 决定，改动时两处一起改。
  const STOP_BY_KIND: Record<string, string> = {
    empty: 'page-empty',
    deleted: 'dead-link',
    gated: 'gated',
    challenge: 'blocked',
  }

  it.each(['A05-001', 'A05-002', 'A05-003', 'A05-004'])('%s 的 expected.json 是 v2 非空判据，且与 case 的 kind 对应', (id) => {
    const caseInfo = JSON.parse(readFileSync(caseFileUrl(id, 'case.json'), 'utf8')) as A05Case
    const expected = JSON.parse(readFileSync(caseFileUrl(id, 'expected.json'), 'utf8')) as A05Expected
    expect(expected.expectedRows).toBe(0)
    expect(expected.rowMatch).toEqual({ selector: 'li', textPrefix: '' })
    expect(expected.expectedColumns).toEqual({})
    expect(expected.trapVerifiedBy).toBe('stopSignal')
    expect(expected.naive).toBeUndefined()
    expect(expected.expectedStop).toBe(STOP_BY_KIND[caseInfo.variant.kind])
  })

  it.each(['A05-001', 'A05-002', 'A05-003', 'A05-004'])('%s 的 rowMatch 数出 0 行，stopSignal 文案在页面上真实存在', async (id) => {
    const caseInfo = JSON.parse(readFileSync(caseFileUrl(id, 'case.json'), 'utf8')) as A05Case
    const expected = JSON.parse(readFileSync(caseFileUrl(id, 'expected.json'), 'utf8')) as A05Expected
    const { status, html } = await fetchPage(new URL(caseInfo.url, BASE).search)
    expect(status).toBe(200)
    expect(countMatches(html, /<li[\s>]/g)).toBe(expected.expectedRows)
    expect(expected.stopSignal).toHaveLength(1)
    expect(expected.stopSignal[0].selector).toBe('body')
    expect(html).toContain(expected.stopSignal[0].textIncludes)
  })
})
