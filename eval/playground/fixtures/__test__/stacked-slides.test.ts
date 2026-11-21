import { NextRequest } from '../_lib/next-shim'
import { describe, expect, it } from 'vitest'

import { GET as stackedSlides } from '../stacked-slides/route'

const BASE = 'http://localhost:3008/dev-fixtures/playground/stacked-slides'

async function fetchPage(query: string): Promise<string> {
  const response = await stackedSlides(new NextRequest(`${BASE}?${query}`))
  expect(response.status).toBe(200)
  return response.text()
}

function count(html: string, pattern: RegExp): number {
  return (html.match(pattern) ?? []).length
}

describe('playground · stacked-slides（D14：同一个按钮各有一份，只有屏幕上那份是对的）', () => {
  it('推荐流的卡片和每个 slide 都有同 class 的评论按钮，推荐卡排在文档最前', async () => {
    const html = await fetchPage('slides=5&current=3&comments=12')
    expect(count(html, /<button class="comment-btn" type="button">/g)).toBe(12 + 5)
    expect(html.indexOf('class="card"')).toBeLessThan(html.indexOf('class="slide"'))
  })

  it('只有当前视频的评论数是 query 给的数，其余 slide 显示别的数', async () => {
    const html = await fetchPage('slides=5&current=3&comments=12')
    expect(html).toContain('<h2>视频 3：今天聊聊第 3 个话题</h2><button class="comment-btn" type="button">💬 12</button>')
    expect(html).toContain('<h2>视频 1：今天聊聊第 1 个话题</h2><button class="comment-btn" type="button">💬 1379</button>')
  })

  it('评论面板初始为空、隐藏，由脚本在点当前 slide 的按钮后填充', async () => {
    const html = await fetchPage('slides=5&current=3&comments=12')
    expect(html).toContain('<aside class="comments" hidden></aside>')
    expect(html).toContain('if (index === current) openComments();')
    expect(html).toContain('const TITLES = ["共 1379 条评论","共 1758 条评论","共 12 条评论"')
  })

  it('current 被夹到 slides 范围内', async () => {
    const html = await fetchPage('slides=3&current=9')
    expect(html).toContain('let current = 2;')
  })

  it('en + hash：文案和类名都换掉（留出集）', async () => {
    const html = await fetchPage('slides=4&current=2&comments=9&lang=en&classes=hash')
    expect(html).toContain('<html lang="en">')
    expect(html).toContain('💬 9</button>')
    expect(html).not.toContain('comment-btn')
    expect(count(html, /<button class="h6d1c3" type="button">/g)).toBe(12 + 4)
  })
})
