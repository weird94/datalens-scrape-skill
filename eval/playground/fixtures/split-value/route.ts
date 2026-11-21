import { NextRequest, NextResponse } from '../_lib/next-shim'

import { htmlResponse, intParam, playgroundBlocked, renderShell } from '../_lib/shell'

/**
 * 演练场 · 一个值被拆在同一行的几个块级盒子里（pattern C10）。
 *
 * 每行一个商品卡：
 * - 价格块：整数和小数各是一个 <div>（`<div>70</div><div>.8</div>`），靠父级横排把它们画在同一行、
 *   紧挨着，看起来就是「70.8」。整数价格的行小数 div 为空。
 * - 产地块：省和市也是两个 <div>，同样横排，但两者之间有 8px 间距，看起来是「浙江 杭州」。
 * - 描述块：两个 <p> 段落，上下两行，本来就该换行。
 *
 * layout：
 * - flex（默认）：价格块 / 产地块是 `display: flex` 横排，子 div 是 flex item；
 * - inline-block：父级是普通块，子 div 是 `display: inline-block`，源码里子 div 之间没有空白。
 * lang：zh（默认，「¥」+ 中文文案）/ en（「$」+ 英文文案）。
 * classes：semantic（默认，price-int 之类）/ hash（哈希风格类名，留出集）。
 *
 * 陷阱：把价格块当一个 rich_text 字段读时，按标签名把每个 <div> 当成段落，
 * 价格变成「70\n\n.8」。正确读法按页面实际排版：同一行、没有间距的盒子直接接上（70.8），
 * 同一行、有间距的盒子用空格隔开（浙江 杭州），不在同一行的段落保留换行。
 */

interface Copy {
  currency: string
  title: (n: number) => string
  province: string
  city: string
  firstParagraph: (n: number) => string
  secondParagraph: string
}

const COPY: Record<'zh' | 'en', Copy> = {
  zh: {
    currency: '¥',
    title: n => `商品 ${n}`,
    province: '浙江',
    city: '杭州',
    firstParagraph: n => `第 ${n} 件商品的第一段介绍。`,
    secondParagraph: '第二段：包邮，七天无理由。',
  },
  en: {
    currency: '$',
    title: n => `Item ${n}`,
    province: 'Oregon',
    city: 'Portland',
    firstParagraph: n => `First paragraph about item ${n}.`,
    secondParagraph: 'Second paragraph: free shipping.',
  },
}

const SEMANTIC_CLASSES = {
  card: 'card',
  title: 'title',
  priceWrap: 'price-wrap',
  priceInt: 'price-int',
  priceFloat: 'price-float',
  origin: 'origin',
  desc: 'desc',
}

/** 哈希风格的类名：确定性，看不出语义。 */
const HASH_CLASSES: typeof SEMANTIC_CLASSES = {
  card: 'Ck3x9q',
  title: 'T7pd2a',
  priceWrap: 'Pw4m1z',
  priceInt: 'Pi8r0c',
  priceFloat: 'Pf2k6e',
  origin: 'Og5n3v',
  desc: 'Ds9w7h',
}

/** 第 n 行的价格（从 1 起算）：每 3 行有一行是整数价格，其余带一位小数。 */
function splitValuePrice(n: number): { int: string; float: string } {
  const int = String(60 + n * 7)
  return n % 3 === 0 ? { int, float: '' } : { int, float: `.${n % 10}` }
}

function buildStyle(layout: 'flex' | 'inline-block', classes: typeof SEMANTIC_CLASSES): string {
  const card = `.${classes.card} { padding: 8px 0; border-bottom: 1px solid #eee; }
.${classes.priceInt} { font-size: 20px; font-weight: 600; }
.${classes.priceFloat} { font-size: 14px; }
.${classes.desc} p { margin: 0 0 4px; }`
  if (layout === 'flex') {
    return `${card}
.${classes.priceWrap} { display: flex; align-items: baseline; }
.${classes.origin} { display: flex; column-gap: 8px; }`
  }
  return `${card}
.${classes.priceWrap} > div { display: inline-block; }
.${classes.origin} > div { display: inline-block; margin-right: 8px; }`
}

function rowHtml(n: number, copy: Copy, classes: typeof SEMANTIC_CLASSES): string {
  const price = splitValuePrice(n)
  // 子 div 之间不留源码空白：inline-block 布局下空白本身会画成一个空格
  return `<li class="${classes.card}"><div class="${classes.title}">${copy.title(n)}</div>${copy.currency}<div class="${classes.priceWrap}"><div class="${classes.priceInt}">${price.int}</div><div class="${classes.priceFloat}">${price.float}</div></div><div class="${classes.origin}"><div>${copy.province}</div><div>${copy.city}</div></div><div class="${classes.desc}"><p>${copy.firstParagraph(n)}</p><p>${copy.secondParagraph}</p></div></li>`
}

export async function GET(request: NextRequest): Promise<NextResponse> {
  const blocked = playgroundBlocked()
  if (blocked) return blocked

  const query = request.nextUrl.searchParams
  const rows = intParam(query.get('rows'), 12, 1, 50)
  const layout = query.get('layout') === 'inline-block' ? 'inline-block' : 'flex'
  const lang = query.get('lang') === 'en' ? 'en' : 'zh'
  const classes = query.get('classes') === 'hash' ? HASH_CLASSES : SEMANTIC_CLASSES
  const copy = COPY[lang]

  const items = Array.from({ length: rows }, (_, index) => rowHtml(index + 1, copy, classes)).join('\n')
  const body = `<h1>${lang === 'en' ? 'Products' : '商品列表'}</h1>
<ul class="list">
${items}
</ul>`

  return htmlResponse(
    renderShell(lang === 'en' ? 'Products (split price)' : '商品列表（拆开的价格）', body, {
      style: buildStyle(layout, classes),
    })
  )
}
