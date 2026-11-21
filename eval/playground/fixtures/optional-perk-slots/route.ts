import { NextRequest, NextResponse } from '../_lib/next-shim'

import { htmlResponse, intParam, playgroundBlocked, renderShell } from '../_lib/shell'

import { perkSlotsFor, roomsLeftFor } from './perk-slots'

/**
 * 演练场 · 卡片里一串同 class 的可选条目，按位置取列会错位（pattern C12）。
 *
 * 每张住宿卡片里有一个条目列表（ul），所有条目都是同一个组件（同标签、同 class 的 li），依次是：
 * 1. 房型（每张都有）
 * 2. 含早餐（可选）
 * 3. 免费取消（可选）
 * 4. 无需预付（可选）——和「免费取消」结构完全相同（图标 + 加粗文字），只有图标上的标记不同
 * 5. 仅剩 N 间（可选）——自己独有一个子节点 class
 *
 * 陷阱：条目同 class，选择器只能靠位置区分，位置随前面可选条目的有无而移动。
 * `li:nth-of-type(3)` 在没有「含早餐」的卡片上读到「无需预付」（写进取消政策列），
 * `li:nth-of-type(5)` 在缺任何一个前置条目的卡片上读不到「仅剩 N 间」。
 * 正确做法：按条目自己携带的标记定位（图标的 data-testid / 独有的子节点 class），与位置无关。
 * 形状来自 2026-11-07 一位用户在某酒店搜索结果页的采集（取消政策列 46 格里 4 格错写成预付、
 * 剩余房量 39 条只采到 28 条）；类名、文案、属性都不是那个站的。
 *
 * query：
 * - rows：卡片数（默认 12，4–40）
 * - lang：zh | en（默认 zh）
 * - classes：semantic | hash（默认 semantic；hash 时所有类名换成无语义的短串）
 * - marker：testid | class（默认 testid：两种政策图标靠 data-testid 区分；class 时靠图标上各自的 class 区分）
 *
 * 条目有无（行号 n 从 1 起）：含早餐在 n % 4 === 0 时缺；免费取消在 n % 5 === 0 时缺；
 * 无需预付在 n % 3 === 0 时缺；仅剩 N 间只在 n 为奇数时有。
 */

interface ClassNames {
  list: string
  card: string
  name: string
  score: string
  perks: string
  perk: string
  room: string
  roomText: string
  meal: string
  policyRow: string
  icon: string
  policyBody: string
  policyText: string
  scarcity: string
  price: string
  refundIcon: string
  payLaterIcon: string
}

const SEMANTIC: ClassNames = {
  list: 'stay-results',
  card: 'stay',
  name: 'stay-name',
  score: 'stay-score',
  perks: 'perks',
  perk: 'perk',
  room: 'room',
  roomText: 'room-text',
  meal: 'meal',
  policyRow: 'policy-row',
  icon: 'perk-icon',
  policyBody: 'policy-body',
  policyText: 'policy-text',
  scarcity: 'scarcity',
  price: 'stay-price',
  refundIcon: 'icon-refund',
  payLaterIcon: 'icon-paylater',
}

const HASHED: ClassNames = {
  list: 'q1w',
  card: 'e2r',
  name: 't3y',
  score: 'u4i',
  perks: 'o5p',
  perk: 'a6s',
  room: 'd7f',
  roomText: 'g8h',
  meal: 'j9k',
  policyRow: 'l0z',
  icon: 'x1c',
  policyBody: 'v2b',
  policyText: 'n3m',
  scarcity: 'k4j',
  price: 'h5g',
  refundIcon: 'f6d',
  payLaterIcon: 's7a',
}

interface Copy {
  title: string
  rooms: readonly string[]
  meal: string
  refund: string
  payLater: string
  payLaterTail: string
  scarcity: (left: number) => string
  name: (index: number) => string
  price: (index: number) => string
}

const COPY: Record<'zh' | 'en', Copy> = {
  zh: {
    title: '住宿搜索结果',
    rooms: ['大床房', '双床房', '家庭套房', '整套公寓'],
    meal: '含早餐',
    refund: '免费取消',
    payLater: '无需预付',
    payLaterTail: '– 到店付款',
    scarcity: left => `仅剩 ${left} 间`,
    name: index => `住宿 ${index}`,
    price: index => `¥${300 + index * 7}`,
  },
  en: {
    title: 'Stay results',
    rooms: ['King room', 'Twin room', 'Family suite', 'Entire apartment'],
    meal: 'Breakfast included',
    refund: 'Free cancellation',
    payLater: 'No prepayment needed',
    payLaterTail: '– pay at the property',
    scarcity: left => `Only ${left} left at this price`,
    name: index => `Stay ${index}`,
    price: index => `US$${40 + index * 3}`,
  },
}

const ICON_SVG = '<svg width="12" height="12" viewBox="0 0 12 12"><circle cx="6" cy="6" r="5"></circle></svg>'

function policyIcon(c: ClassNames, kind: 'refund' | 'payLater', marker: 'testid' | 'class'): string {
  const markerClass = kind === 'refund' ? c.refundIcon : c.payLaterIcon
  const attrs =
    marker === 'testid'
      ? `class="${c.icon}" data-testid="${kind === 'refund' ? 'refund-policy-icon' : 'paylater-policy-icon'}"`
      : `class="${c.icon} ${markerClass}"`
  return `<span ${attrs} aria-hidden="true">${ICON_SVG}</span>`
}

function policyPerk(c: ClassNames, kind: 'refund' | 'payLater', marker: 'testid' | 'class', copy: Copy): string {
  const strong = `<strong>${kind === 'refund' ? copy.refund : copy.payLater}</strong>`
  const text = kind === 'refund' ? strong : `${strong} ${copy.payLaterTail}`
  return (
    `<li class="${c.perk}"><div class="${c.policyRow}"><div>${policyIcon(c, kind, marker)}</div>` +
    `<div class="${c.policyBody}"><div class="${c.policyText}">${text}</div></div></div></li>`
  )
}

function cardHtml(n: number, c: ClassNames, copy: Copy, marker: 'testid' | 'class'): string {
  const slots = perkSlotsFor(n)
  const perks = [
    `<li class="${c.perk}"><div class="${c.room}"><div class="${c.roomText}">${copy.rooms[n % copy.rooms.length]}</div></div></li>`,
    slots.meal ? `<li class="${c.perk}"><span class="${c.meal}">${copy.meal}</span></li>` : '',
    slots.refund ? policyPerk(c, 'refund', marker, copy) : '',
    slots.payLater ? policyPerk(c, 'payLater', marker, copy) : '',
    slots.scarcity ? `<li class="${c.perk}"><div><div class="${c.scarcity}">${copy.scarcity(roomsLeftFor(n))}</div></div></li>` : '',
  ].join('')
  const href = `/dev-fixtures/playground/optional-perk-slots?stay=${n}`
  return (
    `<div class="${c.card}" role="listitem">` +
    `<a href="${href}"><h3 class="${c.name}">${copy.name(n)}</h3></a>` +
    `<div class="${c.score}">${(7 + (n % 30) / 10).toFixed(1)}</div>` +
    `<ul class="${c.perks}">${perks}</ul>` +
    `<div class="${c.price}">${copy.price(n)}</div>` +
    `</div>`
  )
}

function styleFor(c: ClassNames): string {
  return `
.${c.card} { border: 1px solid #ddd; border-radius: 4px; padding: 8px 12px; margin-bottom: 8px; }
.${c.name} { margin: 0; font-size: 16px; }
.${c.perks} li { font-size: 12px; color: #555; }
.${c.policyRow} { display: flex; gap: 4px; align-items: center; }
.${c.scarcity} { color: #b00; }
`
}

export async function GET(request: NextRequest): Promise<NextResponse> {
  const blocked = playgroundBlocked()
  if (blocked) return blocked

  const params = request.nextUrl.searchParams
  const rows = intParam(params.get('rows'), 12, 4, 40)
  const copy = params.get('lang') === 'en' ? COPY.en : COPY.zh
  const c = params.get('classes') === 'hash' ? HASHED : SEMANTIC
  const marker = params.get('marker') === 'class' ? 'class' : 'testid'

  const items = Array.from({ length: rows }, (_, offset) => cardHtml(offset + 1, c, copy, marker)).join('')
  const body = `<h1>${copy.title}</h1>
<div class="${c.list}" role="list">${items}</div>`

  return htmlResponse(renderShell(copy.title, body, { style: styleFor(c) }))
}
