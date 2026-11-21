/**
 * @vitest-environment jsdom
 */
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { NextRequest } from '../_lib/next-shim'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { GET as cardHiddenFields } from '../card-hidden-fields/route'

const BASE = 'http://localhost:3008'
const PATH = '/dev-fixtures/playground/card-hidden-fields'
/**
 * 仓库根下的 B7 case 目录：用于确认 case.json / expected.json 与路由输出同步。
 * jsdom 环境里全局 URL 是 jsdom 的实现，Node 的 fileURLToPath 不认，所以这里只用字符串和 path。
 */
const CASES_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '../../cases')

interface MatchSpec {
  selector: string
  textPrefix: string
}

interface ExpectedFile {
  expectedRows: number
  expectedColumns: Record<string, string[]>
  rowMatch: MatchSpec
  naive: { strategy: string; rowMatch: MatchSpec; expectedRows: number }
  trapVerifiedBy: string
}

interface CaseFile {
  url: string
  pattern: string[]
  heldOut: boolean
}

async function load(query = ''): Promise<number> {
  const response = await cardHiddenFields(new NextRequest(`${BASE}${PATH}${query}`))
  const html = await response.text()
  if (response.status === 200) {
    document.body.innerHTML = html.slice(html.indexOf('<body>') + '<body>'.length, html.indexOf('</body>'))
  }
  return response.status
}

afterEach(() => {
  document.body.innerHTML = ''
})

/** 与 playground-oracle 的 countRows 同口径：命中选择器、textContent.trim() 以 textPrefix 开头。 */
function countByMatch(match: MatchSpec): number {
  return Array.from(document.querySelectorAll(match.selector)).filter(element =>
    (element.textContent ?? '').trim().startsWith(match.textPrefix)
  ).length
}

function listOf(listId: string): HTMLElement {
  const list = document.getElementById(listId)
  if (!list) {
    throw new Error(`#${listId} not found`)
  }
  return list
}

function readCaseFile<T>(id: string, file: 'case.json' | 'expected.json'): T {
  return JSON.parse(readFileSync(resolve(CASES_DIR, id, file), 'utf8')) as T
}

describe('playground · card-hidden-fields（B7）', () => {
  it('默认 5 张卡；容器的直接子节点是「卡片 + 隐藏 input + 预约面板」逐张交错', async () => {
    expect(await load()).toBe(200)
    const list = listOf('member-list')
    const children = Array.from(list.children)

    expect(list.querySelectorAll(':scope > div.person')).toHaveLength(5)
    expect(children).toHaveLength(5 * (1 + 17 + 1))
    // 每张卡后面紧跟它自己的隐藏 input，再跟预约面板
    expect(children[0].matches('div.person')).toBe(true)
    expect(children.slice(1, 18).every(child => child.tagName === 'INPUT' && child.getAttribute('type') === 'hidden')).toBe(true)
    expect(children[18].matches('div.booking-panel.hidden')).toBe(true)
    expect(children[19].matches('div.person')).toBe(true)
  })

  it('每张卡有互不相同、不连续的实例 id；卡内分两半，两半共有同一个类名', async () => {
    await load('?cards=5')
    const cards = Array.from(document.querySelectorAll('div.person'))
    const ids = cards.map(card => card.id)

    expect(ids.every(id => /^person-\d+$/.test(id))).toBe(true)
    expect(new Set(ids).size).toBe(5)
    for (const card of cards) {
      const halves = card.querySelectorAll(':scope > div.person-body > div.rel')
      expect(halves).toHaveLength(2)
    }
    expect(document.querySelectorAll('div.rel')).toHaveLength(10)
  })

  it('无 name 的隐藏 input：每张卡 bare 个；其余带 name，同一个 name 跨卡只出现 cards 次', async () => {
    await load('?cards=5&hidden=17&bare=4')
    const inputs = Array.from(listOf('member-list').querySelectorAll(':scope > input'))

    expect(inputs).toHaveLength(85)
    expect(inputs.filter(input => !input.hasAttribute('name'))).toHaveLength(20)
    const named = inputs.filter(input => input.hasAttribute('name')).map(input => input.getAttribute('name'))
    const counts = new Map<string | null, number>()
    for (const name of named) counts.set(name, (counts.get(name) ?? 0) + 1)
    expect(new Set(counts.values())).toEqual(new Set([5]))
  })

  it('bare 不超过 hidden；hidden=0 时卡片后面直接是预约面板', async () => {
    await load('?cards=2&hidden=3&bare=9')
    expect(listOf('member-list').querySelectorAll(':scope > input:not([name])')).toHaveLength(6)

    await load('?cards=2&hidden=0')
    expect(listOf('member-list').querySelectorAll(':scope > input')).toHaveLength(0)
    expect(listOf('member-list').children).toHaveLength(4)
  })

  it('cards 夹到 [1, 30]、hidden 夹到 [0, 40]，缺失或非法值回落到默认', async () => {
    await load('?cards=0')
    expect(document.querySelectorAll('div.person')).toHaveLength(1)
    await load('?cards=500')
    expect(document.querySelectorAll('div.person')).toHaveLength(30)
    await load('?cards=abc')
    expect(document.querySelectorAll('div.person')).toHaveLength(5)
    await load('?cards=1&hidden=999&bare=999')
    expect(listOf('member-list').querySelectorAll(':scope > input')).toHaveLength(40)
    expect(listOf('member-list').querySelectorAll(':scope > input:not([name])')).toHaveLength(40)
  })

  it('lang=en 与 classes=hash：文案换成英文、类名全换成无语义短串，结构不变', async () => {
    await load('?cards=3&hidden=8&bare=2&lang=en&classes=hash')

    expect(document.querySelector('div.person')).toBeNull()
    expect(document.querySelector('#member-list')).toBeNull()
    expect(document.querySelectorAll('div.k7q')).toHaveLength(3)
    expect(document.querySelectorAll('div.r9x')).toHaveLength(6)
    expect(Array.from(document.querySelectorAll('h3')).map(h3 => h3.textContent)).toEqual(['Member 1', 'Member 2', 'Member 3'])
    expect(listOf('y6l').children).toHaveLength(3 * (1 + 8 + 1))
  })

  it('每张卡的文字互不相同', async () => {
    await load('?cards=30')
    const texts = Array.from(document.querySelectorAll('div.person')).map(card => (card.textContent ?? '').trim())
    expect(new Set(texts).size).toBe(30)
  })

  it('生产环境直接 404', async () => {
    vi.stubEnv('NODE_ENV', 'production')
    try {
      expect(await load()).toBe(404)
    } finally {
      vi.unstubAllEnvs()
    }
  })

  describe.each(['B07-001', 'B07-002'])('case %s 与路由输出同步', id => {
    const caseFile = readCaseFile<CaseFile>(id, 'case.json')
    const expected = readCaseFile<ExpectedFile>(id, 'expected.json')

    it('case.url 指向本路由，pattern 是 B7', () => {
      expect(new URL(caseFile.url, BASE).pathname).toBe(PATH)
      expect(caseFile.pattern).toEqual(['B7'])
    })

    it('oracle 的 rowMatch 数出 expectedRows 张卡，姓名前三个值与 expectedColumns 一致', async () => {
      await load(new URL(caseFile.url, BASE).search)
      expect(countByMatch(expected.rowMatch)).toBe(expected.expectedRows)
      const names = Array.from(document.querySelectorAll('h3')).map(h3 => h3.textContent)
      expect(names.slice(0, 3)).toEqual(Object.values(expected.expectedColumns)[0])
    })

    it('naive 的 rowMatch 数出陷阱数字（卡内的两半被当成行，cards × 2）', async () => {
      await load(new URL(caseFile.url, BASE).search)
      expect(expected.trapVerifiedBy).toBe('naive')
      expect(countByMatch(expected.naive.rowMatch)).toBe(expected.naive.expectedRows)
      expect(expected.naive.expectedRows).toBe(expected.expectedRows * 2)
    })
  })

  it('B07-002 是 held-out：换了语言、类名、卡片数和隐藏字段个数', () => {
    const main = readCaseFile<CaseFile>('B07-001', 'case.json')
    const heldOut = readCaseFile<CaseFile>('B07-002', 'case.json')
    expect(main.heldOut).toBe(false)
    expect(heldOut.heldOut).toBe(true)
    expect(new URL(heldOut.url, BASE).searchParams.get('classes')).toBe('hash')
    expect(new URL(heldOut.url, BASE).searchParams.get('lang')).toBe('en')
  })
})
