import { NextRequest, NextResponse } from '../../_lib/next-shim'

import { htmlResponse, intParam, playgroundBlocked, renderShell } from '../../_lib/shell'

/**
 * 演练场 · 翻到第 N 页后才出验证码（pattern F4）。
 *
 * 真站的形状：前几页正常，翻到某一页起列表根节点变空，换成一个滑块验证码页。
 * 采集器若只看「没有下一页」，会把这堵墙误标成真到底（E4），所以这里不给任何「到底」文案。
 *
 * query：
 * - pages：页面自称的总页数（默认 10，1–50）。页头照常写「第 N / pages 页」，这是自称，不是可采行数。
 * - perPage：每页行数（默认 10，1–50）
 * - wallAt：从第几页起返回验证码（默认 4，1–50）
 * - lang：文案语言 zh / en / ja（默认 zh，非法值回落到 zh）
 * - classes：类名风格 semantic = 语义名 / hash = 哈希式（默认 semantic，非法值回落到 semantic）
 *
 * 第 1 至 wallAt-1 页：perPage 行，加一个指向下一页的 next 链接（整页导航，query 原样保留，
 * lang / classes 也跟着走）。最后一页（pages）即使没到 wallAt 也没有 next 链接。
 * 第 wallAt 页及以后：列表根节点为空，没有行、没有 next 链接，只有一个滑块验证码块。
 * HTTP 状态仍是 200，和真站一样不报错。
 * 可采行数 = min(wallAt - 1, pages) 页 × perPage 行。
 *
 * 同一 pattern 的变体见 eval/playground/cases/F04-*：中 / 英 / 日三种文案，两种类名风格，其中 F04-002 为留出集。
 */

const BASE = '/dev-fixtures/playground/captcha-after'

type Lang = 'zh' | 'en' | 'ja'
type ClassStyle = 'semantic' | 'hash'

const LANGS: readonly Lang[] = ['zh', 'en', 'ja']
const CLASS_STYLES: readonly ClassStyle[] = ['semantic', 'hash']

interface LangText {
  listTitle: (page: number) => string
  heading: (page: number, pages: number) => string
  itemPrefix: string
  price: (value: number) => string
  nextLabel: string
  wallTitle: string
  wallTip: string
}

const TEXT: Record<Lang, LangText> = {
  zh: {
    listTitle: (page) => `商品列表 第${page}页`,
    heading: (page, pages) => `商品列表 第 ${page} / ${pages} 页`,
    itemPrefix: '商品 ',
    price: (value) => `¥${value}`,
    nextLabel: '下一页',
    wallTitle: '安全验证',
    wallTip: '安全验证 拖动下方滑块完成拼图',
  },
  en: {
    listTitle: (page) => `Product list, page ${page}`,
    heading: (page, pages) => `Product list · page ${page} of ${pages}`,
    itemPrefix: 'Item ',
    price: (value) => `$${value}`,
    nextLabel: 'Next page',
    wallTitle: 'Security check',
    wallTip: 'Security check: drag the slider below to complete the puzzle',
  },
  ja: {
    listTitle: (page) => `商品一覧 ${page}ページ目`,
    heading: (page, pages) => `商品一覧 ${page} / ${pages} ページ`,
    itemPrefix: 'アイテム ',
    price: (value) => `¥${value}`,
    nextLabel: '次のページ',
    wallTitle: 'セキュリティ確認',
    wallTip: 'セキュリティ確認 下のスライダーをドラッグしてパズルを完成させてください',
  },
}

interface ClassNames {
  item: string
  title: string
  price: string
  pager: string
  next: string
  captchaBox: string
  captchaTip: string
  captchaTrack: string
  captchaHandle: string
}

const CLASS_NAMES: Record<ClassStyle, ClassNames> = {
  semantic: {
    item: 'item',
    title: 'title',
    price: 'price',
    pager: 'pager',
    next: 'next',
    captchaBox: 'captcha-box',
    captchaTip: 'captcha-tip',
    captchaTrack: 'captcha-track',
    captchaHandle: 'captcha-handle',
  },
  hash: {
    item: 'r7c2e9a',
    title: 'r1b4d6f',
    price: 'r3e8a0c',
    pager: 'r8f1a3b',
    next: 'r4f0b8c',
    captchaBox: 'r2a7e5d',
    captchaTip: 'r9c3f1e',
    captchaTrack: 'r6b0d4a',
    captchaHandle: 'r0e8c2f',
  },
}

function listStyle(n: ClassNames): string {
  return (
    `.${n.item} { display: flex; gap: 16px; padding: 8px 0; border-bottom: 1px solid #eee; } ` +
    `.${n.pager} { margin-top: 16px; } ` +
    `.${n.pager} .${n.next} { display: inline-block; padding: 4px 8px; border: 1px solid #333; }`
  )
}

function captchaStyle(n: ClassNames): string {
  return (
    `.${n.captchaBox} { margin-top: 24px; width: 300px; padding: 16px; border: 1px solid #ccc; } ` +
    `.${n.captchaTip} { margin: 0 0 12px; } ` +
    `.${n.captchaTrack} { position: relative; height: 40px; background: #eee; } ` +
    `.${n.captchaHandle} { position: absolute; left: 0; top: 0; width: 40px; height: 40px; line-height: 40px; text-align: center; background: #1a5fb4; color: #fff; }`
  )
}

function rowHtml(index: number, text: LangText, n: ClassNames): string {
  return `<li class="${n.item}"><span class="${n.title}">${text.itemPrefix}${index}</span><span class="${n.price}">${text.price(100 + index)}</span></li>`
}

function captchaHtml(text: LangText, n: ClassNames): string {
  return `<div class="${n.captchaBox}">
<p class="${n.captchaTip}">${text.wallTip}</p>
<div class="${n.captchaTrack}"><div class="${n.captchaHandle}">&gt;&gt;</div></div>
</div>`
}

/**
 * 共享的 renderShell 把 <html lang> 写死为 zh。这里只把这一处改成本页的语言，
 * 不去改共享的 _lib/shell.ts，让 en / ja 变体的 lang 属性与文案一致。
 */
function renderPage(title: string, body: string, lang: Lang, style: string): string {
  return renderShell(title, body, { style }).replace('<html lang="zh">', `<html lang="${lang}">`)
}

/** 取 query 里的枚举值：缺失或非法时回落到默认值。 */
function pick<T extends string>(value: string | null, allowed: readonly T[], fallback: T): T {
  return allowed.find((item) => item === value) ?? fallback
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ page: string }> }
): Promise<NextResponse> {
  const blocked = playgroundBlocked()
  if (blocked) return blocked

  const { page: pageParam } = await params
  const query = request.nextUrl.searchParams
  const pages = intParam(query.get('pages'), 10, 1, 50)
  const perPage = intParam(query.get('perPage'), 10, 1, 50)
  const wallAt = intParam(query.get('wallAt'), 4, 1, 50)
  const lang = pick(query.get('lang'), LANGS, 'zh')
  const classes = pick(query.get('classes'), CLASS_STYLES, 'semantic')
  const text = TEXT[lang]
  const names = CLASS_NAMES[classes]
  const page = Number.parseInt(pageParam, 10)
  if (!Number.isInteger(page) || page < 1 || page > pages) {
    return new NextResponse('Not found', { status: 404 })
  }

  // 墙：列表根节点为空，没有行、没有下一页链接，只剩验证码
  if (page >= wallAt) {
    const body = `<ul id="list"></ul>\n${captchaHtml(text, names)}`
    return htmlResponse(renderPage(text.wallTitle, body, lang, captchaStyle(names)))
  }

  const rows = Array.from({ length: perPage }, (_, index) =>
    rowHtml((page - 1) * perPage + index + 1, text, names)
  ).join('\n')
  // 下一页链接保留原始 query（含 lang / classes）；原始 query 为空时不拼出多余的「?」
  const keptQuery = new URLSearchParams(query).toString()
  const nextTarget = `${BASE}/${page + 1}${keptQuery ? `?${keptQuery}` : ''}`
  const pager =
    page < pages ? `<div class="${names.pager}"><a class="${names.next}" href="${nextTarget}">${text.nextLabel}</a></div>` : ''
  const body = `<h1>${text.heading(page, pages)}</h1>
<ul id="list">
${rows}
</ul>
${pager}`

  return htmlResponse(renderPage(text.listTitle(page), body, lang, listStyle(names)))
}
