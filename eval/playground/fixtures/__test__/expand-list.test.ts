import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

import { NextRequest } from '../_lib/next-shim'
import { describe, expect, it, vi } from 'vitest'

import { GET as expandList } from '../expand-list/route'

const BASE = 'http://localhost:3008'
const PATH = '/dev-fixtures/playground/expand-list'

async function fetchPage(query = ''): Promise<{ status: number; html: string }> {
  const response = await expandList(new NextRequest(`${BASE}${PATH}${query}`))
  return { status: response.status, html: await response.text() }
}

/** 去掉 script 里的字符串，只看渲染出来的 DOM。 */
function markupOf(html: string): string {
  return html.replace(/<script>[\s\S]*?<\/script>/g, '')
}

function scriptOf(html: string): string {
  return html.match(/<script>([\s\S]*?)<\/script>/)?.[1] ?? ''
}

type ListItem = { classes: string; hidden: boolean; text: string }

/** 列表里所有 li（数据行与控件行），按 DOM 顺序。 */
function listItems(html: string): ListItem[] {
  return Array.from(markupOf(html).matchAll(/<li class="([^"]*)"( hidden)?>([\s\S]*?)<\/li>/g), (match) => ({
    classes: match[1],
    hidden: match[2] !== undefined,
    text: match[3].replace(/<[^>]+>/g, '').trim(),
  }))
}

/** 与 case 里的 rowMatch 一致：只保留以 textPrefix 开头的数据行（默认「商品 」）。 */
function dataRows(items: ListItem[], textPrefix = '商品 '): ListItem[] {
  return items.filter((item) => item.text.startsWith(textPrefix))
}

function visibleOf(items: ListItem[]): ListItem[] {
  return items.filter((item) => !item.hidden)
}

/** 变体：语言与 class 命名不同，结构和陷阱完全一样。names 是该变体的 class 名。 */
interface Variant {
  name: string
  query: string
  prefix: string
  currency: string
  more: (total: number) => string
  names: { list: string; row: string; expand: string; more: string }
}

const VARIANTS: Variant[] = [
  {
    name: 'lang=en&cls=hash（C08-002，留出变体）',
    query: '?rows=15&lang=en&cls=hash',
    prefix: 'Item ',
    currency: '$',
    more: (total) => `View all ${total} items`,
    names: { list: 'css-lz8f2q', row: 'css-rw3k9t', expand: 'css-xb9e2c', more: 'css-mr5q4a' },
  },
  {
    name: 'lang=ja（C08-003，语义 class）',
    query: '?rows=15&lang=ja',
    prefix: 'アイテム ',
    currency: '¥',
    more: (total) => `全 ${total} 件を表示`,
    names: { list: 'list', row: 'item', expand: 'expand', more: 'more-row' },
  },
  {
    name: 'cls=hash（中文）',
    query: '?rows=15&cls=hash',
    prefix: '商品 ',
    currency: '¥',
    more: (total) => `查看全部 ${total} 条`,
    names: { list: 'css-lz8f2q', row: 'css-rw3k9t', expand: 'css-xb9e2c', more: 'css-mr5q4a' },
  },
]

/** 第 n 行的可见文本，与 route 的文案一致（价格 = 100 + n）。 */
function rowText(variant: Variant, itemNumber: number): string {
  return `${variant.prefix}${itemNumber}${variant.currency}${100 + itemNumber}`
}

interface C08Expected {
  expectedRows: number
  expectedColumns: Record<string, string[]>
  rowMatch: { selector: string; textPrefix: string }
  naive: { rowMatch: { selector: string; textPrefix: string }; expectedRows: number }
  trapVerifiedBy: string
  oracle: { strategy: string; clickSelector?: string }
}

function caseJson(id: string, file: 'case.json' | 'expected.json'): string {
  return readFileSync(fileURLToPath(new URL(`../../cases/${id}/${file}`, import.meta.url)), 'utf8')
}

/** 与 playground-oracle countRows 的 naive 口径一致：数 DOM 里 selector 命中的全部 li（静态，hidden 与控件行也算）。 */
function countAllLi(html: string): number {
  return (markupOf(html).match(/<li[\s>]/g) ?? []).length
}

describe.each(['C08-001', 'C08-002', 'C08-003'])('playground · expand-list 与 %s case 同步', (id) => {
  it('rowMatch 在点击展开后数出 expectedRows：DOM 里的数据行（含 hidden）就是展开后的行数；naive 数出 naive.expectedRows（多出控件行）', async () => {
    const caseInfo = JSON.parse(caseJson(id, 'case.json')) as { url: string }
    const expected = JSON.parse(caseJson(id, 'expected.json')) as C08Expected
    const { status, html } = await fetchPage(new URL(caseInfo.url, 'http://localhost:3008').search)
    expect(status).toBe(200)

    const rowClass = /li\.([\w-]+)$/.exec(expected.rowMatch.selector)?.[1] ?? ''
    const rows = dataRows(listItems(html), expected.rowMatch.textPrefix)
    expect(rows).toHaveLength(expected.expectedRows)
    expect(rows.every((row) => row.classes.split(' ').includes(rowClass))).toBe(true)

    const listClass = /ul\.([\w-]+)/.exec(expected.naive.rowMatch.selector)?.[1] ?? ''
    expect(html).toContain(`<ul class="${listClass}">`)
    expect(countAllLi(html)).toBe(expected.naive.expectedRows)
    expect(expected.naive.expectedRows).toBeGreaterThan(expected.expectedRows)
    expect(expected.trapVerifiedBy).toBe('naive')
  })

  it('展开控件存在且唯一：oracle.clickSelector 的 class 与页面上的按钮一致；expectedColumns 为空（页面没有表头）', async () => {
    const caseInfo = JSON.parse(caseJson(id, 'case.json')) as { url: string }
    const expected = JSON.parse(caseJson(id, 'expected.json')) as C08Expected
    const { html } = await fetchPage(new URL(caseInfo.url, 'http://localhost:3008').search)
    const expandClass = /button\.([\w-]+)/.exec(expected.oracle.clickSelector ?? '')?.[1] ?? ''
    expect(expected.oracle.strategy).toBe('click-more')
    expect(markupOf(html).match(new RegExp(`<button class="${expandClass}"`, 'g'))).toHaveLength(1)
    expect(countMatches(html, /<th[\s>]/g)).toBe(0)
    expect(Object.keys(expected.expectedColumns)).toHaveLength(0)
  })
})

function countMatches(html: string, pattern: RegExp): number {
  return (html.match(pattern) ?? []).length
}

describe('playground · expand-list（C8）', () => {
  it('默认 15 行：DOM 里有 15 条数据行，其中 5 条带 hidden，前 3 个标题正确', async () => {
    const { status, html } = await fetchPage('?rows=15')
    expect(status).toBe(200)
    const rows = dataRows(listItems(html))
    expect(rows).toHaveLength(15)
    expect(rows.filter((row) => row.hidden)).toHaveLength(5)
    expect(rows.slice(0, 3).map((row) => row.text.split('¥')[0].trim())).toEqual(['商品 1', '商品 2', '商品 3'])
    expect(rows[0].text).toBe('商品 1¥101')
    expect(rows[14].text).toBe('商品 15¥115')
  })

  it('陷阱存在（静态可见）：可见的数据行只有前 10 行，隐藏的第 11–15 行拿不到', async () => {
    const { html } = await fetchPage('?rows=15')
    const visible = visibleOf(dataRows(listItems(html)))
    expect(visible).toHaveLength(10)
    expect(visible[9].text).toBe('商品 10¥110')
    expect(visible.some((row) => row.text === '商品 11¥111')).toBe(false)
  })

  it('陷阱存在（控件行混入）：只按结构选 li.item 会把「查看全部」当成第 11 行', async () => {
    const { html } = await fetchPage('?rows=15')
    const visibleByShape = visibleOf(listItems(html).filter((item) => item.classes.split(' ').includes('item')))
    // 10 条可见数据行 + 1 条控件行
    expect(visibleByShape).toHaveLength(11)
    expect(visibleByShape.map((item) => item.text)).toContain('查看全部 15 条')
    // 按 textPrefix 过滤后，控件行被排除
    expect(dataRows(visibleByShape)).toHaveLength(10)
  })

  it('控件行结构：li.item.more-row 内含 button.expand，文案「查看全部 15 条」，位于第 10 行与第 11 行之间', async () => {
    const { html } = await fetchPage('?rows=15')
    const markup = markupOf(html)
    expect(markup).toContain(
      '<li class="item more-row"><span class="title"><button class="expand" type="button">查看全部 15 条</button></span><span class="price"></span></li>'
    )
    expect(markup.match(/class="expand"/g)).toHaveLength(1)
    const tenth = markup.indexOf('<span class="title">商品 10</span>')
    const control = markup.indexOf('class="item more-row"')
    const eleventh = markup.indexOf('<span class="title">商品 11</span>')
    expect(tenth).toBeGreaterThan(-1)
    expect(tenth).toBeLessThan(control)
    expect(control).toBeLessThan(eleventh)
  })

  it('隐藏靠 hidden 属性，并且 CSS 用 !important 保证 .item 的 display:flex 盖不住它', async () => {
    const { html } = await fetchPage('?rows=15')
    expect(html).toContain('[hidden] { display: none !important; }')
    const hiddenRows = listItems(html).filter((item) => item.hidden)
    expect(hiddenRows.map((item) => item.text)).toEqual([
      '商品 11¥111',
      '商品 12¥112',
      '商品 13¥113',
      '商品 14¥114',
      '商品 15¥115',
    ])
  })

  it('脚本把 button.expand 绑到点击：显示 hidden 行并移除控件行', async () => {
    const { html } = await fetchPage('?rows=15')
    const script = scriptOf(html)
    expect(script).toContain("querySelectorAll('button.expand')")
    expect(script).toContain("querySelectorAll('ul.list > li.item[hidden]')")
    expect(script).toContain('row.hidden = false')
    expect(script).toContain("closest('li.more-row')")
    expect(script).toContain('control.remove()')
  })

  it('rows=10：没有超出部分，不出现控件行，也没有隐藏行', async () => {
    const { html } = await fetchPage('?rows=10')
    const items = listItems(html)
    expect(items).toHaveLength(10)
    expect(items.some((item) => item.classes.includes('more-row'))).toBe(false)
    expect(items.some((item) => item.hidden)).toBe(false)
    expect(html).not.toContain('class="expand"')
  })

  it('rows=11：控件行写的是「查看全部 11 条」，第 11 行是唯一的隐藏行', async () => {
    const { html } = await fetchPage('?rows=11')
    const items = listItems(html)
    const control = items.find((item) => item.classes.includes('more-row'))
    expect(control?.text).toBe('查看全部 11 条')
    const hiddenRows = items.filter((item) => item.hidden)
    expect(hiddenRows).toHaveLength(1)
    expect(hiddenRows[0].text).toBe('商品 11¥111')
  })

  it('rows=50：可见 10 行，隐藏 40 行，控件行写「查看全部 50 条」', async () => {
    const { html } = await fetchPage('?rows=50')
    const rows = dataRows(listItems(html))
    expect(rows).toHaveLength(50)
    expect(visibleOf(rows)).toHaveLength(10)
    expect(rows.filter((row) => row.hidden)).toHaveLength(40)
    expect(html).toContain('查看全部 50 条')
  })

  it('rows 夹到 [1, 50]，缺失或非法值回落到默认 15', async () => {
    const over = await fetchPage('?rows=500')
    expect(dataRows(listItems(over.html))).toHaveLength(50)

    const under = await fetchPage('?rows=0')
    const oneRow = listItems(under.html)
    expect(dataRows(oneRow)).toHaveLength(1)
    expect(oneRow.some((item) => item.classes.includes('more-row'))).toBe(false)

    const garbage = await fetchPage('?rows=abc')
    expect(dataRows(listItems(garbage.html))).toHaveLength(15)

    const missing = await fetchPage()
    expect(dataRows(listItems(missing.html))).toHaveLength(15)
  })

  it('显式 lang=zh&cls=semantic 与缺省参数的输出完全一致（C08-001 不受变体参数影响）', async () => {
    const implicit = await fetchPage('?rows=15')
    const explicit = await fetchPage('?rows=15&lang=zh&cls=semantic')
    expect(explicit.html).toBe(implicit.html)
  })

  it('非法 lang / cls 回落到中文与语义 class', async () => {
    const { html } = await fetchPage('?rows=15&lang=fr&cls=bogus')
    const implicit = await fetchPage('?rows=15')
    expect(html).toBe(implicit.html)
    expect(html).toContain('<ul class="list">')
    expect(dataRows(listItems(html))).toHaveLength(15)
  })

  it('生产环境直接 404', async () => {
    vi.stubEnv('NODE_ENV', 'production')
    try {
      const { status } = await fetchPage('?rows=15')
      expect(status).toBe(404)
    } finally {
      vi.unstubAllEnvs()
    }
  })
})

describe.each(VARIANTS)('playground · expand-list 变体 $name', (variant) => {
  const { names } = variant

  it('静态：DOM 里有 15 条数据行，5 条 hidden，可见的只有前 10 行，文案与价格正确', async () => {
    const { status, html } = await fetchPage(variant.query)
    expect(status).toBe(200)
    const rows = dataRows(listItems(html), variant.prefix)
    expect(rows).toHaveLength(15)
    expect(rows.filter((row) => row.hidden)).toHaveLength(5)
    expect(visibleOf(rows).map((row) => row.text)).toEqual(
      Array.from({ length: 10 }, (_, index) => rowText(variant, index + 1))
    )
    expect(rows[14].text).toBe(rowText(variant, 15))
  })

  it('陷阱存在（控件行混入）：控件行与数据行同形，只按结构选会多出一行', async () => {
    const { html } = await fetchPage(variant.query)
    const items = listItems(html)
    const control = items.find((item) => item.classes.split(' ').includes(names.more))
    expect(control?.text).toBe(variant.more(15))
    expect(control?.classes.split(' ')).toContain(names.row)
    // 只按结构（同一 row class）选，控件行可见，会多出 1 条
    const byShape = visibleOf(items.filter((item) => item.classes.split(' ').includes(names.row)))
    expect(byShape).toHaveLength(11)
    expect(dataRows(byShape, variant.prefix)).toHaveLength(10)
  })

  it('控件行位于第 10 行与第 11 行之间，且只有一个 expand 按钮', async () => {
    const { html } = await fetchPage(variant.query)
    const items = listItems(html)
    const index = items.findIndex((item) => item.classes.split(' ').includes(names.more))
    expect(items[index - 1].text).toBe(rowText(variant, 10))
    expect(items[index + 1].text).toBe(rowText(variant, 11))
    expect(markupOf(html).match(new RegExp(`class="${names.expand}"`, 'g'))).toHaveLength(1)
  })

  it('隐藏靠 hidden 属性，CSS 用 !important，行本身带 display:flex（与 shell 的 .item 同效）', async () => {
    const { html } = await fetchPage(variant.query)
    expect(html).toContain('[hidden] { display: none !important; }')
    expect(html).toContain(`.${names.row} { display: flex;`)
    const hiddenRows = listItems(html).filter((item) => item.hidden)
    expect(hiddenRows.map((item) => item.text)).toEqual([11, 12, 13, 14, 15].map((n) => rowText(variant, n)))
  })

  it('脚本选择器与变体 class 一致：点击 expand 显示 hidden 行并移除控件行', async () => {
    const { html } = await fetchPage(variant.query)
    const script = scriptOf(html)
    expect(script).toContain(`querySelectorAll('button.${names.expand}')`)
    expect(script).toContain(`querySelectorAll('ul.${names.list} > li.${names.row}[hidden]')`)
    expect(script).toContain(`closest('li.${names.more}')`)
    expect(script).toContain('row.hidden = false')
    expect(script).toContain('control.remove()')
  })
})
