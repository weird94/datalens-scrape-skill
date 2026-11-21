import { NextRequest, NextResponse } from '../_lib/next-shim'

import { htmlResponse, playgroundBlocked, renderShell } from '../_lib/shell'

/**
 * 演练场 · 瘦页 / 软 404 / 门控 / 拦截页（pattern A5）。
 *
 * 页面本身没有列表：只有一个标题和一段说明（gated 另有一个登录按钮，只是按钮，不弹窗、不挂脚本）。
 * 正确的采集结果是 0 行，并且停机原因要是 page-empty / dead-link / gated / blocked 之一，
 * 而不是笼统的「零候选」。所有分支都返回 200：软 404、门控、质询页在浏览器里都是 200 的正文，
 * 检测器只能看 DOM，因此 mock 不能靠状态码提示它。
 *
 * query：
 * - kind：页面类型，必填，取值 empty | deleted | gated | challenge。缺失或非法值返回 404。
 *   它是类别而不是数值，所以不走 intParam。
 *   - empty：商品评价区为空（expectedStop page-empty）
 *   - deleted：内容已被删除的软 404（dead-link）
 *   - gated：要求登录才能看（gated）
 *   - challenge：访问频率限制的拦截文案（blocked）
 *
 * 文案与 class 都是中性的，不带任何真实站点的名字或 class。
 */

type ThinKind = 'empty' | 'deleted' | 'gated' | 'challenge'

interface ThinPage {
  title: string
  heading: string
  detail: string
  /** 只有 gated 有：一个不做任何事的按钮，不弹窗、不跳转。 */
  buttonLabel?: string
}

const PAGES: Record<ThinKind, ThinPage> = {
  empty: {
    title: '本店评价',
    heading: '本店暂无评价',
    detail: '收货并使用后，欢迎来分享你的感受。',
  },
  deleted: {
    title: '内容已删除',
    heading: '当前内容已被删除，无法查看',
    detail: '该内容可能已被发布者或管理员删除。',
  },
  gated: {
    title: '请先登录',
    heading: '请先登录后查看',
    detail: '登录后即可查看完整内容。',
    buttonLabel: '登录',
  },
  challenge: {
    title: '访问受限',
    heading: '访问过于频繁，请稍后再试',
    detail: '当前网络的请求频率较高，请稍等片刻后重新打开本页。',
  },
}

function isThinKind(value: string | null): value is ThinKind {
  return value === 'empty' || value === 'deleted' || value === 'gated' || value === 'challenge'
}

export async function GET(request: NextRequest): Promise<NextResponse> {
  const blocked = playgroundBlocked()
  if (blocked) return blocked

  const kind = request.nextUrl.searchParams.get('kind')
  if (!isThinKind(kind)) {
    return new NextResponse('Not found', { status: 404 })
  }

  const page = PAGES[kind]
  const button = page.buttonLabel ? `<button type="button" class="btn">${page.buttonLabel}</button>` : ''
  const body = `<div class="notice">
<h1>${page.heading}</h1>
<p>${page.detail}</p>
${button}
</div>`

  return htmlResponse(
    renderShell(page.title, body, {
      style: '.notice { padding: 48px 0; text-align: center; } .notice h1 { font-size: 20px; margin: 0 0 8px; } .notice p { color: #666; margin: 0 0 24px; } .btn { padding: 8px 24px; border: 1px solid #333; background: #fff; font: inherit; cursor: pointer; }',
    })
  )
}
