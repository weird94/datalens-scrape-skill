import { NextResponse } from './next-shim'

/**
 * 本地演练场（playground）共用的小工具。
 *
 * 演练场的页面全部由 backend dev server（:3008）吐出来，原因同 dev-fixtures/pagination-blank：
 * 扩展的 content script 只匹配 https 站点和 localhost:3008。
 * 每个 mock 的行为由 query 参数调节，标准答案写在 eval/playground/cases/<id>/expected.json。
 */

export function playgroundBlocked(): NextResponse | null {
  // 演练场只属于本地回归，绝不该出现在线上
  if (process.env.NODE_ENV === 'production') {
    return new NextResponse('Not found', { status: 404 })
  }
  return null
}

/** 解析整数参数：非法或缺失用 fallback，越界被夹到 [min, max]。 */
export function intParam(value: string | null, fallback: number, min: number, max: number): number {
  const parsed = Number.parseInt(value ?? '', 10)
  if (!Number.isInteger(parsed)) return fallback
  return Math.min(max, Math.max(min, parsed))
}

export function htmlResponse(body: string): NextResponse {
  return new NextResponse(body, {
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'no-store',
    },
  })
}

export function renderShell(title: string, body: string, options: { style?: string; script?: string } = {}): string {
  return `<!doctype html>
<html lang="zh">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${title}</title>
<style>
body { font: 14px/1.6 system-ui, sans-serif; margin: 24px; color: #222; }
ul { list-style: none; padding: 0; margin: 0; }
a { color: #1a5fb4; }
.item { display: flex; gap: 16px; padding: 8px 0; border-bottom: 1px solid #eee; }
${options.style ?? ''}
</style>
</head>
<body>
${body}
${options.script ? `<script>\n${options.script}\n</script>` : ''}
</body>
</html>`
}

export function itemRow(itemNumber: number, className = 'item'): string {
  return `<li class="${className}"><span class="title">商品 ${itemNumber}</span><span class="price">¥${100 + itemNumber}</span></li>`
}
