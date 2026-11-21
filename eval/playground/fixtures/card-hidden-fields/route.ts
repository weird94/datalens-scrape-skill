import { NextRequest, NextResponse } from '../_lib/next-shim'

import { htmlResponse, intParam, playgroundBlocked, renderShell } from '../_lib/shell'

/**
 * 演练场 · 卡片之间夹着大量隐藏字段，真正的卡片列表进不了候选（pattern B7）。
 *
 * 页面是一个目录容器（#member-list）：每个成员一张卡（div.person，带实例专属 id），卡里分两半
 * （div.rel：照片 + 分部标签；div.rel：姓名 / 职位 / 资质 / 预约按钮）。容器的直接子节点却不是
 * 一张卡紧挨着一张卡，而是每张卡后面跟着一排隐藏表单字段（input[type=hidden]）和一个隐藏的预约面板。
 *
 * 修复前的机理（已于 2026-11-06 在 packages/core/src/utils/children.ts 的 isBlankElement 修好：input[type=hidden] 不再算内容；
 * 下面是它被 packages/core/src/detect-tables.ts 的 findPerClassList 放大的过程）：容器的子节点按「标签 + class，其次 data-testid / role / name」分组，
 * 只取最大的一组；没有 name 的隐藏 input 全部落进同一组（`input|||`），个数超过卡片数时它成了最大组，
 * 而它的成员没有子节点、判为无效，直接返回 null，不会再去看第二大的卡片那一组。
 * 结果：核心检测只会把「卡片内部那两半」（同 class、兄弟）当成列表候选，每张卡一个、根节点锚在该卡自己的 id 上；
 * 真正的卡片列表（容器下 N 张卡）不出现在候选里。朴素地按 div.rel 计数得 cards × 2。
 * 形状来自 2026-10-30 一位用户在某医院医生目录页的采集（3 次都只采到 1 行，见
 * docs/card-hidden-fields-root-cause-2026-11-06.md）；类名、文案、属性都不是那个站的。
 *
 * query：
 * - cards：成员数（默认 5，1–30）
 * - hidden：每张卡后面的隐藏 input 个数（默认 17，0–40）
 * - bare：其中不带 name 属性的个数（默认 4，不超过 hidden）；修复前 bare × cards 超过 cards（即 bare ≥ 2）时陷阱成立
 * - lang：zh | en（默认 zh）
 * - classes：semantic | hash（默认 semantic；hash 时所有类名换成无语义的短串）
 */

interface ClassNames {
  list: string
  person: string
  body: string
  rel: string
  photo: string
  text: string
  tag: string
  nameLink: string
  name: string
  role: string
  creds: string
  credsLabel: string
  credsText: string
  hidden: string
  panel: string
}

const SEMANTIC: ClassNames = {
  list: 'member-list',
  person: 'person',
  body: 'person-body',
  rel: 'rel',
  photo: 'photo-part',
  text: 'text-part',
  tag: 'site-tag',
  nameLink: 'name-link',
  name: 'name',
  role: 'role',
  creds: 'creds',
  credsLabel: 'creds-label',
  credsText: 'creds-text',
  hidden: 'hidden',
  panel: 'booking-panel',
}

const HASHED: ClassNames = {
  list: 'y6l',
  person: 'k7q',
  body: 'm2z',
  rel: 'r9x',
  photo: 'p1a',
  text: 't4b',
  tag: 's8c',
  nameLink: 'n3d',
  name: 'h5e',
  role: 'l6f',
  creds: 'c0g',
  credsLabel: 'u2h',
  credsText: 'v7i',
  hidden: 'w4j',
  panel: 'x1k',
}

interface Copy {
  title: string
  site: string
  role: string
  credsLabel: string
  book: string
  panel: string
  phone: string
  name: (index: number) => string
}

const COPY: Record<'zh' | 'en', Copy> = {
  zh: {
    title: '成员目录',
    site: '一号院区',
    role: '资深顾问',
    credsLabel: '资质',
    book: '预约',
    panel: '预约面板',
    phone: '手机号',
    name: index => `成员 ${index}`,
  },
  en: {
    title: 'Member directory',
    site: 'Campus A',
    role: 'Senior consultant',
    credsLabel: 'credentials',
    book: 'Book',
    panel: 'Booking panel',
    phone: 'Phone',
    name: index => `Member ${index}`,
  },
}

/** 隐藏字段名（循环使用，超过 17 个时加后缀）。 */
const FIELD_NAMES = [
  'slot_id', 'code', 'price', 'duration', 'place', 'address', 'device', 'date', 'slot_type',
  'picture', 'process', 'outcome', 'dept', 'pay_url', 'callback', 'selected', 'ids',
] as const

/** 1×1 透明 GIF，避免真实图片请求。 */
const PIXEL = 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7'

/** 实例专属 id：互不相同、不连续（像数据库主键）。 */
function instanceId(index: number): number {
  return 3 + ((index * 977) % 2000)
}

function styleFor(c: ClassNames): string {
  return `
.${c.person} { border: 1px solid #ddd; border-radius: 4px; padding: 8px 12px; margin-bottom: 8px; }
.${c.body} { display: flex; gap: 12px; align-items: flex-start; }
.${c.rel} { position: relative; }
.${c.hidden} { display: none; }
.${c.name} { margin: 0; font-size: 16px; }
.${c.role}, .${c.creds} { margin: 2px 0; font-size: 12px; color: #555; }
.${c.tag} { display: block; font-size: 12px; color: #777; }
`
}

/**
 * 前 bare 个字段不带 name 属性（只有 type / id / value）：核心按「标签 + class，其次 data-testid / role / name」给兄弟分组，
 * 没有 name 的 input 全部落进同一组（`input|||`）。有 name 的按名字各成一组（每个名字跨所有卡片只有 cards 个）。
 */
function hiddenFields(id: number, count: number, bare: number): string {
  return Array.from({ length: count }, (_, offset) => {
    const base = FIELD_NAMES[offset % FIELD_NAMES.length]
    const name = offset < FIELD_NAMES.length ? base : `${base}_${Math.floor(offset / FIELD_NAMES.length) + 1}`
    const nameAttr = offset < bare ? '' : ` name="${name}"`
    return `<input type="hidden"${nameAttr} id="${name}-${id}" value="">`
  }).join('')
}

function cardHtml(index: number, c: ClassNames, copy: Copy, hiddenCount: number, bare: number): string {
  const id = instanceId(index)
  const href = `/dev-fixtures/playground/card-hidden-fields?member=${index}`
  const photo = `<div class="${c.rel} ${c.photo}"><span class="${c.tag}">${copy.site}</span><a href="${href}"><img src="${PIXEL}" alt=""></a></div>`
  const text =
    `<div class="${c.rel} ${c.text}"><a class="${c.nameLink}" href="${href}"><h3 class="${c.name}">${copy.name(index)}</h3></a>` +
    `<p class="${c.role}">${copy.role}</p>` +
    `<div class="${c.creds}"><span class="${c.credsLabel}">${copy.credsLabel}</span><span class="${c.credsText}">${index}-A | ${index}-B</span></div>` +
    `<button type="button">${copy.book}</button></div>`
  // 卡内自带一块隐藏的验证面板（真实页面里每张卡都带一大块隐藏表单）
  const verify = `<div class="${c.hidden}" id="verify-${id}"><label>${copy.phone}<input type="tel" placeholder="${copy.phone}"></label><button type="button">${copy.book}</button></div>`
  const panel = `<div class="${c.panel} ${c.hidden}" id="booking-${id}"><p>${copy.panel}</p></div>`
  return `<div class="${c.person}" id="person-${id}"><div class="${c.body}">${photo}${text}</div>${verify}</div>${hiddenFields(id, hiddenCount, bare)}${panel}`
}

export async function GET(request: NextRequest): Promise<NextResponse> {
  const blocked = playgroundBlocked()
  if (blocked) return blocked

  const params = request.nextUrl.searchParams
  const cards = intParam(params.get('cards'), 5, 1, 30)
  const hiddenCount = intParam(params.get('hidden'), 17, 0, 40)
  const bare = Math.min(intParam(params.get('bare'), 4, 0, 40), hiddenCount)
  const copy = params.get('lang') === 'en' ? COPY.en : COPY.zh
  const c = params.get('classes') === 'hash' ? HASHED : SEMANTIC

  const items = Array.from({ length: cards }, (_, offset) => cardHtml(offset + 1, c, copy, hiddenCount, bare)).join('')
  const body = `<h1>${copy.title}</h1>
<div class="${c.list}" id="${c.list}">${items}</div>`

  return htmlResponse(renderShell(copy.title, body, { style: styleFor(c) }))
}
