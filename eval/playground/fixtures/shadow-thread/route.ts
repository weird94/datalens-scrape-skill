import { NextRequest, NextResponse } from '../_lib/next-shim'

import { htmlResponse, intParam, playgroundBlocked, renderShell } from '../_lib/shell'

/**
 * 演练场 · 内容在 Web Component 的 shadow root 里（pattern A6）。
 *
 * 真站的形状（2026-11-10，Reddit 帖子评论区一类用 Lit 之类组件库渲染的页面）：每条评论是一个自定义元素，
 * 作者、时间、赞数画在它自己的 open shadow root 里，正文是 light DOM 的子元素、经 `<slot>` 投进去；
 * 帖子头（含「共 N 条评论」）和「加载更多」按钮也各自在组件的 shadow root 里。
 * `document.querySelectorAll` 和 `innerText` 都停在 shadow 边界：只读 light DOM 的采集看得见行（自定义元素本身），
 * 却读不到作者 / 时间 / 赞数，看不到页面自称的总数，也找不到加载更多按钮。
 *
 * 首批由服务端用声明式 shadow DOM（`<template shadowrootmode="open">`）输出，之后每批由脚本 attachShadow 生成，
 * 两种来源都要覆盖。
 *
 * query：
 * - total：评论总数（默认 30，1–200），页头「共 N 条评论」与之相等，全部可加载
 * - perBatch：每批条数（默认 10，1–50）
 * - lang：zh / en（默认 zh，非法值回落到 zh）
 *
 * 加载完最后一批后，`<load-more>` 的 state 变成 done、按钮换成到底文案。可采行数 = total。
 */

type Lang = 'zh' | 'en'

const LANGS: readonly Lang[] = ['zh', 'en']

/** 点击「加载更多」到下一批插入之间的延迟，模拟一次请求。 */
const LOAD_DELAY_MS = 300

interface LangText {
  title: string
  count: (total: number) => string
  author: (index: number) => string
  time: (index: number) => string
  score: (index: number) => string
  body: (index: number) => string
  more: string
  end: string
}

const TEXT: Record<Lang, LangText> = {
  zh: {
    title: '讨论帖：大家的周末都怎么过',
    count: total => `共 ${total} 条评论`,
    author: index => `用户 ${index}`,
    time: index => `${(index % 23) + 1} 小时前`,
    score: index => `${(index * 7) % 97} 赞`,
    body: index => `评论 ${index}：这是第 ${index} 条评论的正文。`,
    more: '加载更多评论',
    end: '没有更多评论了',
  },
  en: {
    title: 'Thread: how do you spend your weekend',
    count: total => `${total} comments`,
    author: index => `user_${index}`,
    time: index => `${(index % 23) + 1}h ago`,
    score: index => `${(index * 7) % 97} points`,
    body: index => `Comment ${index}: the body of comment number ${index}.`,
    more: 'Load more comments',
    end: 'No more comments',
  },
}

const CARD_STYLE =
  '<style>:host { display: block; padding: 8px 0; border-bottom: 1px solid #eee; } .author { font-weight: 600; } footer { color: #666; }</style>'
const HEADER_STYLE = '<style>:host { display: block; margin-bottom: 16px; } .count { color: #666; }</style>'
const MORE_STYLE = '<style>:host { display: block; margin-top: 16px; } button { padding: 4px 8px; }</style>'

/** 一条评论的 shadow root 内容：作者、时间、赞数只在这里；正文经 slot 从 light DOM 投进来。 */
function cardShadow(index: number, text: LangText): string {
  return `${CARD_STYLE}<header><span class="author">${text.author(index)}</span> · <span class="time">${text.time(index)}</span></header><div class="body"><slot name="body"></slot></div><footer><span class="score">${text.score(index)}</span></footer>`
}

function cardHtml(index: number, text: LangText): string {
  return `<comment-card data-id="c${index}"><template shadowrootmode="open">${cardShadow(index, text)}</template><p slot="body">${text.body(index)}</p></comment-card>`
}

function moreShadow(done: boolean, text: LangText): string {
  return done
    ? `${MORE_STYLE}<span class="end">${text.end}</span>`
    : `${MORE_STYLE}<button class="more" type="button">${text.more}</button>`
}

/** 放进 <script> 的 JSON：转义 `<`，正文里的标签不会提前结束脚本。 */
function scriptJson(value: unknown): string {
  return JSON.stringify(value).replace(/</g, '\\u003c')
}

/** 后续批次：点 shadow root 里的按钮，延迟后追加 attachShadow 生成的卡片；最后一批后标记 done。 */
function loadMoreScript(batches: { id: string; shadow: string; body: string }[][], doneShadow: string): string {
  return `const BATCHES = ${scriptJson(batches)};
const DONE_SHADOW = ${scriptJson(doneShadow)};
const list = document.getElementById('comments');
const more = document.querySelector('load-more');
let next = 0;
let busy = false;
function addCard(card) {
  const el = document.createElement('comment-card');
  el.dataset.id = card.id;
  el.attachShadow({ mode: 'open' }).innerHTML = card.shadow;
  const body = document.createElement('p');
  body.slot = 'body';
  body.textContent = card.body;
  el.append(body);
  list.append(el);
}
if (more && more.shadowRoot) {
  more.shadowRoot.addEventListener('click', event => {
    if (busy || next >= BATCHES.length || !event.target.closest('button')) return;
    busy = true;
    setTimeout(() => {
      BATCHES[next].forEach(addCard);
      next += 1;
      busy = false;
      if (next >= BATCHES.length) {
        more.setAttribute('state', 'done');
        more.shadowRoot.innerHTML = DONE_SHADOW;
      }
    }, ${LOAD_DELAY_MS});
  });
}`
}

export async function GET(request: NextRequest): Promise<NextResponse> {
  const blocked = playgroundBlocked()
  if (blocked) return blocked

  const query = request.nextUrl.searchParams
  const total = intParam(query.get('total'), 30, 1, 200)
  const perBatch = intParam(query.get('perBatch'), 10, 1, 50)
  const lang = LANGS.find(item => item === query.get('lang')) ?? 'zh'
  const text = TEXT[lang]

  const indexes = Array.from({ length: total }, (_, i) => i + 1)
  const first = indexes.slice(0, perBatch)
  const later: { id: string; shadow: string; body: string }[][] = []
  for (let start = perBatch; start < total; start += perBatch) {
    later.push(
      indexes.slice(start, start + perBatch).map(index => ({
        id: `c${index}`,
        shadow: cardShadow(index, text),
        body: text.body(index),
      }))
    )
  }
  const done = later.length === 0

  const body = `<thread-header><template shadowrootmode="open">${HEADER_STYLE}<h1>${text.title}</h1><div class="meta"><span class="count">${text.count(total)}</span></div></template></thread-header>
<main>
<comment-list id="comments">
${first.map(index => cardHtml(index, text)).join('\n')}
</comment-list>
<load-more state="${done ? 'done' : 'more'}"><template shadowrootmode="open">${moreShadow(done, text)}</template></load-more>
</main>
<footer>footer</footer>`

  return htmlResponse(
    renderShell(text.title, body, {
      style: 'comment-list { display: block; }',
      script: loadMoreScript(later, moreShadow(true, text)),
    }).replace('<html lang="zh">', `<html lang="${lang}">`)
  )
}
