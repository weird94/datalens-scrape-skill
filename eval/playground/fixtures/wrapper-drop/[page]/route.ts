import { NextRequest, NextResponse } from '../../_lib/next-shim'

import { htmlResponse, intParam, playgroundBlocked, renderShell } from '../../_lib/shell'

/**
 * 演练场 · 翻页后列表的外层包装消失（pattern D5 的一种）。
 *
 * 真站的形状（2026-10-25，B 站搜索登录态）：第 1 页列表外面套着页面级包装
 * （`div.search-page.search-page-all > div`），第 2 页起整页跳转过去，这层包装没有了，列表直接挂在别的父节点下。
 * 分析出的 root 带着第 1 页的祖先限定，翻页后找不到容器；分页选择器也写在这层包装下，同样失效。
 *
 * 和 nav-pager（D05-001）的区别：那里只是容器自己的 class 随页码变，外层 `#slot` 不变；这里变的是祖先。
 *
 * query：
 * - pages：总页数（默认 3，1–50）
 * - perPage：每页行数（默认 10，1–50）
 * - list：第 1 页列表的写法
 *   - classed（默认）：包装 > `div.<inner>` > `div.<list>` > 行。分析出的 root 带着只在第 1 页出现的
 *     `div.<inner>`，去掉开头祖先段后仍有 class，规则就能找回（`div.<inner> > div.<list>` → `div.<list>`）。
 *   - bare：包装 > 无 class 的 div > 行，行直接挂在无 class 的 div 下（B 站的写法）。root 只能写成
 *     `div.<wrap> > div`，去掉祖先段只剩 `div`，规则找不回，只能请 AI 在新页重新定位。
 *   第 2 页起两种写法一样：`main > div.<list>` > 行，分页器是 `main` 下的兄弟节点。
 *   每页侧栏都有一个同样用 `div.<list>` 的「推荐」块（3 行，标题前缀不同）：真站常见，也让列表 class 在页面上
 *   不唯一，分析出的 root 只能带上第 1 页的祖先限定（classed 写法因此会撞上这个坑）；AI 重新定位时它也是干扰项。
 * - lang：zh / en（默认 zh，非法值回落到 zh）
 * - classes：semantic = 语义类名 / hash = 哈希式类名（默认 semantic，非法值回落到 semantic）
 *
 * 末页给出「到底」信号（页头「第 N / N 页」+ 置灰的下一页），停机判断不该把它当成没采完。
 * 可采行数 = pages × perPage。
 */

const BASE = '/dev-fixtures/playground/wrapper-drop'

type Lang = 'zh' | 'en'
type ClassStyle = 'semantic' | 'hash'
type ListShape = 'classed' | 'bare'

const LANGS: readonly Lang[] = ['zh', 'en']
const CLASS_STYLES: readonly ClassStyle[] = ['semantic', 'hash']
const LIST_SHAPES: readonly ListShape[] = ['classed', 'bare']

interface LangText {
  title: (page: number) => string
  heading: (page: number, pages: number) => string
  itemPrefix: string
  recommendPrefix: string
  author: (index: number) => string
  nextLabel: string
  lastLabel: string
}

const TEXT: Record<Lang, LangText> = {
  zh: {
    title: page => `搜索结果 第${page}页`,
    heading: (page, pages) => `搜索结果 第 ${page} / ${pages} 页`,
    itemPrefix: '视频 ',
    recommendPrefix: '推荐 ',
    author: index => `作者 ${index}`,
    nextLabel: '下一页',
    lastLabel: '已是最后一页',
  },
  en: {
    title: page => `Search results, page ${page}`,
    heading: (page, pages) => `Search results · page ${page} of ${pages}`,
    itemPrefix: 'Video ',
    recommendPrefix: 'Recommended ',
    author: index => `Author ${index}`,
    nextLabel: 'Next page',
    lastLabel: 'Last page',
  },
}

interface ClassNames {
  /** 只在第 1 页出现的页面级包装（两个 class，同 B 站） */
  wrap: string
  /** classed 写法里第 1 页包装与列表之间那一层 */
  inner: string
  list: string
  item: string
  title: string
  author: string
  pager: string
  next: string
}

const CLASS_NAMES: Record<ClassStyle, ClassNames> = {
  semantic: {
    wrap: 'search-page search-page-all',
    inner: 'result-wrap',
    list: 'video-list row',
    item: 'item',
    title: 'title',
    author: 'author',
    pager: 'pager',
    next: 'next',
  },
  hash: {
    wrap: 'q3d9e1a q8b2c7f',
    inner: 'q0b5f2d',
    list: 'q5a0e4d q1c6b9e',
    item: 'q7e2f0b',
    title: 'q2b8d5c',
    author: 'q9f4a1e',
    pager: 'q4c7e3a',
    next: 'q6d1b8f',
  },
}

function listStyle(n: ClassNames): string {
  return (
    `.${n.item} { display: flex; gap: 16px; padding: 8px 0; border-bottom: 1px solid #eee; } ` +
    `.${n.pager} { margin-top: 16px; } ` +
    `.${n.pager} .${n.next} { display: inline-block; padding: 4px 8px; border: 1px solid #333; }`
  )
}

function rowHtml(index: number, text: LangText, n: ClassNames, prefix = text.itemPrefix): string {
  return `<div class="${n.item}"><a href="${BASE}/video/${index}"><span class="${n.title}">${prefix}${index}</span></a><span class="${n.author}">${text.author(index)}</span></div>`
}

const RECOMMEND_COUNT = 3

function asideHtml(text: LangText, n: ClassNames): string {
  const rows = Array.from({ length: RECOMMEND_COUNT }, (_, index) =>
    rowHtml(index + 1, text, n, text.recommendPrefix)
  ).join('\n')
  return `<aside><div class="${n.list}">\n${rows}\n</div></aside>`
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
  const shape = pick(query.get('list'), LIST_SHAPES, 'classed')
  const lang = pick(query.get('lang'), LANGS, 'zh')
  const names = CLASS_NAMES[pick(query.get('classes'), CLASS_STYLES, 'semantic')]
  const text = TEXT[lang]
  const page = Number.parseInt(pageParam, 10)
  if (!Number.isInteger(page) || page < 1 || page > pages) {
    return new NextResponse('Not found', { status: 404 })
  }

  const rows = Array.from({ length: perPage }, (_, index) =>
    rowHtml((page - 1) * perPage + index + 1, text, names)
  ).join('\n')
  const keptQuery = new URLSearchParams(query).toString()
  const nextTarget = `${BASE}/${page + 1}${keptQuery ? `?${keptQuery}` : ''}`
  const pager =
    page < pages
      ? `<div class="${names.pager}"><a class="${names.next}" href="${nextTarget}">${text.nextLabel}</a></div>`
      : `<div class="${names.pager}"><button class="${names.next}" disabled aria-disabled="true">${text.lastLabel}</button></div>`

  let main: string
  if (page === 1) {
    // 第 1 页：页面级包装 > 中间层 > 列表 + 分页器
    main =
      shape === 'bare'
        ? `<div class="${names.wrap}"><div>\n${rows}\n${pager}\n</div></div>`
        : `<div class="${names.wrap}"><div class="${names.inner}">\n<div class="${names.list}">\n${rows}\n</div>\n${pager}\n</div></div>`
  } else {
    // 第 2 页起：没有页面级包装，列表直接挂在 main 下
    main = `<main>\n<div class="${names.list}">\n${rows}\n</div>\n${pager}\n</main>`
  }
  const body = `<header><nav><a href="${BASE}/1">Home</a></nav></header>
<h1>${text.heading(page, pages)}</h1>
${main}
${asideHtml(text, names)}
<footer>footer</footer>`

  return htmlResponse(
    renderShell(text.title(page), body, { style: listStyle(names) }).replace(
      '<html lang="zh">',
      `<html lang="${lang}">`
    )
  )
}
