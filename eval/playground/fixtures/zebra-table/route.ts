import { NextRequest, NextResponse } from '../_lib/next-shim'

import { htmlResponse, intParam, playgroundBlocked, renderShell } from '../_lib/shell'

/**
 * 演练场 · 斑马纹表格（pattern C4）。
 *
 * query：
 * - rows：数据行数（默认 40，1–200）
 * - lang：文案语言 zh / en / ja（默认 zh，非法值回落到 zh）
 * - classes：奇偶行 class 风格，semantic = odd / even，hash = 哈希式 class（默认 semantic，非法值回落到 semantic）
 *
 * 表头在 thead 里，数据行全在 tbody 里。奇偶行用不同的 class 交替。
 * 只认一种 class 的选择器（只选奇数行或只选偶数行的 class）会丢掉一半的行。
 * 每行三个单元格：商品 n、城市、价格。页面不声明总行数，正确行数由 rows 决定。
 * 同一 pattern 的变体见 eval/playground/cases/C04-*（中 / 英 / 日文案，两种 class 风格，其中一个为留出集）。
 */

type Lang = 'zh' | 'en' | 'ja'
type ClassStyle = 'semantic' | 'hash'

const LANGS: readonly Lang[] = ['zh', 'en', 'ja']
const CLASS_STYLES: readonly ClassStyle[] = ['semantic', 'hash']

interface LangText {
  title: string
  headers: [string, string, string]
  itemPrefix: string
  cities: string[]
  price: (value: number) => string
}

const TEXT: Record<Lang, LangText> = {
  zh: {
    title: '商品表格',
    headers: ['商品', '城市', '价格'],
    itemPrefix: '商品 ',
    cities: ['北京', '上海', '广州', '深圳', '杭州', '成都', '武汉', '南京'],
    price: (value) => `¥${value}`,
  },
  en: {
    title: 'Product table',
    headers: ['Product', 'City', 'Price'],
    itemPrefix: 'Item ',
    cities: ['Berlin', 'London', 'Paris', 'Madrid', 'Rome', 'Vienna', 'Oslo', 'Dublin'],
    price: (value) => `$${value}`,
  },
  ja: {
    title: '商品一覧',
    headers: ['商品', '都市', '価格'],
    itemPrefix: 'アイテム ',
    cities: ['東京', '大阪', '名古屋', '福岡', '札幌', '仙台', '京都', '神戸'],
    price: (value) => `¥${value}`,
  },
}

interface RowClassNames {
  odd: string
  even: string
}

const CLASS_NAMES: Record<ClassStyle, RowClassNames> = {
  semantic: { odd: 'odd', even: 'even' },
  hash: { odd: 'r5f2c1a', even: 'r9e0b7d' },
}

function pick<T extends string>(value: string | null, allowed: readonly T[], fallback: T): T {
  return allowed.find((item) => item === value) ?? fallback
}

function rowHtml(index: number, text: LangText, names: RowClassNames): string {
  // 第 1 行是 odd，第 2 行是 even，依次交替
  const className = index % 2 === 1 ? names.odd : names.even
  const city = text.cities[(index - 1) % text.cities.length]
  return `<tr class="${className}"><td>${text.itemPrefix}${index}</td><td>${city}</td><td>${text.price(100 + index)}</td></tr>`
}

export async function GET(request: NextRequest): Promise<NextResponse> {
  const blocked = playgroundBlocked()
  if (blocked) return blocked

  const params = request.nextUrl.searchParams
  const rows = intParam(params.get('rows'), 40, 1, 200)
  const lang = pick(params.get('lang'), LANGS, 'zh')
  const classStyle = pick(params.get('classes'), CLASS_STYLES, 'semantic')
  const text = TEXT[lang]
  const names = CLASS_NAMES[classStyle]

  const rowsMarkup = Array.from({ length: rows }, (_, index) => rowHtml(index + 1, text, names)).join('\n')
  const [productHeader, cityHeader, priceHeader] = text.headers
  const body = `<h1>${text.title}</h1>
<table class="list">
<thead><tr><th>${productHeader}</th><th>${cityHeader}</th><th>${priceHeader}</th></tr></thead>
<tbody>
${rowsMarkup}
</tbody>
</table>`

  return htmlResponse(
    renderShell(text.title, body, {
      style: `table.list { border-collapse: collapse; width: 100%; } table.list th, table.list td { padding: 6px 12px; text-align: left; border-bottom: 1px solid #eee; } tr.${names.odd} { background: #ffffff; } tr.${names.even} { background: #f6f7f9; }`,
    })
  )
}
