import { NextRequest, NextResponse } from '../_lib/next-shim'

import { htmlResponse, intParam, playgroundBlocked, renderShell } from '../_lib/shell'

/**
 * 演练场 · 卡片内的行被当成行，atomic-CSS 变体（pattern B4，case B04-002）。
 *
 * 和 B04-001（card-subrows）同一个陷阱，换成 atomic CSS 的写法：信息流里每张卡片是外壳 + 头像列 + 内容列，
 * 内容列里 3–4 行：头部（作者名、账号、时间链接）、正文、媒体（只有部分卡片有）、操作栏（三个计数按钮）。
 * **每一行的类名完全相同**（`div.u7 → div.u7`，下面才分化），类名都是无语义的短哈希，各行只靠内容和后代结构区分。
 * 朴素地按行计数会得到「卡片数 × 3 或 4」，卡片才是数据行。
 *
 * 形状来自 2026-10-17 一位用户在一个社交平台账号主页上的采集（一条帖子拆成 3–4 行，
 * docs/x-tweet-split-rows-root-cause-2026-10-20.md），类名、文案、属性都不是那个站的。
 *
 * query：
 * - cards：卡片数（默认 12，1–50）
 * - bare：每多少张卡里有一张没有媒体行（默认 4，即第 4、8、12… 张只有 3 行；0 = 都有媒体）
 */

/** 所有「行」及其内层包装共用的 atomic 类：只有这一组，没有任何按行区分的类。 */
const LINE = 'u7 q2'
const BOX = 'u7'
const STYLE = `
.u7 { display: flex; flex-direction: column; }
.q2 { padding: 2px 0; }
.f9 { border-bottom: 1px solid #ddd; padding: 8px 0; }
.r4 { flex-direction: row; gap: 12px; }
.k1 { width: 40px; height: 40px; border-radius: 50%; }
.t3 { color: #666; font-size: 12px; }
.m8 { max-width: 320px; border-radius: 8px; }
.b5 { background: none; border: 0; color: #666; cursor: pointer; }
`

function line(inner: string): string {
  return `<div class="${LINE}"><div class="${BOX}">${inner}</div></div>`
}

function cardHtml(index: number, withMedia: boolean): string {
  const header = line(
    `<a class="t3" href="/dev-fixtures/playground/card-atomic-lines/u/riverside"><span class="t3">河畔小城</span></a>` +
      `<a class="t3" href="/dev-fixtures/playground/card-atomic-lines/u/riverside"><span class="t3">@riverside</span></a>` +
      `<a class="t3" href="/dev-fixtures/playground/card-atomic-lines/p/${index}"><time datetime="2026-10-${String(index).padStart(2, '0')}">10月${index}日</time></a>`
  )
  const text = line(`<span class="t3">帖子 ${index}：秋天的江边很安静。</span>`)
  const media = withMedia
    ? line(`<img class="m8" src="data:image/gif;base64,R0lGODlhAQABAAAAACw=" alt="配图 ${index}" width="320" height="180">`)
    : ''
  const stat = (label: string, count: number) =>
    `<div class="${BOX}"><button class="b5" type="button" aria-label="${label}"><span class="t3">${count}</span></button></div>`
  const actions = line(
    `<div class="${BOX} r4" role="group">${stat('回复', index)}${stat('转发', index * 2)}${stat('喜欢', index * 3)}</div>`
  )
  return `<div class="${BOX} f9"><div class="${BOX} r4"><img class="k1" src="data:image/gif;base64,R0lGODlhAQABAAAAACw=" alt=""><div class="${BOX}">${header}${text}${media}${actions}</div></div></div>`
}

export async function GET(request: NextRequest): Promise<NextResponse> {
  const blocked = playgroundBlocked()
  if (blocked) return blocked

  const cards = intParam(request.nextUrl.searchParams.get('cards'), 12, 1, 50)
  const bare = intParam(request.nextUrl.searchParams.get('bare'), 4, 0, 50)
  const items = Array.from({ length: cards }, (_, offset) => {
    const index = offset + 1
    return cardHtml(index, bare === 0 || index % bare !== 0)
  }).join('')

  const body = `<h1>河畔小城的帖子</h1>
<main><section class="${BOX}"><div class="${BOX}">${items}</div></section></main>`

  return htmlResponse(renderShell('帖子（atomic 卡片行）', body, { style: STYLE }))
}
