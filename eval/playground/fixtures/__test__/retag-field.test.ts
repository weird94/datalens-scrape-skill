import { NextRequest } from '../_lib/next-shim'
import { describe, expect, it } from 'vitest'

import { GET as retagField } from '../retag-field/[page]/route'

const BASE = 'http://localhost:3008'
const PATH = '/dev-fixtures/playground/retag-field'

async function fetchPage(query: string, page: number): Promise<{ status: number; html: string }> {
  const response = await retagField(new NextRequest(`${BASE}${PATH}/${page}?${query}`), {
    params: Promise.resolve({ page: String(page) }),
  })
  return { status: response.status, html: await response.text() }
}

function count(html: string, pattern: RegExp): number {
  return (html.match(pattern) ?? []).length
}

describe('playground · retag-field（C11：翻页后字段换了标签、class 不变）', () => {
  it('第 1 页姓名是带 href 的 a.advisor-name', async () => {
    const { status, html } = await fetchPage('pages=3&perPage=10', 1)
    expect(status).toBe(200)
    expect(count(html, /<a class="advisor-name" href="[^"]+">顾问 \d+<\/a>/g)).toBe(10)
    expect(html).not.toContain('<div class="advisor-name">')
    expect(html).toContain(`<a class="next" href="${PATH}/2?pages=3&perPage=10">下一页</a>`)
  })

  it('第 2 页起姓名是同 class 的 div，没有链接，其余字段不变', async () => {
    const { html } = await fetchPage('pages=3&perPage=10', 2)
    expect(count(html, /<div class="advisor-name">顾问 (1[1-9]|20)<\/div>/g)).toBe(10)
    expect(html).not.toContain('<a class="advisor-name"')
    expect(count(html, /<div class="advisor-office">门店 \d<\/div>/g)).toBe(10)
  })

  it('末页给出到底信号：没有下一页链接，只有置灰按钮', async () => {
    const { html } = await fetchPage('pages=3&perPage=10', 3)
    expect(html).not.toContain('<a class="next"')
    expect(html).toContain('<button class="next" disabled aria-disabled="true">已是最后一页</button>')
    expect(html).toContain('第 3 / 3 页')
  })

  it('en + hash：文案和类名都换掉（留出集）', async () => {
    const { html } = await fetchPage('pages=3&perPage=10&lang=en&classes=hash', 2)
    expect(html).toContain('<html lang="en">')
    expect(count(html, /<div class="r4a9c6e">Advisor \d+<\/div>/g)).toBe(10)
    expect(html).not.toContain('advisor-')
  })

  it('越界页码返回 404', async () => {
    expect((await fetchPage('pages=3', 4)).status).toBe(404)
  })
})
