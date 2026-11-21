import { readFileSync } from 'node:fs'

import { afterEach, describe, expect, it, vi } from 'vitest'

import { GET as blockedPage } from '../blocked-page/route'

const PATH = '/dev-fixtures/playground/blocked-page'
/** 仓库根下的 F2 case 目录：用于确认 case.json / expected.json 与路由输出同步。 */
const CASE_DIR = new URL('../../cases/F02-001/', import.meta.url)

/** 拦截页的标题与正文文案；与 route.ts 的 TITLE / NOTICE 必须一致。 */
const TITLE = '访问被拒绝'
const NOTICE = '访问被拒绝（403）：请求过于频繁或来源受限。'

interface CaseJson {
  id: string
  pattern: string[]
  url: string
  heldOut: boolean
  status: string
}

interface ExpectedJson {
  expectedRows: number
  expectedStop: string
  rowMatch: { selector: string; textPrefix: string }
  oracle: { strategy: string }
  stopSignal: Array<{ selector: string; exists?: boolean; textIncludes?: string }>
  trapVerifiedBy: string
  naive?: unknown
}

function readCaseFile<T>(name: string): T {
  return JSON.parse(readFileSync(new URL(name, CASE_DIR), 'utf8')) as T
}

async function fetchBlockedPage(): Promise<{ status: number; html: string; contentType: string | null }> {
  const response = await blockedPage()
  return {
    status: response.status,
    html: await response.text(),
    contentType: response.headers.get('Content-Type'),
  }
}

afterEach(() => {
  vi.unstubAllEnvs()
})

describe('playground · blocked-page（F2）· 403 拦截页', () => {
  it('返回 HTTP 403，Content-Type 为 text/html', async () => {
    const { status, contentType } = await fetchBlockedPage()
    expect(status).toBe(403)
    expect(contentType).toBe('text/html; charset=utf-8')
  })

  it('标题与正文是「访问被拒绝」拦截文案', async () => {
    const { html } = await fetchBlockedPage()
    expect(html).toContain(`<title>${TITLE}</title>`)
    expect(html).toContain(`<h1>${TITLE}</h1>`)
    expect(html).toContain(NOTICE)
  })

  it('没有任何列表项、没有列表容器、没有重试按钮、没有脚本', async () => {
    const { html } = await fetchBlockedPage()
    expect(html).not.toMatch(/<li[\s>]/)
    expect(html).not.toMatch(/<(ul|ol)[\s>]/)
    expect(html).not.toMatch(/<button[\s>]/)
    expect(html).not.toMatch(/重试|再试/)
    expect(html).not.toMatch(/<script[\s>]/)
  })

  it('NODE_ENV=production 时返回 404，不暴露拦截页', async () => {
    vi.stubEnv('NODE_ENV', 'production')
    const response = await blockedPage()
    expect(response.status).toBe(404)
  })
})

describe('F02-001 case 与路由输出同步', () => {
  it('case.json 指向本路由，且 pattern 为 F2、heldOut 为 false', () => {
    const caseJson = readCaseFile<CaseJson>('case.json')
    expect(caseJson.id).toBe('F02-001')
    expect(caseJson.pattern).toEqual(['F2'])
    expect(caseJson.url).toBe(PATH)
    expect(caseJson.heldOut).toBe(false)
    // status 由 oracle 的 --write 改写（pending-live-run / oracle-verified / oracle-failed），只校验存在，不钉死具体值
    expect(typeof caseJson.status).toBe('string')
    expect(caseJson.status.length).toBeGreaterThan(0)
  })

  it('expected.json 声明 0 行、blocked 停机，且 trapVerifiedBy 为 stopSignal', () => {
    const expected = readCaseFile<ExpectedJson>('expected.json')
    expect(expected.expectedRows).toBe(0)
    expect(expected.expectedStop).toBe('blocked')
    expect(expected.rowMatch).toEqual({ selector: 'li', textPrefix: '' })
    expect(expected.oracle.strategy).toBe('static')
    expect(expected.trapVerifiedBy).toBe('stopSignal')
    expect(expected.naive).toBeUndefined()
  })

  it('expected.json 的 stopSignal 文案确实出现在路由正文里', async () => {
    const expected = readCaseFile<ExpectedJson>('expected.json')
    const { html } = await fetchBlockedPage()
    expect(expected.stopSignal).toEqual([{ selector: 'body', textIncludes: '访问被拒绝（403）' }])
    expect(html).toContain(expected.stopSignal[0].textIncludes ?? '')
  })
})
