import { NextRequest } from '../_lib/next-shim'
import { describe, expect, it } from 'vitest'

import { GET as shadowThread } from '../shadow-thread/route'

const BASE = 'http://localhost:3008/dev-fixtures/playground/shadow-thread'

async function fetchPage(query: string): Promise<string> {
  const response = await shadowThread(new NextRequest(`${BASE}?${query}`))
  expect(response.status).toBe(200)
  return response.text()
}

function count(html: string, pattern: RegExp): number {
  return (html.match(pattern) ?? []).length
}

/** 去掉声明式 shadow root（<template shadowrootmode> 整段）和脚本，剩下的就是 light DOM 能读到的文字。 */
function lightDom(html: string): string {
  return html.replace(/<template shadowrootmode="open">[\s\S]*?<\/template>/g, '').replace(/<script>[\s\S]*?<\/script>/g, '')
}

describe('playground · shadow-thread（A6：内容在 Web Component 的 shadow root 里）', () => {
  it('首批卡片用声明式 shadow root 输出：作者、时间、赞数在 shadow 里，正文是投进 slot 的 light DOM', async () => {
    const html = await fetchPage('total=30&perBatch=10')
    expect(count(html, /<comment-card data-id="c\d+"><template shadowrootmode="open">/g)).toBe(10)
    expect(count(html, /<span class="author">用户 \d+<\/span>/g)).toBe(10)
    expect(count(html, /<p slot="body">评论 \d+：/g)).toBe(10)
  })

  it('陷阱：只读 light DOM 时看不到作者、总数和加载更多按钮，只看得到正文', async () => {
    const light = lightDom(await fetchPage('total=30&perBatch=10'))
    expect(light).not.toContain('用户 1<')
    expect(light).not.toContain('共 30 条评论')
    expect(light).not.toContain('加载更多评论')
    expect(count(light, /<p slot="body">评论 \d+：/g)).toBe(10)
  })

  it('后续两批交给脚本，加载完后 load-more 标记 done、换成到底文案', async () => {
    const html = await fetchPage('total=30&perBatch=10')
    expect(html).toContain('<load-more state="more">')
    const batches = JSON.parse(html.match(/const BATCHES = (.*);/)?.[1] ?? '[]') as { id: string; body: string }[][]
    expect(batches.map(batch => batch.length)).toEqual([10, 10])
    expect(batches[1][9]).toMatchObject({ id: 'c30', body: '评论 30：这是第 30 条评论的正文。' })
    expect(html).toContain("more.setAttribute('state', 'done')")
    expect(html).toContain('没有更多评论了')
  })

  it('一批就装得下时直接是 done，没有按钮', async () => {
    const html = await fetchPage('total=8&perBatch=10')
    expect(html).toContain('<load-more state="done">')
    expect(lightDom(html)).not.toContain('button')
    expect(html).not.toContain('<button class="more"')
  })

  it('en：文案换成英文（留出集）', async () => {
    const html = await fetchPage('total=12&perBatch=5&lang=en')
    expect(html).toContain('<html lang="en">')
    expect(html).toContain('<span class="count">12 comments</span>')
    expect(count(html, /<span class="author">user_\d+<\/span>/g)).toBe(5)
  })
})
