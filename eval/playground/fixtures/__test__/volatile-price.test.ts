import { readFileSync } from 'node:fs'

import { NextRequest } from '../_lib/next-shim'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { GET as volatilePrice } from '../volatile-price/route'

const BASE = 'http://localhost:3008'
const PATH = '/dev-fixtures/playground/volatile-price'
/** 仓库根下的 C3 case 目录：用于确认 case.json / expected.json 与路由输出同步。 */
const CASES_URL = new URL('../../cases/', import.meta.url)

async function fetchPage(query: string): Promise<{ status: number; html: string }> {
  const response = await volatilePrice(new NextRequest(`${BASE}${PATH}${query}`))
  return { status: response.status, html: await response.text() }
}

/** 每个 li.row 是一个完整块（行内没有嵌套的 li）。 */
function rowBlocks(html: string): string[] {
  return html.match(/<li class="row">[\s\S]*?<\/li>/g) ?? []
}

/** 行号从 1 起算。 */
function rowNumber(index: number): number {
  return index + 1
}

/** 价格块的内部 HTML：去掉 li 开头的标题与价格块自己的 div 包裹。 */
function priceInner(block: string): string {
  const match = block.match(/<div class="css-[a-z0-9]+">([\s\S]*)<\/div><\/li>$/)
  if (!match) throw new Error(`找不到价格块: ${block}`)
  return match[1]
}

interface PriceChild {
  struck: boolean
  text: string
}

/** 价格块的子 div，按文档顺序；struck 表示带删除线（划线原价）。 */
function priceChildren(block: string): PriceChild[] {
  const children = priceInner(block).match(/<div[^>]*>[^<]*<\/div>/g) ?? []
  return children.map((child) => ({
    struck: child.includes('text-decoration:line-through'),
    text: child.replace(/<[^>]+>/g, ''),
  }))
}

/** 位置选择器 li.row > div > div:first-child：取价格块的第一个子 div（陷阱写法）。 */
function positionalPrice(block: string): string {
  const first = priceChildren(block)[0]
  if (!first) throw new Error(`价格块没有子 div: ${block}`)
  return first.text
}

/** 语义选择：取价格块里没有划线的那个子 div（即现价，不依赖位置，也不依赖哈希 class）。 */
function semanticPrice(block: string): string {
  const current = priceChildren(block).filter((child) => !child.struck)
  if (current.length !== 1) throw new Error(`应当恰好一个未划线的子 div: ${block}`)
  return current[0].text
}

function countDiscountRows(html: string): number {
  return (html.match(/text-decoration:line-through/g) ?? []).length
}

/** 标准答案：第 n 行的现价是 ¥n；折扣行（n % discountEvery === 0）的划线原价是 ¥(n+50)。 */
function expectedCurrentPrices(count: number): string[] {
  return Array.from({ length: count }, (_, index) => `¥${rowNumber(index)}`)
}

describe('playground · volatile-price（C3）', () => {
  it('case C03-001：渲染 20 行，全部在 ul.list 里，表头「现价」是页面上的可见文字', async () => {
    const { status, html } = await fetchPage('?rows=20&discountEvery=3')
    expect(status).toBe(200)
    expect(html).toContain('<ul class="list">')
    expect(rowBlocks(html)).toHaveLength(20)
    expect(html).toContain('<span>现价</span>')
  })

  it('价格块的 class 是哈希风格的 css-<n>，页面上没有语义化的 price 类名', async () => {
    const { html } = await fetchPage('?rows=20&discountEvery=3')
    const classes = rowBlocks(html).map((block) => block.match(/<div class="([^"]+)">/)?.[1])
    for (const className of classes) {
      expect(className).toMatch(/^css-[a-z0-9]+$/)
    }
    expect(html).not.toContain('class="price"')
  })

  it('折扣行恰好是第 discountEvery、2×discountEvery… 行；无折扣行的价格块只有一个子 div', async () => {
    const { html } = await fetchPage('?rows=20&discountEvery=3')
    const blocks = rowBlocks(html)
    blocks.forEach((block, index) => {
      const shouldDiscount = rowNumber(index) % 3 === 0
      const children = priceChildren(block)
      expect(children).toHaveLength(shouldDiscount ? 2 : 1)
      expect(children.some((child) => child.struck)).toBe(shouldDiscount)
    })
    expect(countDiscountRows(html)).toBe(6)
  })

  it('划线原价是 ¥(n+50)，现价是 ¥n；折扣行的现价在第二个子 div', async () => {
    const { html } = await fetchPage('?rows=20&discountEvery=3')
    const blocks = rowBlocks(html)
    const row3 = priceChildren(blocks[2])
    expect(row3).toEqual([
      { struck: true, text: '¥53' },
      { struck: false, text: '¥3' },
    ])
    const row1 = priceChildren(blocks[0])
    expect(row1).toEqual([{ struck: false, text: '¥1' }])
  })

  it('陷阱存在：位置选择器 div:first-child 在有折扣的行上取到划线原价，语义选择（非划线的子 div）取到现价', async () => {
    const { html } = await fetchPage('?rows=20&discountEvery=3')
    const blocks = rowBlocks(html)

    // 位置选择器在折扣行上取到的是划线原价（¥53 而不是 ¥3）
    const positional = blocks.map(positionalPrice)
    expect(positional[2]).toBe('¥53')
    expect(positional[5]).toBe('¥56')

    // 语义选择（取非划线的子 div）在每一行都取到现价
    const semantic = blocks.map(semanticPrice)
    expect(semantic[2]).toBe('¥3')
    expect(semantic).toEqual(expectedCurrentPrices(20))

    // 位置选择器与标准答案只在折扣行上不一致，其余行一致
    const mismatchRows = blocks.flatMap((block, index) =>
      positionalPrice(block) === semantic[index] ? [] : [rowNumber(index)]
    )
    expect(mismatchRows).toEqual([3, 6, 9, 12, 15, 18])
  })

  it('expectedColumns 的「现价」前 3 个值（¥1、¥2、¥3）与语义选择一致，其中第 3 行是折扣行', async () => {
    const { html } = await fetchPage('?rows=20&discountEvery=3')
    const blocks = rowBlocks(html)
    expect(blocks.slice(0, 3).map(semanticPrice)).toEqual(['¥1', '¥2', '¥3'])
    expect(blocks.slice(0, 3).map(positionalPrice)).toEqual(['¥1', '¥2', '¥53'])
  })

  it('默认参数（无 query）：20 行，每 3 行一个折扣', async () => {
    const { status, html } = await fetchPage('')
    expect(status).toBe(200)
    expect(rowBlocks(html)).toHaveLength(20)
    expect(countDiscountRows(html)).toBe(6)
  })

  it('越界与非法参数：夹到 [min, max]，非数字用默认值（本路由不返回 404）', async () => {
    const zero = await fetchPage('?rows=0&discountEvery=3')
    expect(zero.status).toBe(200)
    expect(rowBlocks(zero.html)).toHaveLength(1)

    const tooMany = await fetchPage('?rows=999&discountEvery=3')
    expect(rowBlocks(tooMany.html)).toHaveLength(50)
    expect(countDiscountRows(tooMany.html)).toBe(16)

    // discountEvery=1 夹到下界 2：偶数行是折扣行
    const everyOne = await fetchPage('?rows=6&discountEvery=1')
    expect(countDiscountRows(everyOne.html)).toBe(3)
    expect(rowBlocks(everyOne.html).map((block) => priceChildren(block).length)).toEqual([1, 2, 1, 2, 1, 2])

    // discountEvery=99 夹到上界 10：20 行里只有第 10、20 行是折扣行
    const rare = await fetchPage('?rows=20&discountEvery=99')
    expect(countDiscountRows(rare.html)).toBe(2)

    const garbage = await fetchPage('?rows=abc&discountEvery=xyz')
    expect(rowBlocks(garbage.html)).toHaveLength(20)
    expect(countDiscountRows(garbage.html)).toBe(6)
  })
})

describe('playground · volatile-price 与 C03-001 的 case 文件同步', () => {
  it('C03-001：expected.json 的 rowMatch 命中每一行，expectedRows 等于渲染行数，expectedColumns 的现价值与页面一致', async () => {
    const dir = new URL('C03-001/', CASES_URL)
    const caseFile = JSON.parse(readFileSync(new URL('case.json', dir), 'utf-8')) as { url: string }
    const expected = JSON.parse(readFileSync(new URL('expected.json', dir), 'utf-8')) as {
      expectedRows: number
      expectedColumns: Record<string, string[]>
      rowMatch: { selector: string; textPrefix: string }
      trapVerifiedBy: string
      trapTest: string
    }

    expect(expected.rowMatch.selector).toBe('li.row')
    expect(expected.trapVerifiedBy).toBe('vitest')
    expect(expected.trapTest).toBe('陷阱存在：位置选择器 div:first-child 在有折扣的行上取到划线原价，语义选择（非划线的子 div）取到现价')

    const { status, html } = await fetchPage(caseFile.url.replace(PATH, ''))
    expect(status).toBe(200)

    const blocks = rowBlocks(html)
    expect(blocks).toHaveLength(expected.expectedRows)
    expect(blocks.every((block) => block.replace(/<[^>]+>/g, '').startsWith(expected.rowMatch.textPrefix))).toBe(true)

    const currentValues = expected.expectedColumns['现价'] ?? []
    expect(blocks.slice(0, currentValues.length).map(semanticPrice)).toEqual(currentValues)
    expect(html).toContain('<span>现价</span>')
  })
})

describe('playground · volatile-price 生产环境屏蔽', () => {
  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it('NODE_ENV=production 时返回 404', async () => {
    vi.stubEnv('NODE_ENV', 'production')
    const { status } = await fetchPage('?rows=20&discountEvery=3')
    expect(status).toBe(404)
  })
})
