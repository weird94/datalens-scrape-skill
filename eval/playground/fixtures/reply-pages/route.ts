import { NextRequest, NextResponse } from '../_lib/next-shim'

import { htmlResponse, intParam, playgroundBlocked, renderShell } from '../_lib/shell'

/**
 * 演练场 · 每条评论的回复区各自翻页，翻页是整块替换（pattern D16）。
 *
 * 真站的形状（2026-11-10，视频站评论区）：主评论下先内联 3 条回复，回复多于 3 条时底下是
 * 「共N条回复，点击查看」；点开后回复区换成第 1 页，底下出现这条评论自己的分页器
 * 「共P页 上一页 1 2 … 下一页」。点「下一页」把回复区整块换成下一页（上一页的回复从 DOM 里消失），
 * 分页器还是同一个位置、同一个 class，到最后一页「下一页」才消失。
 *
 * 陷阱：只会「每个展开按钮点一次」的采集只拿到每条评论回复的第 1 页；只看最后 DOM 的采集只拿到最后一页。
 * 回复和主评论不是同一个 class，回复嵌在主评论里面。
 *
 * query：
 * - comments：主评论数（默认 8，1–40）；第 i 条的回复数按 REPLY_PATTERN 循环
 * - lang：zh / en（默认 zh）
 * - classes：semantic / hash（默认 semantic）
 * - render：replace / patch（默认 replace）。replace = 翻页时回复区整块重建（新元素）；
 *   patch = 像按位置复用节点的框架：回复元素和分页器都还是原来那几个，只换里面的文字，
 *   「下一页」始终是同一个元素，最后一页时隐藏。
 *
 * 可采行数（主评论一行，每条回复一行）= comments + 全部回复数，见 totalRows()。
 */

type Lang = 'zh' | 'en'
type ClassStyle = 'semantic' | 'hash'

const LANGS: readonly Lang[] = ['zh', 'en']
const CLASS_STYLES: readonly ClassStyle[] = ['semantic', 'hash']
type RenderMode = 'replace' | 'patch'
const RENDER_MODES: readonly RenderMode[] = ['replace', 'patch']

/** 第 i 条主评论（从 1 起）的回复数：REPLY_PATTERN[(i - 1) % 8]。 */
const REPLY_PATTERN: readonly number[] = [0, 2, 12, 0, 7, 3, 0, 23]
const INLINE = 3
const PAGE_SIZE = 5
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
  total: (n: number) => string
  view: string
  pages: (n: number) => string
  prev: string
  next: string
}

const TEXT: Record<Lang, LangText> = {
  zh: {
    title: '视频评论',
    count: n => `共 ${n} 条评论`,
    author: index => `用户 ${index}`,
    replyAuthor: (index, reply) => `用户 ${index}-${reply}`,
    body: index => `评论 ${index}：第 ${index} 条主评论的正文。`,
    replyBody: (index, reply) => `回复 ${index}-${reply}：回复第 ${index} 条评论的第 ${reply} 条回复。`,
    total: n => `共${n}条回复，`,
    view: '点击查看',
    pages: n => `共${n}页`,
    prev: '上一页',
    next: '下一页',
  },
  en: {
    title: 'Video comments',
    count: n => `${n} comments`,
    author: index => `user ${index}`,
    replyAuthor: (index, reply) => `user ${index}-${reply}`,
    body: index => `Comment ${index}: the body of top-level comment ${index}.`,
    replyBody: (index, reply) => `Reply ${index}-${reply}: reply number ${reply} to comment ${index}.`,
    total: n => `${n} replies, `,
    view: 'view all',
    pages: n => `${n} pages`,
    prev: 'Previous',
    next: 'Next',
  },
}

interface ClassNames {
  list: string
  item: string
  main: string
  author: string
  text: string
  box: string
  reply: string
  footer: string
  view: string
  pager: string
  pageBtn: string
  pageNum: string
  current: string
  prev: string
  next: string
}

const CLASS_NAMES: Record<ClassStyle, ClassNames> = {
  semantic: {
    list: 'comment-list',
    item: 'comment-item',
    main: 'comment-main',
    author: 'author',
    text: 'text',
    box: 'reply-box',
    reply: 'reply-item',
    footer: 'reply-footer',
    view: 'view-all',
    pager: 'reply-pager',
    pageBtn: 'pager-btn',
    pageNum: 'pager-num',
    current: 'current',
    prev: 'prev',
    next: 'next',
  },
  hash: {
    list: 'q3f8a1',
    item: 'm2c7e4',
    main: 'b9d1f6',
    author: 'h4a6c2',
    text: 'z8e3b7',
    box: 'v1f5d9',
    reply: 'j6b2a8',
    footer: 'e7c4f1',
    view: 'o5a9d3',
    pager: 'l2e8c6',
    pageBtn: 's9b3f4',
    pageNum: 'i4d7a2',
    current: 'c1e6b5',
    prev: 'w3a8e9',
    next: 'k7f2c0',
  },
}

function style(n: ClassNames): string {
  return (
    `.${n.item} { padding: 8px 0; border-bottom: 1px solid #eee; } ` +
    `.${n.author} { font-weight: 600; } .${n.text} { margin: 4px 0; } ` +
    `.${n.box} { margin-left: 32px; } .${n.reply} { padding: 4px 0; } ` +
    `.${n.footer}, .${n.pager} { color: #888; font-size: 13px; padding: 4px 0; } ` +
    `.${n.view}, .${n.pageBtn}, .${n.pageNum} { color: #1a5fb4; cursor: pointer; margin: 0 4px; } ` +
    `.${n.pageNum}.${n.current} { color: #000; cursor: default; }`
  )
}

function mainHtml(index: number, text: LangText, n: ClassNames): string {
  return `<div class="${n.main}"><span class="${n.author}">${text.author(index)}</span><p class="${n.text}">${text.body(index)}</p></div>`
}

function commentHtml(index: number, text: LangText, n: ClassNames): string {
  return `<div class="${n.item}" data-id="c${index}">${mainHtml(index, text, n)}<div class="${n.box}"></div></div>`
}

function script(n: ClassNames, text: LangText, comments: number, mode: RenderMode): string {
  const replies = Array.from({ length: comments }, (_, i) =>
    Array.from(
      { length: repliesOf(i + 1) },
      (_, j) =>
        `<div class="${n.reply}"><span class="${n.author}">${text.replyAuthor(i + 1, j + 1)}</span><p class="${n.text}">${text.replyBody(i + 1, j + 1)}</p></div>`
    )
  )
  const words = { total: Array.from({ length: comments }, (_, i) => text.total(repliesOf(i + 1))), view: text.view, prev: text.prev, next: text.next }
  const pagesWord = Array.from({ length: 10 }, (_, i) => text.pages(i + 1))
  return `const N = ${JSON.stringify(n)};
const REPLIES = ${JSON.stringify(replies)};
const W = ${JSON.stringify(words)};
const PAGES = ${JSON.stringify(pagesWord)};
const INLINE = ${INLINE};
const PATCH = ${mode === 'patch'};
// What each reply element holds (its markup without the outer div), for patching in place.
const REPLY_INNER = REPLIES.map(list => list.map(html => html.slice(html.indexOf('>') + 1, html.lastIndexOf('<'))));
const SIZE = ${PAGE_SIZE};
// 每条评论的回复区：0 = 内联预览，k >= 1 = 第 k 页
const state = new Map();
function pager(index, page) {
  const pages = Math.ceil(REPLIES[index].length / SIZE);
  let html = '<span>' + PAGES[pages - 1] + '</span>';
  if (page > 1 || PATCH) html += '<span class="' + N.pageBtn + ' ' + N.prev + '"' + (page > 1 ? '' : ' style="display:none"') + '>' + W.prev + '</span>';
  for (let p = 1; p <= pages; p += 1) {
    html += '<span class="' + N.pageNum + (p === page ? ' ' + N.current : '') + '" data-page="' + p + '">' + p + '</span>';
  }
  if (page < pages || PATCH) html += '<span class="' + N.pageBtn + ' ' + N.next + '"' + (page < pages ? '' : ' style="display:none"') + '>' + W.next + '</span>';
  return '<div class="' + N.pager + '">' + html + '</div>';
}
function render(item) {
  const index = Number(item.dataset.id.slice(1)) - 1;
  const all = REPLIES[index];
  const page = state.get(index) || 0;
  const box = item.querySelector('.' + N.box);
  if (page === 0) {
    const footer = all.length > INLINE
      ? '<div class="' + N.footer + '">' + W.total[index] + '<span class="' + N.view + '">' + W.view + '</span></div>'
      : '';
    box.innerHTML = all.slice(0, INLINE).join('') + footer;
  } else if (!PATCH || !box.querySelector('.' + N.pager)) {
    box.innerHTML = all.slice((page - 1) * SIZE, page * SIZE).join('') + pager(index, page);
  } else {
    // Patch in place: the reply elements and the pager stay, only what they show changes.
    const want = REPLY_INNER[index].slice((page - 1) * SIZE, page * SIZE);
    const items = Array.from(box.querySelectorAll('.' + N.reply));
    want.forEach((inner, i) => {
      let el = items[i];
      if (!el) {
        el = document.createElement('div');
        el.className = N.reply;
        box.insertBefore(el, box.querySelector('.' + N.pager));
      }
      el.innerHTML = inner;
    });
    items.slice(want.length).forEach(el => el.remove());
    const pages = Math.ceil(all.length / SIZE);
    const bar = box.querySelector('.' + N.pager);
    bar.querySelectorAll('.' + N.pageNum).forEach(num => num.classList.toggle(N.current, Number(num.dataset.page) === page));
    const prev = bar.querySelector('.' + N.prev);
    const next = bar.querySelector('.' + N.next);
    if (prev) prev.style.display = page > 1 ? '' : 'none';
    if (next) next.style.display = page < pages ? '' : 'none';
  }
}
document.querySelectorAll('[data-id]').forEach(render);
document.addEventListener('click', event => {
  const target = event.target.closest('.' + N.view + ', .' + N.pageBtn + ', .' + N.pageNum);
  if (!target || target.classList.contains(N.current)) return;
  const item = target.closest('[data-id]');
  const index = Number(item.dataset.id.slice(1)) - 1;
  const page = state.get(index) || 0;
  let to = 1;
  if (target.classList.contains(N.pageNum)) to = Number(target.dataset.page);
  else if (target.classList.contains(N.next)) to = page + 1;
  else if (target.classList.contains(N.prev)) to = page - 1;
  setTimeout(() => {
    state.set(index, to);
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
  const comments = intParam(query.get('comments'), 8, 1, 40)
  const lang = pick(query.get('lang'), LANGS, 'zh')
  const n = CLASS_NAMES[pick(query.get('classes'), CLASS_STYLES, 'semantic')]
  const text = TEXT[lang]
  const mode = pick(query.get('render'), RENDER_MODES, 'replace')

  const items = Array.from({ length: comments }, (_, i) => commentHtml(i + 1, text, n)).join('\n')
  const body = `<header><h1>${text.title}</h1><p class="count">${text.count(totalRows(comments))}</p></header>
<main>
<div class="${n.list}">
${items}
</div>
</main>`

  return htmlResponse(
    renderShell(text.title, body, { style: style(n), script: script(n, text, comments, mode) }).replace(
      '<html lang="zh">',
      `<html lang="${lang}">`
    )
  )
}
