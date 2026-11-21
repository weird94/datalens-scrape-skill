import { readFileSync } from 'node:fs'

import { NextRequest } from '../_lib/next-shim'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { GET as splitValue } from '../split-value/route'

const BASE = 'http://localhost:3008'
const PATH = '/dev-fixtures/playground/split-value'
/** 仓库根下的 C10 case 目录：用于确认 case.json / expected.json 与路由输出同步。 */
const CASES_URL = new URL('../../cases/', import.meta.url)

async function fetchPage(query: string): Promise<{ status: number; html: string }> {
  const response = await splitValue(new NextRequest(`${BASE}${PATH}${query}`))
  return { status: response.status, html: await response.text() }
}

function rowBlocks(html: string): string[] {
  return html.match(/<li class="[^"]+">[\s\S]*?<\/li>/g) ?? []
}

/** 价格块里两个子 div 的文字，按顺序（整数、小数）。 */
function priceParts(block: string, wrapClass: string): string[] {
  const wrap = block.match(new RegExp(`<div class="${wrapClass}">((?:<div[^>]*>[^<]*</div>)+)</div>`))
  if (!wrap) throw new Error(`找不到价格块: ${block}`)
  return (wrap[1].match(/<div[^>]*>([^<]*)<\/div>/g) ?? []).map(part => part.replace(/<[^>]+>/g, ''))
}

describe('playground · split-value（C10）', () => {
  it('价格块的整数和小数各是一个 div；每 3 行有一行小数 div 为空', async () => {
    const { status, html } = await fetchPage('?rows=6')
    expect(status).toBe(200)
    const parts = rowBlocks(html).map(block => priceParts(block, 'price-wrap'))
    expect(parts).toEqual([
      ['67', '.1'],
      ['74', '.2'],
      ['81', ''],
      ['88', '.4'],
      ['95', '.5'],
      ['102', ''],
    ])
  })

  it('flex 布局：价格块横排无间距，产地块横排有 8px 间距；描述是两个 <p>', async () => {
    const { html } = await fetchPage('?rows=1')
    expect(html).toContain('.price-wrap { display: flex; align-items: baseline; }')
    expect(html).toContain('.origin { display: flex; column-gap: 8px; }')
    expect(rowBlocks(html)[0]).toMatch(/<div class="desc"><p>[^<]+<\/p><p>[^<]+<\/p><\/div>/)
  })

  it('留出变体：inline-block、英文、哈希类名，页面上没有语义化的 price 类名', async () => {
    const { html } = await fetchPage('?rows=3&layout=inline-block&lang=en&classes=hash')
    expect(html).toContain('.Pw4m1z > div { display: inline-block; }')
    expect(html).not.toContain('price-wrap')
    expect(rowBlocks(html).map(block => priceParts(block, 'Pw4m1z'))[0]).toEqual(['67', '.1'])
    expect(html).toContain('Item 1')
  })
})

describe('playground · split-value 与 C10 的 case 文件同步', () => {
  it.each([
    ['C10-001', '价格', 'price-wrap'],
    ['C10-002', 'Price', 'Pw4m1z'],
  ])('%s：rowMatch 命中每一行，expectedRows 等于渲染行数，价格列与页面一致', async (id, column, wrapClass) => {
    const dir = new URL(`${id}/`, CASES_URL)
    const caseFile = JSON.parse(readFileSync(new URL('case.json', dir), 'utf-8')) as { url: string }
    const expected = JSON.parse(readFileSync(new URL('expected.json', dir), 'utf-8')) as {
      expectedRows: number
      expectedColumns: Record<string, string[]>
      rowMatch: { selector: string; textPrefix: string }
    }

    const { status, html } = await fetchPage(caseFile.url.replace(PATH, ''))
    expect(status).toBe(200)
    const blocks = rowBlocks(html)
    expect(blocks).toHaveLength(expected.expectedRows)
    expect(blocks.every(block => block.replace(/<[^>]+>/g, '').startsWith(expected.rowMatch.textPrefix))).toBe(true)

    const prices = expected.expectedColumns[column] ?? []
    expect(blocks.slice(0, prices.length).map(block => priceParts(block, wrapClass).join(''))).toEqual(prices)
  })
})

describe('playground · split-value 生产环境屏蔽', () => {
  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it('NODE_ENV=production 时返回 404', async () => {
    vi.stubEnv('NODE_ENV', 'production')
    const { status } = await fetchPage('')
    expect(status).toBe(404)
  })
})
