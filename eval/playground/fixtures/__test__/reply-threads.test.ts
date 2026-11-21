import { NextRequest } from '../_lib/next-shim'
import { describe, expect, it } from 'vitest'

import { GET as replyThreads } from '../reply-threads/route'

const BASE = 'http://localhost:3008/dev-fixtures/playground/reply-threads'

async function fetchPage(query: string): Promise<string> {
  const response = await replyThreads(new NextRequest(`${BASE}?${query}`))
  expect(response.status).toBe(200)
  return response.text()
}

function count(html: string, pattern: RegExp): number {
  return (html.match(pattern) ?? []).length
}

function markupOf(html: string): string {
  return html.replace(/<script>[\s\S]*?<\/script>/g, '')
}

describe('playground · reply-threads（D15：点击处理挂在按钮里的标签上）', () => {
  it('首屏只有主评论，带回复的评论下各有一个「展开N条回复」，页头总数含回复', async () => {
    const html = markupOf(await fetchPage('comments=10'))
    expect(count(html, /<div class="comment-item" data-id="c\d+">/g)).toBe(10)
    expect(count(html, /<button type="button" class="reply-expand">/g)).toBe(6)
    expect(html).toContain('<span>展开25条回复</span>')
    expect(html).toContain('<p class="count">共 58 条评论</p>')
  })

  it('按钮本身没有处理：只认事件路径上的 label', async () => {
    const html = await fetchPage('comments=10')
    expect(html).toContain('<button type="button" class="reply-expand"><i></i><div class="label"><span>展开3条回复</span>')
    expect(html).toContain("const label = event.target.closest('.' + N.label);")
    expect(html).toContain('if (!label) return;')
    expect(html).not.toContain('onclick')
  })

  it('回复与主评论同 class；「收起」与「展开更多」共用基础 class', async () => {
    const html = await fetchPage('comments=10')
    expect(html).toContain('<div class=\\"comment-item\\"><div><span class=\\"author\\">用户 8-25</span>')
    expect(html).toContain('<button type=\\"button\\" class=\\"reply-more collapse\\"><i></i><div class=\\"label\\"><span>收起</span>')
    expect(html).toContain('<button type=\\"button\\" class=\\"reply-more\\"><i></i><div class=\\"label\\"><span>展开更多</span>')
  })

  it('en + hash：文案和类名都换掉（留出集），总数 54', async () => {
    const html = await fetchPage('comments=8&lang=en&classes=hash')
    expect(html).toContain('<html lang="en">')
    expect(html).toContain('<span>View 25 replies</span>')
    expect(html).toContain('<p class="count">54 comments</p>')
    expect(html).not.toContain('comment-item')
    expect(count(markupOf(html), /<div class="x7c2a1" data-id="c\d+">/g)).toBe(8)
  })
})
