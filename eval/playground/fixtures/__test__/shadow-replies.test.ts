import { NextRequest } from '../_lib/next-shim'
import { describe, expect, it } from 'vitest'

import { GET as shadowReplies } from '../shadow-replies/route'

const BASE = 'http://localhost:3008/dev-fixtures/playground/shadow-replies'

async function fetchPage(query: string): Promise<string> {
  const response = await shadowReplies(new NextRequest(`${BASE}?${query}`))
  expect(response.status).toBe(200)
  return response.text()
}

/** 页面脚本里的配置（评论串全部由脚本画进 shadow root，标记里没有一行评论）。 */
function configOf(html: string): { threads: number; perBatch: number; totalRows: number; replies: number[]; inline: number[]; pageSize: number } {
  const match = html.match(/const CFG = (\{.*\});/)
  if (!match) throw new Error('CFG not found')
  return JSON.parse(match[1])
}

describe('playground · shadow-replies（A6 嵌套变体：评论串是层层嵌套的组件）', () => {
  it('标记里只有评论区的宿主元素，评论全部由脚本画进 shadow root', async () => {
    const html = await fetchPage('threads=30')
    const markup = html.replace(/<script>[\s\S]*?<\/script>/g, '')
    expect(markup).toContain('<div id="commentapp"><thread-app></thread-app></div>')
    expect(markup).not.toContain('<thread-item')
    expect(html).toContain("attachShadow({ mode: 'open' })")
  })

  it('可采行数 = 主评论数 + 按 REPLY_PATTERN 循环的回复数', async () => {
    expect(configOf(await fetchPage('threads=30'))).toMatchObject({ threads: 30, perBatch: 10, totalRows: 177, pageSize: 10 })
    expect(configOf(await fetchPage('threads=10')).totalRows).toBe(59)
    expect(configOf(await fetchPage('threads=3&perBatch=2'))).toMatchObject({ threads: 3, perBatch: 2, totalRows: 11 })
  })

  it('内联条数不超过回复数；有的评论一条都不内联、有的超过一页', async () => {
    const { replies, inline, pageSize } = configOf(await fetchPage('threads=10'))
    expect(replies).toHaveLength(inline.length)
    replies.forEach((total, i) => expect(inline[i]).toBeLessThanOrEqual(total))
    expect(replies.some((total, i) => total > 0 && inline[i] === 0)).toBe(true)
    expect(replies.some(total => total > pageSize)).toBe(true)
  })

  it('旁边有一列比首批评论更长的推荐视频；页面平滑滚动', async () => {
    const html = await fetchPage('threads=30')
    expect((html.match(/<div class="video-card">/g) ?? []).length).toBe(40)
    expect(html).toContain('scroll-behavior: smooth')
  })

  it('非法参数回落到默认值', async () => {
    expect(configOf(await fetchPage('threads=abc&perBatch=0&lang=xx'))).toMatchObject({ threads: 30, perBatch: 1 })
    expect(await fetchPage('lang=en')).toContain('<html lang="en">')
  })
})
