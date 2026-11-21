import { NextRequest, NextResponse } from '../_lib/next-shim'

import { htmlResponse, intParam, playgroundBlocked, renderShell } from '../_lib/shell'

/**
 * 演练场 · 列表晚渲染（pattern A1）。
 *
 * 首屏 HTML 的列表区只有「加载中…」占位，没有任何数据行。脚本在 delayMs 毫秒后才把 rows 个数据行
 * 插入 #list，而插入之前页面早已触发过 load 事件：在加载完成时快照 DOM 的检测器只会看到 0 行。
 * 这是 CSR 站点列表晚渲染的形状，检测一发定生死，结构树为空时连 AI 都不会被调用。
 *
 * 占位 <li class="loading"> 既不是数据行的 class，文案也不以数据行的前缀开头，
 * 所以 rowMatch 只会选中真正的数据行（分隔行、控件行同理）。
 *
 * 列头放在 #list 外面、是可见文字（商品 / 价格，或 Name / Price），所以 expectedColumns 的列名有页面上的依据。
 *
 * query：
 * - delayMs：数据行插入的毫秒数（默认 1500，0–6000）。插入前页面完全静止，按 waitForDomIdle 的实现，
 *   安静窗口（idleMs）会在插入前结束，所以各档位都会在 0 行时放行，这正是要复现的陷阱。
 *   静止页面碰不到就绪判据的 4s 上限，因此这个形状不验证上限的降级分支；
 *   要验证上限请用持续变动的页面（如 ticker-list）。
 * - rows：数据行数（默认 20，1–100）
 * - lang：zh（默认）或 en。en 把占位、列头、数据行换成英文，价格用 $。
 * - classes：semantic（默认，class 为 item / title / price）或 hashed（哈希式 class，留出集用）。
 *   数据行的选择器 #list > li 与 class 无关，两种写法选中的行相同。
 *
 * 单页，没有页码参数，因此没有 404 分支；越界的数值参数按 intParam 夹到范围内，
 * 未知的 lang / classes 回落到默认值。
 */

type Lang = 'zh' | 'en'
type ClassStyle = 'semantic' | 'hashed'

interface Variant {
  lang: Lang
  classes: ClassStyle
}

const COPY: Record<
  Lang,
  { title: string; loading: string; itemPrefix: string; head: [string, string]; currency: string }
> = {
  zh: { title: '商品列表', loading: '加载中…', itemPrefix: '商品', head: ['商品', '价格'], currency: '¥' },
  en: { title: 'Product list', loading: 'Loading…', itemPrefix: 'Item', head: ['Name', 'Price'], currency: '$' },
}

const CLASS_NAMES: Record<ClassStyle, { row: string; title: string; price: string; head: string }> = {
  semantic: { row: 'item', title: 'title', price: 'price', head: 'head' },
  hashed: { row: 'k3m9', title: 'n5p2', price: 'v8q4', head: 'h1x7' },
}

function parseLang(value: string | null): Lang {
  return value === 'en' ? 'en' : 'zh'
}

function parseClasses(value: string | null): ClassStyle {
  return value === 'hashed' ? 'hashed' : 'semantic'
}

function rowHtml(index: number, variant: Variant): string {
  const copy = COPY[variant.lang]
  const names = CLASS_NAMES[variant.classes]
  return `<li class="${names.row}"><span class="${names.title}">${copy.itemPrefix} ${index}</span><span class="${names.price}">${copy.currency}${100 + index}</span></li>`
}

function headHtml(variant: Variant): string {
  const copy = COPY[variant.lang]
  const names = CLASS_NAMES[variant.classes]
  return `<div class="${names.head}"><span>${copy.head[0]}</span><span>${copy.head[1]}</span></div>`
}

function styleFor(variant: Variant): string {
  const names = CLASS_NAMES[variant.classes]
  return `.${names.row} { display: flex; gap: 16px; padding: 8px 0; border-bottom: 1px solid #eee; }
.${names.head} { display: flex; gap: 16px; padding: 8px 0; border-bottom: 2px solid #ccc; font-weight: 600; }`
}

export async function GET(request: NextRequest): Promise<NextResponse> {
  const blocked = playgroundBlocked()
  if (blocked) return blocked

  const query = request.nextUrl.searchParams
  const delayMs = intParam(query.get('delayMs'), 1500, 0, 6000)
  const rows = intParam(query.get('rows'), 20, 1, 100)
  const variant: Variant = {
    lang: parseLang(query.get('lang')),
    classes: parseClasses(query.get('classes')),
  }
  const copy = COPY[variant.lang]

  const rowsHtml = Array.from({ length: rows }, (_, index) => rowHtml(index + 1, variant)).join('')
  // 数据行以 JSON 字符串字面量交给脚本；把 < 转成 <，任何位置都不会出现提前闭合 script 的文本
  const rowsLiteral = JSON.stringify(rowsHtml).replace(/</g, '\\u003c')
  const script = `
setTimeout(function () {
  document.getElementById('list').innerHTML = ${rowsLiteral};
}, ${delayMs});
`

  const body = `<h1>${copy.title}</h1>
${headHtml(variant)}
<ul id="list">
<li class="loading">${copy.loading}</li>
</ul>`

  return htmlResponse(renderShell(copy.title, body, { style: styleFor(variant), script }))
}
