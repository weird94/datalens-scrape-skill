import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

import { NextRequest } from '../_lib/next-shim'
import { describe, expect, it } from 'vitest'

import { GET as wrapperDrop } from '../wrapper-drop/[page]/route'

const BASE = 'http://localhost:3008'
const PATH = '/dev-fixtures/playground/wrapper-drop'
/** 仓库根下的 D5 case 目录：用于确认 case.json / expected.json 与路由输出同步。 */
const CASES_URL = new URL('../../cases/', import.meta.url)

async function fetchPage(query: string, page: number): Promise<{ status: number; html: string }> {
  const response = await wrapperDrop(new NextRequest(`${BASE}${PATH}/${page}?${query}`), {
    params: Promise.resolve({ page: String(page) }),
  })
  return { status: response.status, html: await response.text() }
}

function count(html: string, pattern: RegExp): number {
  return (html.match(pattern) ?? []).length
}

describe('playground · wrapper-drop（D5：翻页后外层包装消失）', () => {
  it('classed：第 1 页列表在 包装 > div.result-wrap > div.video-list 下，分页器也在包装里', async () => {
    const { status, html } = await fetchPage('pages=3&perPage=10&list=classed', 1)
    expect(status).toBe(200)
    expect(html).toContain(
      '<div class="search-page search-page-all"><div class="result-wrap">\n<div class="video-list row">\n<div class="item">'
    )
    expect(count(html, /<span class="title">视频 \d+<\/span>/g)).toBe(10)
    expect(html).toContain(
      `<div class="pager"><a class="next" href="${PATH}/2?pages=3&perPage=10&list=classed">下一页</a></div>\n</div></div>`
    )
  })

  it('bare：第 1 页行直接挂在包装里无 class 的 div 下', async () => {
    const { html } = await fetchPage('pages=3&perPage=10&list=bare', 1)
    expect(html).toContain('<div class="search-page search-page-all"><div>\n<div class="item">')
    expect(html).not.toContain('<main>')
  })

  it.each(['classed', 'bare'])('%s：第 2 页起没有包装，列表直接挂在 main 下', async shape => {
    const { html } = await fetchPage(`pages=3&perPage=10&list=${shape}`, 2)
    expect(html).not.toContain('search-page-all')
    expect(html).not.toContain('result-wrap')
    expect(html).toContain('<main>\n<div class="video-list row">\n<div class="item">')
    expect(count(html, /<span class="title">视频 (1[1-9]|20)<\/span>/g)).toBe(10)
  })

  it('末页给出到底信号：没有下一页链接，只有置灰按钮', async () => {
    const { html } = await fetchPage('pages=3&perPage=10&list=bare', 3)
    expect(html).not.toContain('<a class="next"')
    expect(html).toContain(
      '<button class="next" disabled aria-disabled="true">已是最后一页</button>'
    )
    expect(html).toContain('第 3 / 3 页')
  })

  it('每页侧栏都有一个同 class 的 3 行推荐块', async () => {
    for (const page of [1, 2]) {
      const { html } = await fetchPage('pages=3&perPage=10&list=classed', page)
      expect(html).toContain('<aside><div class="video-list row">')
      expect(count(html, /<span class="title">推荐 \d+<\/span>/g)).toBe(3)
    }
  })

  it('en + hash：文案和类名都换掉（留出集）', async () => {
    const { html } = await fetchPage('pages=3&perPage=10&list=bare&lang=en&classes=hash', 1)
    expect(html).toContain('<html lang="en">')
    expect(html).toContain('<div class="q3d9e1a q8b2c7f"><div>\n<div class="q7e2f0b">')
    expect(html).not.toContain('search-page')
    expect(count(html, /<span class="q2b8d5c">Video \d+<\/span>/g)).toBe(10)
  })

  it('越界页码返回 404', async () => {
    expect((await fetchPage('pages=3', 4)).status).toBe(404)
  })

  it.each(['D05-002', 'D05-003', 'D05-004'])('%s 的 case 文件与路由一致', async caseId => {
    const caseJson = JSON.parse(
      readFileSync(fileURLToPath(new URL(`${caseId}/case.json`, CASES_URL)), 'utf8')
    ) as { url: string; variant: { pages: number; perPage: number } }
    const expected = JSON.parse(
      readFileSync(fileURLToPath(new URL(`${caseId}/expected.json`, CASES_URL)), 'utf8')
    ) as { expectedRows: number; rowMatch: { textPrefix: string } }
    expect(caseJson.url.startsWith(`${PATH}/1?`)).toBe(true)
    expect(expected.expectedRows).toBe(caseJson.variant.pages * caseJson.variant.perPage)

    const query = caseJson.url.split('?')[1] ?? ''
    let rows = 0
    for (let page = 1; page <= caseJson.variant.pages; page += 1) {
      const { html } = await fetchPage(query, page)
      rows += count(html, new RegExp(`>${expected.rowMatch.textPrefix}\\d+<`, 'g'))
    }
    expect(rows).toBe(expected.expectedRows)
  })
})
