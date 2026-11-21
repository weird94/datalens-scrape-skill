/**
 * @vitest-environment jsdom
 */
import { readFileSync } from 'node:fs'
import path from 'node:path'

import { NextRequest } from '../_lib/next-shim'
import { afterEach, describe, expect, it } from 'vitest'

import { perkSlotsFor } from '../optional-perk-slots/perk-slots'
import { GET as optionalPerkSlots } from '../optional-perk-slots/route'

const PATH = 'http://localhost:3008/dev-fixtures/playground/optional-perk-slots'
/** 仓库根下的 case 目录：用于确认 case.json / expected.json 与路由输出同步（jsdom 环境下 import.meta.url 不是 file:，用 __dirname）。 */
const CASES_DIR = path.join(__dirname, '../../cases')

async function mount(query: string): Promise<HTMLElement[]> {
  const html = await (await optionalPerkSlots(new NextRequest(`${PATH}${query}`))).text()
  document.body.innerHTML = html.slice(html.indexOf('<body>') + '<body>'.length, html.indexOf('</body>'))
  return Array.from(document.querySelectorAll<HTMLElement>('[role="listitem"]'))
}

function text(element: Element | null | undefined): string {
  return element?.textContent?.replace(/\s+/g, ' ').trim() ?? ''
}

afterEach(() => {
  document.body.innerHTML = ''
})

describe('playground mock optional-perk-slots（pattern C12）', () => {
  it('卡片数、每张卡的条目序列与 perkSlotsFor 一致', async () => {
    const cards = await mount('?rows=12')
    expect(cards).toHaveLength(12)
    cards.forEach((card, index) => {
      const slots = perkSlotsFor(index + 1)
      const perks = card.querySelectorAll('ul.perks > li.perk')
      expect(perks.length).toBe(1 + Number(slots.meal) + Number(slots.refund) + Number(slots.payLater) + Number(slots.scarcity))
    })
  })

  it('两种政策条目结构完全相同，只有图标标记不同（testid / class 两种变体）', async () => {
    for (const [query, refundMarker, payLaterMarker] of [
      ['?rows=12', '[data-testid="refund-policy-icon"]', '[data-testid="paylater-policy-icon"]'],
      ['?rows=12&classes=hash&marker=class', '.f6d', '.s7a'],
    ] as const) {
      await mount(query)
      const refund = document.querySelector(`li:has(${refundMarker})`)
      const payLater = document.querySelector(`li:has(${payLaterMarker})`)
      const shape = (element: Element | null) =>
        Array.from(element?.querySelectorAll('*') ?? [], node => node.tagName).join(',')
      expect(refund).not.toBeNull()
      expect(shape(refund)).toBe(shape(payLater))
      expect(refund?.className).toBe(payLater?.className)
    }
  })

  it('陷阱存在：按位置取「免费取消」会读到「无需预付」，按位置取「仅剩」会漏', async () => {
    const cards = await mount('?rows=12')
    const positional = (card: Element, position: number) =>
      text(card.querySelector(`li.perk:nth-of-type(${position}) strong`))
    // 第 4 张卡没有「含早餐」：免费取消前移到第 2 位，第 3 位是「无需预付」。
    // （不写成 `ul.perks > li…` 的元素作用域形式：jsdom 的选择器引擎在那种写法上返回空。）
    expect(perkSlotsFor(4)).toMatchObject({ meal: false, refund: true, payLater: true })
    expect(positional(cards[3]!, 3)).toBe('无需预付')
    // 按标记取则逐行正确
    cards.forEach((card, index) => {
      const value = text(card.querySelector('li.perk:has([data-testid="refund-policy-icon"]) strong'))
      expect(value).toBe(perkSlotsFor(index + 1).refund ? '免费取消' : '')
    })
    const scarcityAt5 = cards.filter(card => text(card.querySelector('li.perk:nth-of-type(5) .scarcity'))).length
    const scarcityTotal = cards.filter(card => card.querySelector('.scarcity')).length
    expect(scarcityAt5).toBeLessThan(scarcityTotal)
  })

  it('case.json / expected.json 与路由一致', async () => {
    for (const id of ['C12-001', 'C12-002']) {
      const caseJson = JSON.parse(readFileSync(path.join(CASES_DIR, id, 'case.json'), 'utf8'))
      const expected = JSON.parse(readFileSync(path.join(CASES_DIR, id, 'expected.json'), 'utf8'))
      const cards = await mount(caseJson.url.slice(caseJson.url.indexOf('?')))
      expect(cards).toHaveLength(expected.expectedRows)
      expect(caseJson.pattern).toEqual(['C12'])
    }
  })
})
