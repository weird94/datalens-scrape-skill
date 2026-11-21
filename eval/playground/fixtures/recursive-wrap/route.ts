import { NextRequest, NextResponse } from '../_lib/next-shim'

import { htmlResponse, intParam, playgroundBlocked, renderShell } from '../_lib/shell'

/**
 * 演练场 · 递归嵌套包装（pattern A3）。
 *
 * query：
 * - albums：专辑卡片数（默认 12，1–30）。层数等于专辑数。
 * - lang：文案语言 zh / en / ja（默认 zh，非法值回落到 zh）。
 * - classes：类名风格 semantic（wrap / album 这类语义名）、hash-1 / hash-2（两套随机哈希类名）
 *   （默认 semantic，非法值回落到 semantic）。
 *
 * 结构：每一层是一个 wrap，里面放一张卡片（标题 + 年份文字），
 * 以及一个嵌套的 wrap，嵌套的那层包着剩余的专辑。最后一层只有卡片，没有嵌套 wrap。
 * 纯静态渲染：服务端生成完整 HTML，没有脚本。
 *
 * 陷阱：每层同时有卡片和装着剩余卡片的 wrap，所以选中 wrap 这一层的兄弟组（wrap > *）
 * 会得到每层 2 个节点（卡片 + 下一层 wrap），树被切成多层、每层 2 项。
 * 正确的数据行是卡片本身（卡片类名的元素），共 albums 行。
 *
 * 已知弱点：嵌套 wrap 的文字也以第一张卡片的标题开头，所以只看 textPrefix 判不出这些嵌套行。
 * 判据要靠行元素的身份（必须是卡片类名）和 expectedRows。见 case 的 notes 字段。
 */

const LANGS = ['zh', 'en', 'ja'] as const
type Lang = (typeof LANGS)[number]

const CLASS_STYLES = ['semantic', 'hash-1', 'hash-2'] as const
type ClassStyle = (typeof CLASS_STYLES)[number]

interface Copy {
  heading: string
  pageTitle: (albums: number) => string
  album: (n: number) => string
  year: (year: number) => string
}

const COPY: Record<Lang, Copy> = {
  zh: {
    heading: '专辑列表',
    pageTitle: (albums) => `专辑列表 共${albums}张`,
    album: (n) => `专辑 ${n}`,
    year: (year) => `${year} 年`,
  },
  en: {
    heading: 'Albums',
    pageTitle: (albums) => `Albums (${albums} total)`,
    album: (n) => `Album ${n}`,
    year: (year) => `${year}`,
  },
  ja: {
    heading: 'アルバム一覧',
    pageTitle: (albums) => `アルバム 全${albums}枚`,
    album: (n) => `アルバム ${n}`,
    year: (year) => `${year}年`,
  },
}

interface ClassNames {
  wrap: string
  album: string
  title: string
  year: string
}

const CLASS_NAMES: Record<ClassStyle, ClassNames> = {
  semantic: { wrap: 'wrap', album: 'album', title: 'title', year: 'year' },
  'hash-1': { wrap: 'css-7f3c2a', album: 'css-91be04', title: 'css-2d6e8f', year: 'css-c05a1b' },
  'hash-2': { wrap: 'k3m9ab', album: 'k3p0cd', title: 'k3r7ef', year: 'k3t2gh' },
}

function choiceParam<T extends string>(value: string | null, choices: readonly T[], fallback: T): T {
  return choices.find((choice) => choice === value) ?? fallback
}

function yearOf(album: number): number {
  return 1995 + ((album * 3) % 25)
}

function albumCard(album: number, copy: Copy, names: ClassNames): string {
  return `<div class="${names.album}"><span class="${names.title}">${copy.album(album)}</span><span class="${names.year}">${copy.year(yearOf(album))}</span></div>`
}

/** 从第 from 张专辑开始的一层：卡片在前，后面跟着包着剩余专辑的 wrap；到最后一张为止。 */
function wrapLayer(from: number, total: number, copy: Copy, names: ClassNames): string {
  const open = `<div class="${names.wrap}">`
  if (from >= total) {
    return `${open}${albumCard(from, copy, names)}</div>`
  }
  return `${open}${albumCard(from, copy, names)}\n${wrapLayer(from + 1, total, copy, names)}</div>`
}

function styleFor(names: ClassNames): string {
  return `.${names.wrap} { padding-left: 8px; border-left: 1px solid #ddd; margin-top: 4px; } .${names.album} { display: flex; gap: 16px; padding: 4px 0; } .${names.album} .${names.title} { font-weight: bold; } .${names.album} .${names.year} { color: #666; }`
}

export async function GET(request: NextRequest): Promise<NextResponse> {
  const blocked = playgroundBlocked()
  if (blocked) return blocked

  const params = request.nextUrl.searchParams
  const albums = intParam(params.get('albums'), 12, 1, 30)
  const lang = choiceParam(params.get('lang'), LANGS, 'zh')
  const classStyle = choiceParam(params.get('classes'), CLASS_STYLES, 'semantic')
  const copy = COPY[lang]
  const names = CLASS_NAMES[classStyle]

  const body = `<h1>${copy.heading}</h1>
<div id="albums">
${wrapLayer(1, albums, copy, names)}
</div>`

  // renderShell 的 <html lang> 写死为 zh；这里只替换成本页的语言。
  const page = renderShell(copy.pageTitle(albums), body, { style: styleFor(names) }).replace(
    '<html lang="zh">',
    `<html lang="${lang}">`
  )

  return htmlResponse(page)
}
