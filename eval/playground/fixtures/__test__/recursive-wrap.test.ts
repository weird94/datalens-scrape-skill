import { readFileSync } from 'node:fs'

import { NextRequest } from '../_lib/next-shim'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { GET as recursiveWrap } from '../recursive-wrap/route'

const BASE = 'http://localhost:3008'
const PATH = '/dev-fixtures/playground/recursive-wrap'
/** 仓库根目录下的标准答案目录：从本文件所在的 __test__ 目录往上 7 级。 */
const CASES_DIR = new URL('../../cases/', import.meta.url)

async function fetchHtml(query: string): Promise<{ status: number; html: string }> {
  const response = await recursiveWrap(new NextRequest(`${BASE}${PATH}${query}`))
  return { status: response.status, html: await response.text() }
}

type DivNode = { cls: string; children: DivNode[]; text: string }

/**
 * 解析 div 的嵌套关系，并记下每个 div 的文字（去掉标签）。
 * 卡片内部只用 span，不影响结构判断；text 用来检查 textPrefix 的判据强度。
 */
function parseDivTree(html: string): DivNode {
  const root: DivNode = { cls: '#root', children: [], text: '' }
  const stack: Array<{ node: DivNode; bodyStart: number }> = [{ node: root, bodyStart: 0 }]
  for (const match of html.matchAll(/<div(?: class="([^"]*)")?[^>]*>|<\/div>/g)) {
    const index = match.index ?? 0
    if (match[0] === '</div>') {
      const open = stack.pop()
      if (open) open.node.text = html.slice(open.bodyStart, index).replace(/<[^>]+>/g, '')
      continue
    }
    const node: DivNode = { cls: match[1] ?? '', children: [], text: '' }
    stack[stack.length - 1].node.children.push(node)
    stack.push({ node, bodyStart: index + match[0].length })
  }
  return root
}

/** 按前序收集所有 class 匹配的节点（即文档顺序）。 */
function collect(node: DivNode, cls: string): DivNode[] {
  const self = node.cls === cls ? [node] : []
  return self.concat(node.children.flatMap((child) => collect(child, cls)))
}

interface ExpectedFile {
  expectedRows: number
  rowMatch: { selector: string; textPrefix: string }
  naive: { strategy: string; rowMatch: { selector: string; textPrefix: string }; expectedRows: number }
}

function loadCase(caseId: string): { url: string; expected: ExpectedFile } {
  const caseFile = JSON.parse(readFileSync(new URL(`${caseId}/case.json`, CASES_DIR), 'utf8')) as { url: string }
  const expected = JSON.parse(readFileSync(new URL(`${caseId}/expected.json`, CASES_DIR), 'utf8')) as ExpectedFile
  return { url: caseFile.url, expected }
}

interface Variant {
  caseId: string
  lang: 'zh' | 'en' | 'ja'
  heading: string
  wrap: string
  album: string
  title: string
  year: string
  /** 前 3 张卡片的标题与年份字面值。页面没有表头，所以不放进 expected.json（不写 expectedColumns 的键）。 */
  firstTitles: string[]
  firstYears: string[]
}

/**
 * 三个变体：A03-001 中文 + 语义类名，A03-002 英文 + 哈希类名 1（开发集）；
 * A03-003 日文 + 哈希类名 2 + 20 层（留出集，验收时才用于判卷）。
 * 这里只检查 mock 与标准答案是否一致，不用来调修复。
 */
const VARIANTS: Variant[] = [
  {
    caseId: 'A03-001',
    lang: 'zh',
    heading: '专辑列表',
    wrap: 'wrap',
    album: 'album',
    title: 'title',
    year: 'year',
    firstTitles: ['专辑 1', '专辑 2', '专辑 3'],
    firstYears: ['1998 年', '2001 年', '2004 年'],
  },
  {
    caseId: 'A03-002',
    lang: 'en',
    heading: 'Albums',
    wrap: 'css-7f3c2a',
    album: 'css-91be04',
    title: 'css-2d6e8f',
    year: 'css-c05a1b',
    firstTitles: ['Album 1', 'Album 2', 'Album 3'],
    firstYears: ['1998', '2001', '2004'],
  },
  {
    caseId: 'A03-003',
    lang: 'ja',
    heading: 'アルバム一覧',
    wrap: 'k3m9ab',
    album: 'k3p0cd',
    title: 'k3r7ef',
    year: 'k3t2gh',
    firstTitles: ['アルバム 1', 'アルバム 2', 'アルバム 3'],
    firstYears: ['1998年', '2001年', '2004年'],
  },
]

afterEach(() => {
  vi.unstubAllEnvs()
})

describe.each(VARIANTS)('playground · recursive-wrap（$caseId，$lang）', (variant) => {
  const { url, expected } = loadCase(variant.caseId)
  const rows = expected.expectedRows

  it('case.url 指向本路由；卡片数等于 expectedRows；rowMatch 选择器就是卡片类名', async () => {
    expect(new URL(url, BASE).pathname).toBe(PATH)
    expect(expected.rowMatch.selector).toBe(`.${variant.album}`)
    const { status, html } = await fetchHtml(new URL(url, BASE).search)
    expect(status).toBe(200)
    expect(collect(parseDivTree(html), variant.album)).toHaveLength(rows)
  })

  it('页面标题文案与 html lang 跟语言一致', async () => {
    const { html } = await fetchHtml(new URL(url, BASE).search)
    expect(html).toContain(`<html lang="${variant.lang}">`)
    expect(html).toContain(`<h1>${variant.heading}</h1>`)
  })

  it('陷阱存在：前 N-1 层的直接子节点是「卡片 + 下一层 wrap」，最后一层只有卡片，兄弟组共 2N-1 个节点', async () => {
    const { html } = await fetchHtml(new URL(url, BASE).search)
    const wraps = collect(parseDivTree(html), variant.wrap)
    expect(wraps).toHaveLength(rows)
    const childKinds = wraps.map((wrap) => wrap.children.map((child) => child.cls))
    for (const kinds of childKinds.slice(0, rows - 1)) {
      expect(kinds).toEqual([variant.album, variant.wrap])
    }
    expect(childKinds[rows - 1]).toEqual([variant.album])
    const siblingGroup = wraps.flatMap((wrap) => wrap.children)
    expect(siblingGroup).toHaveLength(2 * rows - 1)
    expect(siblingGroup.filter((node) => node.cls === variant.album)).toHaveLength(rows)
    // naive 块：选择器就是这个兄弟组（.wrap > *），数值必须等于兄弟组大小
    expect(expected.naive.rowMatch.selector).toBe(`.${variant.wrap} > *`)
    expect(expected.naive.expectedRows).toBe(siblingGroup.length)
  })

  it('已知弱点：textPrefix 判不出嵌套 wrap 行，兄弟组里每个节点的文字都以它开头（所以判据要靠身份和 expectedRows）', async () => {
    const { html } = await fetchHtml(new URL(url, BASE).search)
    const siblingGroup = collect(parseDivTree(html), variant.wrap).flatMap((wrap) => wrap.children)
    expect(siblingGroup.every((node) => node.text.startsWith(expected.rowMatch.textPrefix))).toBe(true)
    expect(siblingGroup.every((node) => node.text.startsWith(expected.naive.rowMatch.textPrefix))).toBe(true)
  })

  it('标题与年份：总数等于 expectedRows，前 3 行与字面值一致', async () => {
    const { html } = await fetchHtml(new URL(url, BASE).search)
    const titles = [...html.matchAll(new RegExp(`<span class="${variant.title}">([^<]*)</span>`, 'g'))].map((m) => m[1])
    const years = [...html.matchAll(new RegExp(`<span class="${variant.year}">([^<]*)</span>`, 'g'))].map((m) => m[1])
    expect(titles).toHaveLength(rows)
    expect(years).toHaveLength(rows)
    expect(titles.slice(0, 3)).toEqual(variant.firstTitles)
    expect(years.slice(0, 3)).toEqual(variant.firstYears)
  })
})

describe('playground · recursive-wrap（A3）· 默认值与守卫', () => {
  it('默认（无参数）：12 层、中文、语义类名，按顺序是专辑 1 到 12', async () => {
    const { status, html } = await fetchHtml('')
    expect(status).toBe(200)
    const tree = parseDivTree(html)
    expect(collect(tree, 'wrap')).toHaveLength(12)
    expect(collect(tree, 'album')).toHaveLength(12)
    expect(html.match(/专辑 \d+/g)).toEqual(Array.from({ length: 12 }, (_, index) => `专辑 ${index + 1}`))
    expect(html).toContain('<span class="title">专辑 1</span><span class="year">1998 年</span>')
    expect(html).toContain('<span class="title">专辑 2</span><span class="year">2001 年</span>')
    expect(html).toContain('<span class="title">专辑 12</span>')
  })

  it('最小与最大层数：albums=1 只有一层、没有嵌套；albums=30 有 30 层', async () => {
    const one = await fetchHtml('?albums=1')
    const oneWraps = collect(parseDivTree(one.html), 'wrap')
    expect(oneWraps).toHaveLength(1)
    expect(oneWraps[0].children.map((child) => child.cls)).toEqual(['album'])

    const max = await fetchHtml('?albums=30')
    expect(collect(parseDivTree(max.html), 'album')).toHaveLength(30)
  })

  it('参数越界时被夹到边界、非法或缺失时用默认 12（intParam 约定，不返回 404）', async () => {
    expect(collect(parseDivTree((await fetchHtml('?albums=0')).html), 'album')).toHaveLength(1)
    expect(collect(parseDivTree((await fetchHtml('?albums=99')).html), 'album')).toHaveLength(30)
    expect(collect(parseDivTree((await fetchHtml('?albums=abc')).html), 'album')).toHaveLength(12)
    expect(collect(parseDivTree((await fetchHtml('')).html), 'album')).toHaveLength(12)
  })

  it('lang 与 classes 非法时回落到中文与语义类名', async () => {
    const { status, html } = await fetchHtml('?albums=2&lang=fr&classes=xyz')
    expect(status).toBe(200)
    expect(html).toContain('<html lang="zh">')
    expect(html).toContain('<span class="title">专辑 1</span>')
    expect(collect(parseDivTree(html), 'album')).toHaveLength(2)
  })

  it('纯静态渲染：HTML 里没有脚本', async () => {
    const { html } = await fetchHtml('?albums=12')
    expect(html).not.toContain('<script')
  })

  it('生产环境返回 404', async () => {
    vi.stubEnv('NODE_ENV', 'production')
    const { status } = await fetchHtml('?albums=12')
    expect(status).toBe(404)
  })
})
