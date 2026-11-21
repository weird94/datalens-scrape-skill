import { NextRequest, NextResponse } from '../_lib/next-shim'

import { htmlResponse, intParam, playgroundBlocked, renderShell } from '../_lib/shell'

/**
 * 演练场 · 详情页上的小列表（pattern B1）。
 *
 * 页面主体是一件商品的详情（标题、价格、描述段落）。页面上有两个列表：
 * - 「用户评价」：ul.reviews，只有少量条目（默认 3 条）。这才是用户要采的列表。
 * - 「猜你喜欢」：ul.carousel，横向推荐轮播，条目远多于评价（默认 20 项，最多 50）。
 *
 * 陷阱：轮播里的 li.card 数量更大，候选选错（选成轮播）就会得到 20 行，而不是评价的 3 行。
 * 正确答案就是评价的条数：评价本来就只有这么多，没有「更多」可以点，不是采不全（停机原因 end-of-list）。
 *
 * 两个列表都是 ul，空的时候保留 ul，里面只放一条非数据行（li.empty，文案「暂无评价」/「暂无推荐」）。
 * 非数据行的 class 与文案都和数据行不同，rowMatch 的 selector 与 textPrefix 不会选中它。
 *
 * query：
 * - reviews：评价条数（默认 3，0–20）
 * - carousel：推荐轮播的条数（默认 20，0–50）
 *
 * 单页，没有页码参数，因此没有 404 分支；越界的数值参数按 intParam 夹到范围内。
 */

const DESCRIPTION = [
  '这是一款便携式无线耳机，机身轻巧，单次充电可连续使用约 6 小时，充电盒可再补充约 3 次电量。',
  '主要卖点：主动降噪、通话降噪麦克风、防水等级 IPX4，适合通勤、运动和日常使用。',
  '包装内含耳机、充电盒、三对耳塞与 USB-C 充电线。',
]

const REVIEW_LINES = [
  '物流很快，包装完整。',
  '音质不错，续航够用。',
  '价格合适，性价比高。',
  '佩戴舒适，用了一周没有问题。',
  '客服回复及时，处理顺利。',
]

function reviewsHtml(count: number): string {
  if (count === 0) return '<ul class="reviews">\n<li class="empty">暂无评价</li>\n</ul>'
  const rows = Array.from(
    { length: count },
    (_, index) => `<li class="review">评价 ${index + 1}：${REVIEW_LINES[index % REVIEW_LINES.length]}</li>`
  )
  return `<ul class="reviews">\n${rows.join('\n')}\n</ul>`
}

function carouselHtml(count: number): string {
  if (count === 0) return '<ul class="carousel">\n<li class="empty">暂无推荐</li>\n</ul>'
  const cards = Array.from(
    { length: count },
    (_, index) =>
      `<li class="card"><span class="title">推荐 ${index + 1}</span><span class="price">¥${100 + index + 1}</span></li>`
  )
  return `<ul class="carousel">\n${cards.join('\n')}\n</ul>`
}

const STYLE = `
.price { font-weight: bold; font-size: 18px; }
.desc p { margin: 8px 0; }
section { margin-top: 24px; }
.reviews li { padding: 6px 0; border-bottom: 1px solid #eee; }
.carousel { display: flex; gap: 12px; overflow-x: auto; padding-bottom: 8px; }
.carousel .card { flex: 0 0 140px; border: 1px solid #ddd; padding: 8px; display: flex; flex-direction: column; gap: 4px; }
.empty { color: #888; }
`

export async function GET(request: NextRequest): Promise<NextResponse> {
  const blocked = playgroundBlocked()
  if (blocked) return blocked

  const query = request.nextUrl.searchParams
  const reviews = intParam(query.get('reviews'), 3, 0, 20)
  const carousel = intParam(query.get('carousel'), 20, 0, 50)

  const body = `<h1>示例商品：便携式无线耳机 X1</h1>
<p class="price">¥199</p>
<div class="desc">
${DESCRIPTION.map((text) => `<p>${text}</p>`).join('\n')}
</div>
<section>
<h2>用户评价</h2>
${reviewsHtml(reviews)}
</section>
<section>
<h2>猜你喜欢</h2>
${carouselHtml(carousel)}
</section>`

  return htmlResponse(renderShell('商品详情', body, { style: STYLE }))
}
