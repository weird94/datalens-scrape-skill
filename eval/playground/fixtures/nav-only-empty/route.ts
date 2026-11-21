import { NextRequest, NextResponse } from '../_lib/next-shim'

import { htmlResponse, intParam, playgroundBlocked, renderShell } from '../_lib/shell'

/**
 * 演练场 · 主体为空，只剩导航与筛选条（pattern B2）。
 *
 * 真站的形状：页面顶部有一排频道导航（很多 li），主体里是一条筛选按钮，结果区域却是空的，
 * 只有一句「登录后即可查看内容」。朴素的做法会把导航的 li 当成列表行数出来，得到一个假的非零数字。
 * 正确结果是 0 行，停机原因是 gated（门控），而不是把导航当结果。
 *
 * 页面始终返回 200，和真站一样不报错；结果区域里没有任何 li，提示文字只放在 p 里。
 *
 * query：
 * - navItems：顶部频道导航的 li 个数（默认 6，1–20）
 *
 * 结果区域（main .result）内没有行；导航的 li 只在 nav 里，不在 main 里。
 * 同一 pattern 的 case 见 eval/playground/cases/B02-001。
 */

export async function GET(request: NextRequest): Promise<NextResponse> {
  const blocked = playgroundBlocked()
  if (blocked) return blocked

  const navItems = intParam(request.nextUrl.searchParams.get('navItems'), 6, 1, 20)

  const navList = Array.from({ length: navItems }, (_, index) => `<li><a href="#">频道 ${index + 1}</a></li>`).join('\n')

  const body = `<nav class="channels"><ul>
${navList}
</ul></nav>
<main>
<div class="filters"><button type="button">筛选 a</button><button type="button">筛选 b</button><button type="button">筛选 c</button></div>
<div class="result"><p class="hint">登录后即可查看内容</p></div>
</main>`

  return htmlResponse(
    renderShell('频道首页', body, {
      style: 'nav.channels li { display: inline-block; margin-right: 12px; } .filters { margin: 16px 0; } .filters button { margin-right: 8px; padding: 4px 12px; border: 1px solid #333; background: #fff; font: inherit; cursor: pointer; } .result { padding: 32px 0; color: #666; }',
    })
  )
}
