import { NextRequest, NextResponse } from '../_lib/next-shim'

import { htmlResponse, intParam, playgroundBlocked, renderShell } from '../_lib/shell'

/**
 * 演练场 · 列表末尾混入展开控件（pattern C8）。
 *
 * query：
 * - rows：数据行总数（默认 15，1–50）
 * - lang：文案语言 zh | en | ja（默认 zh）。只换文案，结构与陷阱不变。
 * - cls：class 命名 semantic | hash（默认 semantic）。hash 把 class 换成随机串，
 *   防止采集器或提示词只认 item / expand 这类语义名（docs §3.4 防过拟合）。
 * 非法的 lang / cls 回落到默认值。
 *
 * 形状：前 10 行可见。第 10 行之后、第 11 行之前有一个控件行 li.more-row，内含 button.expand，
 * 文案「查看全部 rows 条」。第 11 行起的数据行已经在 DOM 里，但带 hidden 属性。
 * 点击 button.expand 后，所有数据行显示出来，控件行被移除。
 * rows ≤ 10 时没有超出部分，因此不出现控件行。
 *
 * 陷阱：控件行和数据行同为 li > 标题 span + 价格 span 的形状（class 名随变体变化），只按结构选中会把
 * 「查看全部」当成一行导出；静态时可见的数据行只有前 10 行，隐藏行拿不到可见文本。
 *
 * 变体（case 目录）：C08-001 = zh + semantic（开发）；C08-002 = en + hash（留出）；C08-003 = ja + semantic（开发）。
 */
const VISIBLE_ROWS = 10

type Lang = 'zh' | 'en' | 'ja'
type ClassStyle = 'semantic' | 'hash'

const LANGS: readonly Lang[] = ['zh', 'en', 'ja']
const CLASS_STYLES: readonly ClassStyle[] = ['semantic', 'hash']

interface Copy {
  title: string
  heading: string
  item: string
  price: (itemNumber: number) => string
  more: (total: number) => string
}

const COPY: Record<Lang, Copy> = {
  zh: {
    title: '商品列表（展开更多）',
    heading: '商品列表',
    item: '商品',
    price: (itemNumber) => `¥${100 + itemNumber}`,
    more: (total) => `查看全部 ${total} 条`,
  },
  en: {
    title: 'Item list (show more)',
    heading: 'Item list',
    item: 'Item',
    price: (itemNumber) => `$${100 + itemNumber}`,
    more: (total) => `View all ${total} items`,
  },
  ja: {
    title: 'アイテム一覧（もっと見る）',
    heading: 'アイテム一覧',
    item: 'アイテム',
    price: (itemNumber) => `¥${100 + itemNumber}`,
    more: (total) => `全 ${total} 件を表示`,
  },
}

interface ClassNames {
  list: string
  row: string
  title: string
  price: string
  more: string
  expand: string
}

const CLASS_NAMES: Record<ClassStyle, ClassNames> = {
  semantic: { list: 'list', row: 'item', title: 'title', price: 'price', more: 'more-row', expand: 'expand' },
  hash: {
    list: 'css-lz8f2q',
    row: 'css-rw3k9t',
    title: 'css-tt6d1x',
    price: 'css-pr1x7m',
    more: 'css-mr5q4a',
    expand: 'css-xb9e2c',
  },
}

/**
 * 注意：semantic 下 shell 的 .item 设了 display:flex，hash 下没有 .item，所以每个变体都自带行样式。
 * 两者都必须用 !important：行的 display:flex 会盖过 UA 默认的 [hidden]{display:none}，
 * 否则「隐藏」的行其实都会显示出来。
 */
function styleFor(names: ClassNames): string {
  return `[hidden] { display: none !important; }
.${names.row} { display: flex; gap: 16px; padding: 8px 0; border-bottom: 1px solid #eee; }
.${names.more} .${names.expand} { border: 1px solid #1a5fb4; background: #fff; color: #1a5fb4; padding: 4px 12px; cursor: pointer; }`
}

function scriptFor(names: ClassNames): string {
  return `document.querySelectorAll('button.${names.expand}').forEach(function (button) {
  button.addEventListener('click', function () {
    document.querySelectorAll('ul.${names.list} > li.${names.row}[hidden]').forEach(function (row) {
      row.hidden = false;
    });
    var control = button.closest('li.${names.more}');
    if (control) control.remove();
  });
});`
}

function dataRowHtml(names: ClassNames, copy: Copy, itemNumber: number, hidden: boolean): string {
  // 与 shell 的 itemRow 同形；这里需要 hidden 属性，itemRow 不接受额外属性，所以内联一份
  return `<li class="${names.row}"${hidden ? ' hidden' : ''}><span class="${names.title}">${copy.item} ${itemNumber}</span><span class="${names.price}">${copy.price(itemNumber)}</span></li>`
}

function moreRowHtml(names: ClassNames, copy: Copy, total: number): string {
  return `<li class="${names.row} ${names.more}"><span class="${names.title}"><button class="${names.expand}" type="button">${copy.more(total)}</button></span><span class="${names.price}"></span></li>`
}

function oneOf<T extends string>(value: string | null, options: readonly T[], fallback: T): T {
  return options.find((option) => option === value) ?? fallback
}

export async function GET(request: NextRequest): Promise<NextResponse> {
  const blocked = playgroundBlocked()
  if (blocked) return blocked

  const params = request.nextUrl.searchParams
  const total = intParam(params.get('rows'), 15, 1, 50)
  const copy = COPY[oneOf(params.get('lang'), LANGS, 'zh')]
  const names = CLASS_NAMES[oneOf(params.get('cls'), CLASS_STYLES, 'semantic')]

  const items: string[] = []
  for (let itemNumber = 1; itemNumber <= total; itemNumber += 1) {
    if (itemNumber === VISIBLE_ROWS + 1) {
      items.push(moreRowHtml(names, copy, total))
    }
    items.push(dataRowHtml(names, copy, itemNumber, itemNumber > VISIBLE_ROWS))
  }

  const body = `<h1>${copy.heading}</h1>
<ul class="${names.list}">
${items.join('\n')}
</ul>`

  return htmlResponse(renderShell(copy.title, body, { style: styleFor(names), script: scriptFor(names) }))
}
