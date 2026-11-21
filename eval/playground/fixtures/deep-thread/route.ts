import { NextRequest, NextResponse } from '../_lib/next-shim'

import { htmlResponse, intParam, playgroundBlocked, renderShell } from '../_lib/shell'

/**
 * 演练场 · 大体量嵌套评论树，界面零件全是 Web Component（pattern A6 + D8，规模是这个 case 的重点）。
 *
 * 真站的形状（2026-11-12，登录态社区帖子评论区，侧栏 AI 采集「采集评论」采到 15 行后停滞 3 分钟、重新分析 5 分钟不返回）：
 * - 评论元素本身没有 shadow root，作者 / 时间 / 正文都在 light DOM；但每条评论里挂着 8 个左右带 open shadow root 的小组件
 *   （徽章、身份标签、投票条、分享按钮、更多菜单、悬浮提示……），赞数只画在投票条的 shadow root 里。
 *   一条评论自身约 130 个元素；整页 2100+ 个 shadow root、3 万个元素，其中约 500 个 shadow root 在评论区外。
 * - 回复嵌在父评论里面（最深 6 层），不是平铺的；回复区末尾是「N more replies」加载器（自带 shadow root，按钮是投进去的
 *   light DOM 子元素），点了按钮才插入回复。回复区容器本身每条评论都有（没有回复时是空的），点它没有任何反应。
 *   回复区旁边还有一个同样文字的「N more replies」兜底链接（链到这条评论自己的页面），排版了但画出来是 0×0。
 * - 主评论之间穿插空的广告位；主评论列表末尾是一个加载器，滚进视口（IntersectionObserver）才加载下一批，没有按钮。
 *
 * 首屏由服务端用声明式 shadow DOM 输出；之后的批次和回复用 setHTMLUnsafe 解析同样的 HTML，两种来源都要覆盖。
 *
 * query：
 * - top：主评论总数（默认 80，1–300）
 * - first：首屏主评论数（默认 58，1–300）
 * - perBatch：之后每批主评论数（默认 11，1–100）
 * - clutter：评论区外的 shadow 组件个数（默认 500，0–2000）
 * - lang：zh / en（默认 en，非法值回落到 en）
 *
 * 可采主评论数 = top；加载完最后一批，主列表末尾的加载器换成到底文案。
 */

type Lang = 'zh' | 'en'

const LANGS: readonly Lang[] = ['en', 'zh']

/** 「N more replies」点击 / 主列表加载器进入视口，到插入之间的延迟，模拟一次请求。 */
const LOAD_DELAY_MS = 400
/** 回复嵌套的最深层数（主评论是第 0 层）。 */
const MAX_DEPTH = 6

interface LangText {
  title: string
  count: (total: number) => string
  author: (id: string) => string
  time: (n: number) => string
  body: (id: string, n: number) => string
  moreReplies: (n: number) => string
  reply: string
  share: string
  end: string
}

const TEXT: Record<Lang, LangText> = {
  en: {
    title: 'Discussion: what changed your mind this year',
    count: total => `${total} comments`,
    author: id => `member_${id}`,
    time: n => `${(n % 6) + 1}d ago`,
    body: (id, n) =>
      `Reply ${id}: ${'I think the answer depends on where you look and who you ask. '.repeat((n % 3) + 1)}`,
    moreReplies: n => `${n} more ${n === 1 ? 'reply' : 'replies'}`,
    reply: 'Reply',
    share: 'Share',
    end: 'No more comments',
  },
  zh: {
    title: '讨论：今年什么事改变了你的想法',
    count: total => `共 ${total} 条评论`,
    author: id => `网友_${id}`,
    time: n => `${(n % 6) + 1} 天前`,
    body: (id, n) => `回复 ${id}：${'答案取决于你看哪里、问谁。'.repeat((n % 3) + 1)}`,
    moreReplies: n => `还有 ${n} 条回复`,
    reply: '回复',
    share: '分享',
    end: '没有更多评论了',
  },
}

/** 一条评论（含其回复子树）的确定性形状：id、序号、深度，以及首屏内联几条回复、点开「更多」后再给几条。 */
interface Node {
  id: string
  n: number
  depth: number
  inline: Node[]
  hidden: Node[]
}

function buildNode(id: string, n: number, depth: number): Node {
  const node: Node = { id, n, depth, inline: [], hidden: [] }
  if (depth >= MAX_DEPTH) return node
  // 主评论回复多、越深越少；约三分之一的评论在内联回复之外还藏着一批
  const inlineCount = depth === 0 ? n % 4 : depth < 3 ? (n % 2 === 0 ? 1 : 0) : n % 3 === 0 ? 1 : 0
  const hiddenCount = depth <= 1 && n % 3 === 1 ? (n % 7) + 1 : 0
  for (let i = 1; i <= inlineCount; i++) node.inline.push(buildNode(`${id}.${i}`, n * 3 + i, depth + 1))
  for (let i = 1; i <= hiddenCount; i++)
    node.hidden.push(buildNode(`${id}.${inlineCount + i}`, n * 5 + i, depth + 1))
  return node
}

const sr = (inner: string) => `<template shadowrootmode="open">${inner}</template>`

/** 一个带 shadow root 的小组件，shadow 里是几层包装 + 一个按钮，模拟组件库的按钮外壳。 */
function widget(tag: string, label: string): string {
  return `<${tag}>${sr(`<style>:host{display:inline-block}</style><span class="shell"><span class="inner"><button type="button"><span class="icon"><svg width="12" height="12"><path d="M0 0h12v12H0z"/></svg></span><span class="label">${label}</span></button></span></span>`)}</${tag}>`
}

function score(n: number): number {
  return (n * 37) % 800
}

/** 投票条：赞数只在 shadow root 里；分享按钮是嵌在里面的又一层 shadow 组件。 */
function actionBar(node: Node, text: LangText): string {
  return `<ui-action-bar slot="actions">${sr(
    `<div class="row"><div class="votes"><vote-pill>${sr(
      `<span class="pill"><button aria-label="up" type="button"><svg width="12" height="12"><path d="M6 0l6 12H0z"/></svg></button><span class="count">${score(node.n)}</span><button aria-label="down" type="button"><svg width="12" height="12"><path d="M0 0h12L6 12z"/></svg></button></span>`
    )}</vote-pill></div><slot name="reply"></slot>${widget('ui-share', text.share)}${widget('ui-overflow', '…')}${widget('ui-tooltip', '')}</div>`
  )}<span slot="reply"><button class="reply-btn" type="button"><span>${text.reply}</span></button></span></ui-action-bar>`
}

function moreLoader(node: Node, text: LangText): string {
  if (node.hidden.length === 0) return ''
  const label = text.moreReplies(node.hidden.length)
  // 加载器自己有 shadow root（只放 slot），按钮是投进去的 light DOM 子元素——真站就是这样
  return `<ui-loader class="more-replies" data-for="${node.id}" mode="action">${sr(
    '<style>:host{display:block}</style><slot></slot>'
  )}<input type="hidden" name="cursor" value="${node.id}"><div class="wrap"><button type="button"><span class="icon">+</span><span class="label">${label}</span></button></div></ui-loader>`
}

/**
 * 「N more replies」的无 JS 兜底：同样的文字，链到这条评论自己的页面；排版了但画出来是 0×0（真站如此）。
 * 点它会离开页面，正确的做法是点回复区里那个按钮。
 */
function foldedLink(node: Node, text: LangText): string {
  if (node.hidden.length === 0) return ''
  return `<div class="fold-more"><div data-more-replies-link><a href="/dev-fixtures/playground/deep-thread?focus=${encodeURIComponent(node.id)}">${text.moreReplies(node.hidden.length)}</a></div></div>`
}

function commentHtml(node: Node, text: LangText, extraClass = ''): string {
  const author = text.author(node.id)
  // 每条评论自己的一层层布局盒子：真站的评论约 130 个元素，大头是这些包装
  const meta = `<div class="meta"><div class="meta-a"><div class="meta-b"><div class="meta-c"><span class="author-wrap"><div class="author-row"><a class="author" href="/u/${node.id}"><span class="name-wrap"><span class="name">${author}</span></span></a></div></span><span class="dot">•</span><a class="time-link" href="#${node.id}"><time>${text.time(node.n)}</time></a>${widget('ui-badges', '')}${widget('ui-flair', '')}</div></div></div></div>`
  const avatar = `<div class="avatar"><span class="av-wrap"><div class="av-row"><a class="av" href="/u/${node.id}"><span class="av-a"><span class="av-b"><img alt="" width="24" height="24" src="data:image/gif;base64,R0lGODlhAQABAAAAACw="></span></span></a></div></span></div>`
  const body = `<div class="body"><div class="body-in"><p>${text.body(node.id, node.n)}</p></div></div>`
  const children = `<div class="children" data-children-of="${node.id}">${node.inline.map(child => commentHtml(child, text)).join('')}${moreLoader(node, text)}</div>${foldedLink(node, text)}`
  return `<thread-reply${extraClass ? ` class="${extraClass}"` : ''} depth="${node.depth}" data-id="${node.id}" author="${author}"><details open role="article" aria-label="${author}"><summary><div class="head"><div class="gutter"></div>${avatar}</div>${meta}</summary><div class="grid"><div class="line"></div><div class="spacer"><div class="hl"></div></div><div class="content">${body}</div><div class="actions-wrap"><div class="hl"></div>${actionBar(node, text)}</div>${children}</div></details></thread-reply>`
}

/**
 * topClass：只给顶层评论加的类（2026-11-12 真站识别出的条目选择器带着 `col-start-2` 这类布局类，是否只有顶层评论有未核实，两种都要测）。识别出来的条目选择器带上它，就选不中嵌套回复——
 * 递归要靠结构认出来，不能靠条目选择器恰好写得宽。
 */
function topLevelHtml(node: Node, text: LangText, topClass: string): string {
  return `${commentHtml(node, text, topClass)}<promo-slot></promo-slot>`
}

/** 这条评论连同所有回复（含点「N more replies」才出来的）一共几条 */
function countAll(node: Node): number {
  return 1 + [...node.inline, ...node.hidden].reduce((sum, child) => sum + countAll(child), 0)
}

/** 放进 <script> 的 JSON：转义 `<`，正文里的标签不会提前结束脚本。 */
function scriptJson(value: unknown): string {
  return JSON.stringify(value).replace(/</g, '\\u003c')
}

function collectHidden(node: Node, text: LangText, out: Record<string, string[]>): void {
  if (node.hidden.length > 0) out[node.id] = node.hidden.map(child => commentHtml(child, text))
  for (const child of [...node.inline, ...node.hidden]) collectHidden(child, text, out)
}

/**
 * replyBatch：点一次「N more replies」只插这么多条，剩下的留在加载器上、文字改成剩余条数（真站大楼就是分批加载的，
 * 一条楼要点好几次）。0 = 一次全插完。
 */
function pageScript(
  batches: string[],
  hidden: Record<string, string[]>,
  endHtml: string,
  replyBatch: number,
  moreLabel: { one: string; many: string }
): string {
  return `const BATCHES = ${scriptJson(batches)};
const HIDDEN = ${scriptJson(hidden)};
const REPLY_BATCH = ${replyBatch};
const MORE_LABEL = ${scriptJson(moreLabel)};
const END_HTML = ${scriptJson(endHtml)};
function parse(html) {
  const tmp = document.createElement('div');
  tmp.setHTMLUnsafe(html);
  return [...tmp.childNodes];
}
// 「N more replies」：点加载器 shadow root 里的按钮，延迟后把回复插到加载器前面；全插完加载器移除，分批时留下剩余条数
document.addEventListener('click', event => {
  const loader = event.composedPath().find(el => el instanceof Element && el.matches('ui-loader.more-replies'));
  if (!loader || loader.dataset.busy) return;
  if (!event.composedPath().some(el => el instanceof Element && el.tagName === 'BUTTON')) return;
  loader.dataset.busy = '1';
  setTimeout(() => {
    const all = HIDDEN[loader.dataset.for] || [];
    const offset = Number(loader.dataset.offset || 0);
    const take = REPLY_BATCH > 0 ? REPLY_BATCH : all.length;
    loader.before(...parse(all.slice(offset, offset + take).join('')));
    const rest = all.length - offset - take;
    if (rest <= 0) {
      loader.remove();
      return;
    }
    loader.dataset.offset = String(offset + take);
    loader.querySelector('.label').textContent = rest === 1 ? MORE_LABEL.one : MORE_LABEL.many.replace('{n}', String(rest));
    delete loader.dataset.busy;
  }, ${LOAD_DELAY_MS});
}, true);
// 主列表末尾的加载器：进入视口才加载下一批
const list = document.getElementById('top-list');
const tail = document.getElementById('top-more');
let next = 0;
let busy = false;
const io = new IntersectionObserver(entries => {
  if (!entries.some(entry => entry.isIntersecting) || busy || next >= BATCHES.length) return;
  busy = true;
  setTimeout(() => {
    tail.before(...parse(BATCHES[next]));
    next += 1;
    busy = false;
    if (next >= BATCHES.length) {
      io.disconnect();
      tail.setAttribute('state', 'done');
      tail.setHTMLUnsafe(END_HTML);
    } else {
      // 加载器一直在视口里时 IO 不会再报，重新观察一次
      io.unobserve(tail);
      io.observe(tail);
    }
  }, ${LOAD_DELAY_MS});
});
io.observe(tail);`
}

/** 评论区外的组件：侧栏、导航、弹层模板之类，各自带 shadow root。 */
function clutterHtml(count: number): string {
  const tags = ['ui-menu', 'ui-popper', 'ui-dropdown', 'ui-progress', 'ui-radio']
  const items = Array.from({ length: count }, (_, i) => widget(tags[i % tags.length], i % 4 === 0 ? `item ${i}` : ''))
  return `<aside class="rail"><div class="rail-in">${items.join('')}</div></aside>`
}

export async function GET(request: NextRequest): Promise<NextResponse> {
  const blocked = playgroundBlocked()
  if (blocked) return blocked

  const query = request.nextUrl.searchParams
  const top = intParam(query.get('top'), 80, 1, 300)
  const first = Math.min(top, intParam(query.get('first'), 58, 1, 300))
  const perBatch = intParam(query.get('perBatch'), 11, 1, 100)
  const clutter = intParam(query.get('clutter'), 500, 0, 2000)
  const lang = LANGS.find(item => item === query.get('lang')) ?? 'en'
  const topClass = (query.get('topClass') ?? '').replace(/[^\w -]/g, '').trim()
  const replyBatch = intParam(query.get('replyBatch'), 0, 0, 50)
  const text = TEXT[lang]

  const nodes = Array.from({ length: top }, (_, i) => buildNode(String(i + 1), i + 1, 0))
  const hidden: Record<string, string[]> = {}
  nodes.forEach(node => collectHidden(node, text, hidden))
  const batches: string[] = []
  for (let start = first; start < top; start += perBatch) {
    batches.push(
      nodes
        .slice(start, start + perBatch)
        .map(node => topLevelHtml(node, text, topClass))
        .join('')
    )
  }
  const done = batches.length === 0
  const endHtml = `<span class="end">${text.end}</span>`

  const body = `<div class="layout">${clutterHtml(Math.floor(clutter / 2))}
<main>
<div class="post"><h1>${text.title}</h1><post-stats>${sr(`<span class="count">${text.count(top)}</span>`)}</post-stats></div>
<reply-tree total="${top}" total-all="${nodes.reduce((sum, node) => sum + countAll(node), 0)}">
<section id="top-list">
${nodes
  .slice(0, first)
  .map(node => topLevelHtml(node, text, topClass))
  .join('\n')}
<ui-loader id="top-more" mode="lazy" state="${done ? 'done' : 'more'}">${done ? endHtml : '<input type="hidden" name="cursor" value="top"><div class="spin"></div>'}</ui-loader>
</section>
</reply-tree>
</main>
${clutterHtml(clutter - Math.floor(clutter / 2))}</div>`

  return htmlResponse(
    renderShell(text.title, body, {
      style:
        'thread-reply { display: block; } thread-reply thread-reply { margin-left: 24px; } details > summary { list-style: none; } .meta, .meta-a, .meta-b, .meta-c { display: inline; } .rail { display: none; } promo-slot { display: block; height: 4px; } ui-loader { display: block; min-height: 24px; } .fold-more, .fold-more * { display: block; width: 0; height: 0; overflow: hidden; font-size: 0; margin: 0; padding: 0; }',
      script: pageScript(batches, hidden, endHtml, replyBatch, {
        one: text.moreReplies(1),
        many: text.moreReplies(999).replace('999', '{n}'),
      }),
    }).replace('<html lang="zh">', `<html lang="${lang}">`)
  )
}
