import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

import { NextRequest } from '../_lib/next-shim'
import {describe, expect, it, vi} from 'vitest'

import { GET as ariaValues } from '../aria-values/route'

const BASE = 'http://localhost:3008'
const PATH = '/dev-fixtures/playground/aria-values'
/** 仓库根下的 cases 目录：用于确认 C06-001 的 expected.json 与路由输出同步。 */
const CASES_URL = new URL('../../cases/', import.meta.url)

interface ExpectedFile {
  expectedRows: number
  rowMatch: { selector: string; textPrefix: string }
  trapVerifiedBy: string
  trapTest: string
}

function readExpected(id: string): ExpectedFile {
  return JSON.parse(readFileSync(fileURLToPath(new URL(`${id}/expected.json`, CASES_URL)), 'utf8')) as ExpectedFile
}

async function fetchPage(query: string): Promise<{ status: number; html: string }> {
  const response = await ariaValues(new NextRequest(`${BASE}${PATH}${query}`))
  return { status: response.status, html: await response.text() }
}

/** 每个人数块的 HTML 内部片段（svg 等），用来检查可见文本。 */
function guestBlockInners(html: string): string[] {
  return Array.from(html.matchAll(/<span class="guests"[^>]*>([\s\S]*?)<\/span>/g), (match) => match[1])
}

/** 去掉标签后的文本，等价于这里 innerText 能读到的内容（svg 没有文字节点）。 */
function visibleText(fragment: string): string {
  return fragment.replace(/<[^>]+>/g, '').trim()
}

function ariaLabels(html: string): string[] {
  return Array.from(html.matchAll(/class="guests"[^>]*aria-label="([^"]*)"/g), (match) => match[1])
}

function countRows(html: string): number {
  return (html.match(/<li class="item">/g) ?? []).length
}

describe('playground · aria-values（C6）', () => {
  it('无 query 时默认 12 行，每行标题「商品 n」按序排列', async () => {
    const { status, html } = await fetchPage('')
    expect(status).toBe(200)
    expect(countRows(html)).toBe(12)
    const titles = Array.from(html.matchAll(/<span class="title">([^<]*)<\/span>/g), (match) => match[1])
    expect(titles).toHaveLength(12)
    expect(titles[0]).toBe('商品 1')
    expect(titles[11]).toBe('商品 12')
  })

  it('人数块的可见文本为空（innerText 陷阱存在），数值只在 aria-label 上', async () => {
    const { html } = await fetchPage('?rows=12')
    const blocks = guestBlockInners(html)
    expect(blocks).toHaveLength(12)
    for (const inner of blocks) {
      expect(visibleText(inner)).toBe('')
      expect(inner).toContain('<svg')
    }
    expect(ariaLabels(html)).toHaveLength(12)
  })

  it('人数按行号循环取 1–4，aria-label 原文即 expectedColumns 的值（前三个为「1 位房客」起）', async () => {
    const { html } = await fetchPage('?rows=12')
    const labels = ariaLabels(html)
    expect(labels.slice(0, 3)).toEqual(['1 位房客', '2 位房客', '3 位房客'])
    expect(labels[3]).toBe('4 位房客')
    expect(labels[4]).toBe('1 位房客')
    expect(labels[11]).toBe('4 位房客')
    for (const label of labels) {
      expect(label).toMatch(/^[1-4] 位房客$/)
    }
  })

  it('rows 越界按 intParam 夹到 [1, 50]，非数字回落到默认 12', async () => {
    const high = await fetchPage('?rows=999')
    expect(high.status).toBe(200)
    expect(countRows(high.html)).toBe(50)

    const low = await fetchPage('?rows=0')
    expect(low.status).toBe(200)
    expect(countRows(low.html)).toBe(1)

    const garbage = await fetchPage('?rows=abc')
    expect(garbage.status).toBe(200)
    expect(countRows(garbage.html)).toBe(12)
  })

  it('陷阱：可见文本不含人数，aria-label 逐行含「n 位房客」', async () => {
    const { html } = await fetchPage('?rows=12')
    for (const inner of guestBlockInners(html)) {
      expect(visibleText(inner)).not.toMatch(/\d/)
    }
    const labels = ariaLabels(html)
    expect(labels).toHaveLength(12)
    labels.forEach((label, index) => {
      expect(label).toBe(`${(index % 4) + 1} 位房客`)
    })
  })

  it('生产环境返回 404（playgroundBlocked 是第一步）', async () => {
    vi.stubEnv('NODE_ENV', 'production')
    try {
      const { status } = await fetchPage('?rows=12')
      expect(status).toBe(404)
    } finally {
      vi.unstubAllEnvs()
    }
  })

  describe('C06-001 case 与路由输出同步', () => {
    const expected = readExpected('C06-001')

    it('rowMatch（ul.list > li.item，textPrefix「商品 」）静态计数等于 expectedRows', async () => {
      const { html } = await fetchPage('?rows=12')
      const rowTexts = Array.from(html.matchAll(/<li class="item">([\s\S]*?)<\/li>/g), (match) => visibleText(match[1]))
      expect(rowTexts.filter((text) => text.startsWith(expected.rowMatch.textPrefix))).toHaveLength(expected.expectedRows)
    })

    it('trapVerifiedBy 为 vitest，且 trapTest 指向本文件里真实存在的 it()', () => {
      expect(expected.trapVerifiedBy).toBe('vitest')
      const self = readFileSync(fileURLToPath(import.meta.url), 'utf8')
      expect(self).toContain(`it('${expected.trapTest}'`)
    })
  })
})
