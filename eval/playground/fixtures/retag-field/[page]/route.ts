import { NextRequest, NextResponse } from '../../_lib/next-shim'

import { htmlResponse, intParam, playgroundBlocked, renderShell } from '../../_lib/shell'

/**
 * 演练场 · 翻页后字段元素换了标签、class 不变（pattern C11）。
 *
 * 真站的形状（2026-11-03，房产经纪人目录）：第 1 页是服务端渲染，姓名是 `<a class="…-name" href>`；
 * 点「下一页」后是前端渲染的另一套模板，姓名变成 `<div class="…-name">`（没有链接），class 没变。
 * 分析在第 1 页做，字段选择器带了标签名（`a.…-name`），第 2 页起一个都匹配不到，整列为空，其余列照常。
 *
 * query：
 * - pages：总页数（默认 3，1–50）
 * - perPage：每页行数（默认 10，1–50）
 * - lang：zh / en（默认 zh，非法值回落到 zh）
 * - classes：semantic = 语义类名 / hash = 哈希式类名（默认 semantic，非法值回落到 semantic）
 *
 * 末页给出「到底」信号（页头「第 N / N 页」+ 置灰的下一页）。可采行数 = pages × perPage，每行都有姓名。
 */

const BASE = '/dev-fixtures/playground/retag-field'

type Lang = 'zh' | 'en'
type ClassStyle = 'semantic' | 'hash'

const LANGS: readonly Lang[] = ['zh', 'en']
const CLASS_STYLES: readonly ClassStyle[] = ['semantic', 'hash']

interface LangText {
  title: (page: number) => string
  heading: (page: number, pages: number) => string
  namePrefix: string
  office: (index: number) => string
  phone: (index: number) => string
  nextLabel: string
  lastLabel: string
}

const TEXT: Record<Lang, LangText> = {
  zh: {
    title: page => `顾问名录 第${page}页`,
    heading: (page, pages) => `顾问名录 第 ${page} / ${pages} 页`,
    namePrefix: '顾问 ',
    office: index => `门店 ${(index % 7) + 1}`,
    phone: index => `电话 138${String(index).padStart(8, '0')}`,
    nextLabel: '下一页',
    lastLabel: '已是最后一页',
  },
  en: {
    title: page => `Advisor directory, page ${page}`,
    heading: (page, pages) => `Advisor directory · page ${page} of ${pages}`,
    namePrefix: 'Advisor ',
    office: index => `Office ${(index % 7) + 1}`,
    phone: index => `Phone 555-${String(index).padStart(4, '0')}`,
    nextLabel: 'Next page',
    lastLabel: 'Last page',
  },
}

interface ClassNames {
  list: string
  card: string
  name: string
  office: string
  phone: string
  pager: string
  next: string
}

const CLASS_NAMES: Record<ClassStyle, ClassNames> = {
  semantic: {
    list: 'advisor-list',
    card: 'advisor-card',
    name: 'advisor-name',
    office: 'advisor-office',
    phone: 'advisor-phone',
    pager: 'pager',
    next: 'next',
  },
  hash: {
    list: 'r1c8e2a',
    card: 'r7d3b0f',
    name: 'r4a9c6e',
    office: 'r2f5d1b',
    phone: 'r9b0e7c',
    pager: 'r6e2a4d',
    next: 'r3c7f9a',
  },
}

function listStyle(n: ClassNames): string {
  return (
    `.${n.list} { display: grid; gap: 8px; } ` +
    `.${n.card} { display: flex; gap: 16px; padding: 8px 0; border-bottom: 1px solid #eee; } ` +
    `.${n.name} { font-weight: 600; } ` +
    `.${n.pager} { margin-top: 16px; } ` +
    `.${n.pager} .${n.next} { display: inline-block; padding: 4px 8px; border: 1px solid #333; }`
  )
}

/** 第 1 页（服务端模板）姓名是链接；第 2 页起（前端模板）同 class 的 div，没有链接。 */
function cardHtml(index: number, isFirstPage: boolean, text: LangText, n: ClassNames): string {
  const name = `${text.namePrefix}${index}`
  const nameHtml = isFirstPage
    ? `<a class="${n.name}" href="${BASE}/advisor/${index}">${name}</a>`
    : `<div class="${n.name}">${name}</div>`
  return `<div class="${n.card}" role="link" tabindex="0"><div>${nameHtml}</div><div class="${n.office}">${text.office(index)}</div><span class="${n.phone}">${text.phone(index)}</span></div>`
}

/** 取 query 里的枚举值：缺失或非法时回落到默认值。 */
function pick<T extends string>(value: string | null, allowed: readonly T[], fallback: T): T {
  return allowed.find(item => item === value) ?? fallback
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ page: string }> }
): Promise<NextResponse> {
  const blocked = playgroundBlocked()
  if (blocked) return blocked

  const { page: pageParam } = await params
  const query = request.nextUrl.searchParams
  const pages = intParam(query.get('pages'), 3, 1, 50)
  const perPage = intParam(query.get('perPage'), 10, 1, 50)
  const lang = pick(query.get('lang'), LANGS, 'zh')
  const names = CLASS_NAMES[pick(query.get('classes'), CLASS_STYLES, 'semantic')]
  const text = TEXT[lang]
  const page = Number.parseInt(pageParam, 10)
  if (!Number.isInteger(page) || page < 1 || page > pages) {
    return new NextResponse('Not found', { status: 404 })
  }

  const cards = Array.from({ length: perPage }, (_, index) =>
    cardHtml((page - 1) * perPage + index + 1, page === 1, text, names)
  ).join('\n')
  const keptQuery = new URLSearchParams(query).toString()
  const nextTarget = `${BASE}/${page + 1}${keptQuery ? `?${keptQuery}` : ''}`
  const pager =
    page < pages
      ? `<div class="${names.pager}"><a class="${names.next}" href="${nextTarget}">${text.nextLabel}</a></div>`
      : `<div class="${names.pager}"><button class="${names.next}" disabled aria-disabled="true">${text.lastLabel}</button></div>`

  const body = `<header><nav><a href="${BASE}/1">Home</a></nav></header>
<h1>${text.heading(page, pages)}</h1>
<main>
<div class="${names.list}">
${cards}
</div>
${pager}
</main>
<footer>footer</footer>`

  return htmlResponse(
    renderShell(text.title(page), body, { style: listStyle(names) }).replace(
      '<html lang="zh">',
      `<html lang="${lang}">`
    )
  )
}
