import { NextRequest, NextResponse } from '../_lib/next-shim'

import { htmlResponse, intParam, itemRow, playgroundBlocked, renderShell } from '../_lib/shell'

/**
 * 演练场 · 登录墙遮罩（pattern F3）。
 *
 * #list 里只渲染前 shown 行（「商品 n」+ 价格）。列表末端被一个登录遮罩 div.login-wall 覆盖，
 * 文案「登录后查看全部内容」。页面没有任何滚动加载逻辑：滚到底也不会追加行。
 *
 * 陷阱：可见的行数不是完整结果。停机原因是墙（gated），不是到底（end-of-list）。
 * 静态数行得到的数字和真到底没有区别，只能靠遮罩文案分辨停机原因。
 *
 * query：
 * - visible：墙之前可见的行数（默认 5，1–20）
 * - total：站点真实拥有的条数（默认 20，1–50）。它不被渲染成任何文字或属性；
 *   只决定有没有内容被挡住：shown = min(visible, total)，只有 total > shown 时才出现遮罩。
 *   因此 visible 小于 total 时是墙，visible 不小于 total 时列表完整、没有墙。
 *
 * 遮罩用 position:absolute 盖住 #list 所在的容器（上方透明、下方不透明），
 * 所以遮罩之下的行仍在 DOM 里，只是视觉上被挡住。
 *
 * 单页，没有页码参数；越界的数值参数按 intParam 夹到范围内。
 */

const WALL_TEXT = '登录后查看全部内容'

const WALL_STYLE = `.head { display: flex; gap: 16px; padding: 8px 0; border-bottom: 2px solid #ccc; font-weight: 600; }
.wall-wrap { position: relative; }
.login-wall { position: absolute; inset: 0; display: flex; flex-direction: column; align-items: center; justify-content: flex-end; gap: 8px; padding-bottom: 16px; background: linear-gradient(rgba(255,255,255,0) 0%, rgba(255,255,255,0.92) 50%, #fff 100%); }
.login-wall p { margin: 0; font-weight: 600; }
.login-btn { border: 1px solid #1a5fb4; color: #1a5fb4; border-radius: 4px; padding: 4px 16px; }`

export async function GET(request: NextRequest): Promise<NextResponse> {
  const blocked = playgroundBlocked()
  if (blocked) return blocked

  const query = request.nextUrl.searchParams
  const visible = intParam(query.get('visible'), 5, 1, 20)
  const total = intParam(query.get('total'), 20, 1, 50)
  const shown = Math.min(visible, total)
  const walled = total > shown

  const rows = Array.from({ length: shown }, (_, index) => itemRow(index + 1)).join('\n')
  const wall = walled
    ? `<div class="login-wall">
<p>${WALL_TEXT}</p>
<span class="login-btn">登录</span>
</div>`
    : ''

  const body = `<h1>商品列表</h1>
<div class="head"><span>商品</span><span>价格</span></div>
<div class="wall-wrap">
<ul id="list">
${rows}
</ul>
${wall}
</div>`

  return htmlResponse(renderShell('商品列表', body, { style: WALL_STYLE }))
}
