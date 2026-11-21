import { NextRequest, NextResponse } from '../_lib/next-shim'

import { htmlResponse, intParam, playgroundBlocked, renderShell } from '../_lib/shell'

/**
 * 演练场 · 懒加载图片（pattern C7）。
 *
 * 列表 ul.list 里每行有标题「商品 n」和一张图。图片的 src 只是 1×1 透明 gif 占位，
 * 真实地址在 data-src 上。脚本在图片进入视口时才把 data-src 换进 src（滚到才换）：
 * 服务端吐出的 HTML 里每张图都是占位；视口外的行一直停在占位上，直接读 src 拿到的是 1×1 gif。
 * 不支持 IntersectionObserver 的环境里不换，占位图就一直在。
 *
 * query：
 * - rows：行数（默认 20，1–50）
 *
 * 没有分页参数，因此没有「非法页码 404」；越界的 rows 由 intParam 夹到范围内。
 */

const PLACEHOLDER_GIF = 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7'

/** 真实图片：一个含编号文字的小 SVG，编号即该行的 n。 */
function thumbDataUri(n: number): string {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="120" height="90" viewBox="0 0 120 90"><rect width="120" height="90" fill="#e8f0fe"/><text x="60" y="52" font-size="24" text-anchor="middle" fill="#1a5fb4">图 ${n}</text></svg>`
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`
}

function lazyRow(n: number): string {
  return `<li class="item"><img class="thumb" src="${PLACEHOLDER_GIF}" data-src="${thumbDataUri(n)}" alt=""><span class="title">商品 ${n}</span></li>`
}

const SCRIPT = `
(function () {
  if (!('IntersectionObserver' in window)) return;
  var observer = new IntersectionObserver(function (entries) {
    entries.forEach(function (entry) {
      if (!entry.isIntersecting) return;
      var img = entry.target;
      img.src = img.getAttribute('data-src');
      observer.unobserve(img);
    });
  });
  document.querySelectorAll('img.thumb[data-src]').forEach(function (img) {
    observer.observe(img);
  });
})();
`

export async function GET(request: NextRequest): Promise<NextResponse> {
  const blocked = playgroundBlocked()
  if (blocked) return blocked

  const rows = intParam(request.nextUrl.searchParams.get('rows'), 20, 1, 50)
  const items = Array.from({ length: rows }, (_, index) => lazyRow(index + 1)).join('\n')
  const body = `<h1>商品图片列表（懒加载）</h1>
<ul class="list">
${items}
</ul>`

  return htmlResponse(
    renderShell('商品图片列表 懒加载', body, {
      style: '.thumb { width: 120px; height: 90px; background: #f5f5f5; flex: none; }',
      script: SCRIPT,
    })
  )
}
