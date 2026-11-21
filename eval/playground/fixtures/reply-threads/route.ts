import { NextRequest, NextResponse } from '../_lib/next-shim'

import { htmlResponse, intParam, playgroundBlocked, renderShell } from '../_lib/shell'

/**
 * 演练场 · 按钮的点击处理挂在按钮里面的标签元素上（pattern D15）。
 *
 * 真站的形状（2026-11-10，短视频站视频评论区）：每条评论下有「展开N条回复」按钮，结构是
 * `<button><div/><div class="label"><span>展开N条回复</span><i/></div></button>`（前面那个是装饰横线），
 * 点击处理挂在里面的 label 上（框架的事件委托只认事件路径上的元素）。真人点的是文字，事件经 label 冒泡，能展开；
 * 脚本对 button 本身调 `click()` 时事件从 button 开始往上冒泡，路径上根本没有 label，什么都不发生，也不报错；
 * 点按钮中心点也不行——这里的中心点落在装饰横线上。
 *
 * 展开后回复和主评论是同一个 class，嵌在主评论里面；每次先出 3 条，后面跟「展开更多」（每点一次 +10 条，
 * 点完按钮换成新元素）和「收起」——收起和展开更多共用同一个基础 class，选择器只写基础 class 会把刚展开的回复收回去。
 *
 * query：
 * - comments：主评论数（默认 10，1–40）；第 i 条的回复数按 REPLY_PATTERN 循环
 * - lang：zh / en（默认 zh）
 * - classes：semantic / hash（默认 semantic）
 *
 * 可采行数（每条评论一行，回复也算）= comments + 全部回复数，见 totalRows()。
 */

type Lang = 'zh' | 'en'
type ClassStyle = 'semantic' | 'hash'

const LANGS: readonly Lang[] = ['zh', 'en']
const CLASS_STYLES: readonly ClassStyle[] = ['semantic', 'hash']

/** 第 i 条主评论（从 1 起）的回复数：REPLY_PATTERN[(i - 1) % 10]。 */
const REPLY_PATTERN: readonly number[] = [0, 3, 12, 0, 5, 1, 0, 25, 2, 0]
const FIRST_BATCH = 3
const MORE_BATCH = 10
const LOAD_DELAY_MS = 300

function repliesOf(index: number): number {
  return REPLY_PATTERN[(index - 1) % REPLY_PATTERN.length]
}

function totalRows(comments: number): number {
  let total = comments
  for (let i = 1; i <= comments; i += 1) total += repliesOf(i)
  return total
}

interface LangText {
  title: string
  count: (n: number) => string
  author: (index: number) => string
  replyAuthor: (index: number, reply: number) => string
  body: (index: number) => string
  replyBody: (index: number, reply: number) => string
  expand: (n: number) => string
  more: string
  collapse: string
}

const TEXT: Record<Lang, LangText> = {
  zh: {
    title: '视频评论',
    count: n => `共 ${n} 条评论`,
    author: index => `用户 ${index}`,
    replyAuthor: (index, reply) => `用户 ${index}-${reply}`,
    body: index => `评论 ${index}：第 ${index} 条主评论的正文。`,
    replyBody: (index, reply) => `回复 ${index}-${reply}：回复第 ${index} 条评论的第 ${reply} 条回复。`,
    expand: n => `展开${n}条回复`,
    more: '展开更多',
    collapse: '收起',
  },
  en: {
    title: 'Video comments',
    count: n => `${n} comments`,
    author: index => `user ${index}`,
    replyAuthor: (index, reply) => `user ${index}-${reply}`,
    body: index => `Comment ${index}: the body of top-level comment ${index}.`,
    replyBody: (index, reply) => `Reply ${index}-${reply}: reply number ${reply} to comment ${index}.`,
    expand: n => `View ${n} replies`,
    more: 'Show more',
    collapse: 'Hide',
  },
}

interface ClassNames {
  list: string
  item: string
  author: string
  text: string
  replies: string
  actions: string
  expand: string
  more: string
  collapse: string
  label: string
}

const CLASS_NAMES: Record<ClassStyle, ClassNames> = {
  semantic: {
    list: 'comment-list',
    item: 'comment-item',
    author: 'author',
    text: 'text',
    replies: 'replies',
    actions: 'reply-actions',
    expand: 'reply-expand',
    more: 'reply-more',
    collapse: 'collapse',
    label: 'label',
  },
  hash: {
    list: 'n4b8e2',
    item: 'x7c2a1',
    author: 'r2d9f4',
    text: 'g6a1c8',
    replies: 'k1e7b3',
    actions: 't5f3d0',
    expand: 'u8b4a6',
    more: 'y3c9e5',
    collapse: 'p0d6b1',
    label: 'w9a2f7',
  },
}

function style(n: ClassNames): string {
  return (
    `.${n.item} { padding: 8px 0; border-bottom: 1px solid #eee; } ` +
    `.${n.replies} .${n.item} { margin-left: 32px; border-bottom: 0; } ` +
    `.${n.author} { font-weight: 600; } .${n.text} { margin: 4px 0; } ` +
    `.${n.actions} button { display: inline-flex; align-items: center; background: none; border: 0; color: #1a5fb4; padding: 0; margin-right: 12px; } ` +
    `.${n.actions} button > i { display: block; width: 160px; height: 1px; background: #ccc; margin-right: 8px; } ` +
    `.${n.label} { display: inline-flex; gap: 4px; padding: 2px 4px; }`
  )
}

/** 按钮：前面一条装饰横线（够宽，按钮中心点落在它上面），后面是文字标签；点击处理只在标签上，按钮和横线都没有。 */
function button(classes: string, label: string, n: ClassNames): string {
  return `<button type="button" class="${classes}"><i></i><div class="${n.label}"><span>${label}</span><i aria-hidden="true">⌄</i></div></button>`
}

function commentHtml(index: number, text: LangText, n: ClassNames): string {
  const replies = repliesOf(index)
  const actions = replies > 0 ? button(n.expand, text.expand(replies), n) : ''
  return (
    `<div class="${n.item}" data-id="c${index}">` +
    `<div><span class="${n.author}">${text.author(index)}</span></div>` +
    `<p class="${n.text}">${text.body(index)}</p>` +
    `<div class="${n.replies}"></div>` +
    `<div class="${n.actions}">${actions}</div>` +
    `</div>`
  )
}

function script(n: ClassNames, text: LangText, comments: number): string {
  const replyHtml = Array.from({ length: comments }, (_, i) =>
    Array.from(
      { length: repliesOf(i + 1) },
      (_, j) =>
        `<div class="${n.item}"><div><span class="${n.author}">${text.replyAuthor(i + 1, j + 1)}</span></div><p class="${n.text}">${text.replyBody(i + 1, j + 1)}</p></div>`
    )
  )
  const buttons = {
    expand: Array.from({ length: comments }, (_, i) => button(n.expand, text.expand(repliesOf(i + 1)), n)),
    more: button(n.more, text.more, n),
    collapse: button(`${n.more} ${n.collapse}`, text.collapse, n),
  }
  return `const N = ${JSON.stringify(n)};
const REPLIES = ${JSON.stringify(replyHtml)};
const BUTTONS = ${JSON.stringify(buttons)};
const shown = new Map();
function render(item) {
  const index = Number(item.dataset.id.slice(1)) - 1;
  const count = shown.get(index) || 0;
  item.querySelector('.' + N.replies).innerHTML = REPLIES[index].slice(0, count).join('');
  const actions = item.querySelector('.' + N.actions);
  if (count === 0) actions.innerHTML = BUTTONS.expand[index];
  else actions.innerHTML = (count < REPLIES[index].length ? BUTTONS.more : '') + BUTTONS.collapse;
}
// 框架式事件委托：只认事件路径上的 label。对 button 本身调 click() 时 label 不在路径上，什么都不发生。
document.addEventListener('click', event => {
  const label = event.target.closest('.' + N.label);
  if (!label) return;
  const btn = label.closest('button');
  const item = btn.closest('[data-id]');
  const index = Number(item.dataset.id.slice(1)) - 1;
  const count = shown.get(index) || 0;
  if (btn.classList.contains(N.collapse)) {
    shown.set(index, 0);
    render(item);
    return;
  }
  btn.disabled = true;
  setTimeout(() => {
    shown.set(index, Math.min(REPLIES[index].length, count + (count === 0 ? ${FIRST_BATCH} : ${MORE_BATCH})));
    render(item);
  }, ${LOAD_DELAY_MS});
});`
}

function pick<T extends string>(value: string | null, allowed: readonly T[], fallback: T): T {
  return allowed.find(item => item === value) ?? fallback
}

export async function GET(request: NextRequest): Promise<NextResponse> {
  const blocked = playgroundBlocked()
  if (blocked) return blocked

  const query = request.nextUrl.searchParams
  const comments = intParam(query.get('comments'), 10, 1, 40)
  const lang = pick(query.get('lang'), LANGS, 'zh')
  const n = CLASS_NAMES[pick(query.get('classes'), CLASS_STYLES, 'semantic')]
  const text = TEXT[lang]

  const items = Array.from({ length: comments }, (_, i) => commentHtml(i + 1, text, n)).join('\n')
  const body = `<header><h1>${text.title}</h1><p class="count">${text.count(totalRows(comments))}</p></header>
<main>
<div class="${n.list}">
${items}
</div>
</main>`

  return htmlResponse(
    renderShell(text.title, body, { style: style(n), script: script(n, text, comments) }).replace(
      '<html lang="zh">',
      `<html lang="${lang}">`
    )
  )
}
