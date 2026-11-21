import { NextRequest, NextResponse } from '../_lib/next-shim'

import { htmlResponse, intParam, playgroundBlocked, renderShell } from '../_lib/shell'

/**
 * 演练场 · 评论串是层层嵌套的 Web Component，回复默认折叠（pattern A6 的嵌套变体，叠加 D15 / D16）。
 *
 * 真站的形状（2026-11-11，视频站评论区）：整块评论区是一个组件，里面每条评论串又是组件，
 * 主评论、用户信息、正文、操作栏、回复区、每条回复各自再套一层 open shadow root，最深 5 层。
 * 主评论和回复用的是同一批 id（`#user-name`、`#contents`、`#pubdate`、`#like #count`），
 * 只有靠它们外面隔着 shadow root 的祖先（`#comment` / `#replies`）才分得开。
 *
 * - 回复默认只内联 0–2 条，其余在「共N条回复，点击查看」后面；有的评论一条都不内联。
 *   只有「点击查看」这个按钮组件有点击处理，点前面的「共N条回复，」或外层的 `#view-more` 没有反应。
 * - 点开后回复区整块重建：10 条以内全部显示、按钮消失；超过 10 条每页 10 条，
 *   出现这条评论自己的分页器「共P页 上一页 1 2 下一页」，翻页把上一页的回复换掉。
 *   上一页、页码、下一页是同一种按钮组件，没有 class 或属性能区分，只有文字不同；旁边的「收起」会把回复折回去。
 *   各评论串的回复请求快慢不同（100–900ms，回复最多的那几条翻页要 3000ms）；请求还没回来时再点一次「下一页」会越过中间那一页（那一页从不显示）。
 * - 评论串滚动加载：评论区底部的哨兵元素进入视口才加载下一批。旁边的推荐栏比评论区长得多，
 *   所以整页的底部远在评论区末尾下面：一下子跳到页面最底，哨兵从没在屏幕上出现过，什么都不会加载。
 * - 0 赞的评论不显示数字；页面 `scroll-behavior: smooth`；评论区上方有播放器占位，旁边有一列更长的推荐视频。
 *
 * 陷阱：选择器一个都不跨 shadow 边界的采集，分不开主评论和回复的同名字段；
 * 「一条评论串一行」时，展开后「共N条回复」消失，回复数读不到。
 *
 * query：
 * - threads：评论串总数（默认 30，1–200），第 i 条的回复数按 REPLY_PATTERN 循环
 * - perBatch：每批加载的评论串数（默认 10，1–50）
 * - lang：zh / en（默认 zh）
 *
 * 可采行数（主评论一行，每条回复一行）= threads + 全部回复数；页头的数字只数主评论。
 */

type Lang = 'zh' | 'en'
const LANGS: readonly Lang[] = ['zh', 'en']

/** 第 i 条评论串（从 1 起）的回复数和默认内联条数：下标 (i - 1) % 10。 */
const REPLY_PATTERN: readonly number[] = [7, 1, 0, 1, 0, 2, 12, 0, 3, 23]
const INLINE_PATTERN: readonly number[] = [2, 0, 0, 0, 0, 2, 2, 0, 1, 1]
const PAGE_SIZE = 10
const LOAD_DELAY_MS = 300
const RECOMMENDED = 40

function repliesOf(index: number): number {
  return REPLY_PATTERN[(index - 1) % REPLY_PATTERN.length]
}

function totalRows(threads: number): number {
  let total = threads
  for (let i = 1; i <= threads; i += 1) total += repliesOf(i)
  return total
}

const WORDS: Record<Lang, Record<string, string>> = {
  zh: {
    title: '视频页：评论区是嵌套组件',
    heading: '评论',
    user: '用户 ',
    comment: '评论 ',
    reply: '回复 ',
    commentTail: ' 条主评论的正文。',
    replyTail: ' 条回复的正文。',
    total: '共{n}条回复，',
    view: '点击查看',
    pages: '共{n}页',
    prev: '上一页',
    next: '下一页',
    hide: '收起',
    replyTo: '回复',
    end: '没有更多评论',
    video: '推荐视频 ',
  },
  en: {
    title: 'Video page: comments are nested components',
    heading: 'Comments',
    user: 'user ',
    comment: 'Comment ',
    reply: 'Reply ',
    commentTail: ': the body of this top-level comment.',
    replyTail: ': the body of this reply.',
    total: '{n} replies, ',
    view: 'view all',
    pages: '{n} pages',
    prev: 'Previous',
    next: 'Next',
    hide: 'Hide',
    replyTo: 'Reply',
    end: 'No more comments',
    video: 'Recommended video ',
  },
}

/** 放进 <script> 的 JSON：转义 `<`，文案里的标签不会提前结束脚本。 */
function scriptJson(value: unknown): string {
  return JSON.stringify(value).replace(/</g, '\\u003c')
}

function script(threads: number, perBatch: number, lang: Lang): string {
  const config = {
    threads,
    perBatch,
    replies: REPLY_PATTERN,
    inline: INLINE_PATTERN,
    pageSize: PAGE_SIZE,
    delay: LOAD_DELAY_MS,
    totalRows: totalRows(threads),
    words: WORDS[lang],
  }
  return `const CFG = ${scriptJson(config)};
const W = CFG.words;
function el(tag, props, kids) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(props || {})) {
    if (key === 'text') node.textContent = value;
    else node.setAttribute(key, value);
  }
  for (const kid of kids || []) node.append(kid);
  return node;
}
/** 一个组件：内容全部在它自己的 open shadow root 里。 */
function host(tag, props, kids) {
  const node = el(tag, props);
  const root = node.attachShadow({ mode: 'open' });
  root.append(el('style', { text: ':host { display: block; }' }));
  for (const kid of kids || []) root.append(kid);
  return node;
}
const repliesOf = i => CFG.replies[(i - 1) % CFG.replies.length];
const inlineOf = i => Math.min(CFG.inline[(i - 1) % CFG.inline.length], repliesOf(i));
const pad = n => String(n).padStart(2, '0');
const dateOf = (i, j) => '2026-10-' + pad(1 + (i % 27)) + ' ' + pad((i + j) % 24) + ':' + pad((i * 7 + j * 13) % 60);
const likesOf = (i, j) => (i * 7 + j * 11) % 9 === 0 ? 0 : (i * 37 + j * 53) % 480;
const uidOf = (i, j) => 100000 + i * 1000 + j;

function userInfo(name, uid, avatarInside) {
  const kids = [el('div', { id: 'info' }, [
    el('slot'),
    el('div', { id: 'user-name', 'data-user-profile-id': uid }, [el('a', { href: '/space/' + uid, target: '_blank', text: name })]),
    el('div', { id: 'user-level' }, [el('i', { text: 'LV' + (1 + (uid % 6)) })]),
  ])];
  if (avatarInside) kids.push(el('a', { id: 'user-avatar', href: '/space/' + uid, target: '_blank' }, [el('i', { class: 'face' })]));
  return host('user-info', {}, kids);
}
function richText(text) {
  return host('rich-text', {}, [el('p', { id: 'contents' }, [el('span', { text })])]);
}
function actions(i, j) {
  const likes = likesOf(i, j);
  return host('action-bar', {}, [
    el('div', { id: 'pubdate', text: dateOf(i, j) }),
    el('div', { id: 'like' }, [el('button', {}, [el('i', { class: 'icon' }), el('span', { id: 'count', text: likes ? String(likes) : '' })])]),
    el('div', { id: 'dislike' }, [el('button', {}, [el('i', { class: 'icon' })])]),
    el('div', { id: 'reply' }, [el('button', { text: W.replyTo })]),
  ]);
}
function commentBody(i) {
  const uid = uidOf(i, 0);
  return host('comment-body', { id: 'comment' }, [el('div', { id: 'body' }, [
    el('a', { id: 'user-avatar', href: '/space/' + uid, target: '_blank' }, [el('i', { class: 'face' })]),
    el('div', { id: 'main' }, [
      el('div', { id: 'header' }, [userInfo(W.user + i, uid, false)]),
      el('div', { id: 'content' }, [richText(W.comment + i + '：' + i + W.commentTail)]),
      el('div', { id: 'footer' }, [actions(i, 0)]),
    ]),
  ])]);
}
function replyItem(i, j) {
  return host('reply-item', {}, [el('div', { id: 'body' }, [
    el('div', { id: 'main' }, [userInfo(W.user + i + '-' + j, uidOf(i, j), true), richText(W.reply + i + '-' + j + '：' + j + W.replyTail)]),
    el('div', { id: 'footer' }, [actions(i, j)]),
  ])]);
}
// 按钮组件：文字是 light DOM 里的文本、经 slot 显示；要做什么只记在元素对象上，DOM 里没有任何区分。
function textButton(label, act) {
  const button = host('text-button', {}, [el('button', { class: 'button' }, [el('span', { class: 'button__label' }, [el('slot')])])]);
  button.append(label);
  button.act = act;
  // 和前面的文字排在同一行：外层容器的中心落在空白处，不在按钮上。
  button.shadowRoot.querySelector('style').textContent = ':host { display: inline-block; }';
  return button;
}
// 每条评论串的回复区：0 = 内联预览，k >= 1 = 第 k 页
const state = new Map();
// 正在加载的那一页（请求在途）
const queued = new Map();
// 各评论串的请求快慢不同：同一轮点下去，回来的先后不一样。回复最多的那几条（每 10 条里的最后一条）
// 翻页特别慢：别的评论串翻完一页、页面安静下来之后，它的下一页还在路上。
const delayOf = (i, turning) => (turning && i % 10 === 0 ? 3000 : 100 + (i % 5) * 200);
function renderReplies(i, list) {
  const total = repliesOf(i);
  const page = state.get(i) || 0;
  const contents = el('div', { id: 'expander-contents' });
  const footer = el('div', { id: 'expander-footer' });
  if (page === 0) {
    for (let j = 1; j <= inlineOf(i); j += 1) contents.append(replyItem(i, j));
    if (total > inlineOf(i)) footer.append(el('div', { id: 'view-more' }, [el('span', { text: W.total.replace('{n}', total) }), textButton(W.view, { to: 1 })]));
  } else {
    const pages = Math.ceil(total / CFG.pageSize);
    for (let j = (page - 1) * CFG.pageSize + 1; j <= Math.min(total, page * CFG.pageSize); j += 1) contents.append(replyItem(i, j));
    if (pages > 1) {
      // 上一页、页码、下一页是同一种按钮组件，只有文字不同；最后一页没有「下一页」。「收起」回到内联预览。
      const body = el('div', { id: 'pagination-body' });
      if (page > 1) body.append(textButton(W.prev, { step: -1 }));
      for (let p = 1; p <= pages; p += 1) body.append(textButton(String(p), { to: p }));
      if (page < pages) body.append(textButton(W.next, { step: 1 }));
      footer.append(el('div', { id: 'pagination' }, [
        el('div', { id: 'pagination-head', text: W.pages.replace('{n}', pages) }),
        body,
        el('div', { id: 'pagination-foot' }, [textButton(W.hide, { to: 0 })]),
      ]));
    }
  }
  contents.append(footer);
  list.shadowRoot.replaceChildren(el('style', { text: ':host { display: block; }' }), el('div', { id: 'expander' }, [contents]));
}
function threadItem(i) {
  const list = host('reply-list', {}, []);
  renderReplies(i, list);
  list.shadowRoot.addEventListener('click', event => {
    // 只有按钮组件在听：点「共N条回复，」那几个字或外层容器没有反应。
    const target = event.target.closest('text-button');
    if (!target || !target.act) return;
    // 上一页 / 下一页按「正在加载的那一页」再走一步：请求还在路上时再点一次，就会越过中间那一页，
    // 那一页从不显示。只有最后一次请求的结果会画出来。
    const from = queued.has(i) ? queued.get(i) : state.get(i) || 0;
    const pages = Math.ceil(repliesOf(i) / CFG.pageSize);
    const to = target.act.step ? Math.max(1, Math.min(pages, from + target.act.step)) : target.act.to;
    if (to === from) return;
    queued.set(i, to);
    setTimeout(() => {
      if (queued.get(i) !== to) return;
      queued.delete(i);
      state.set(i, to);
      renderReplies(i, list);
    }, delayOf(i, Boolean(target.act.step)));
  });
  return host('thread-item', { 'data-id': 't' + i }, [commentBody(i), el('div', { id: 'replies' }, [list]), el('div', { id: 'reply-container' })]);
}

const feed = el('div', { id: 'feed' });
const trigger = el('div', { class: 'trigger' });
const continuations = el('div', { id: 'continuations' }, [trigger]);
const header = host('thread-header', {}, [el('div', { id: 'navbar' }, [el('div', { id: 'title' }, [el('h2', { text: W.heading }), el('div', { id: 'count', text: String(CFG.threads) })])])]);
const app = document.querySelector('thread-app');
app.attachShadow({ mode: 'open' }).append(el('style', { text: '.trigger { height: 1px; }' }), el('div', { id: 'header' }, [header]), el('div', { id: 'contents' }, [feed, continuations]));

let loaded = 0;
let busy = false;
function addBatch() {
  const upTo = Math.min(CFG.threads, loaded + CFG.perBatch);
  for (let i = loaded + 1; i <= upTo; i += 1) feed.append(threadItem(i));
  loaded = upTo;
  if (loaded >= CFG.threads) {
    observer.disconnect();
    continuations.replaceChildren(el('div', { id: 'end', text: W.end }));
  }
}
const observer = new IntersectionObserver(entries => {
  if (busy || loaded >= CFG.threads || !entries.some(entry => entry.isIntersecting)) return;
  busy = true;
  setTimeout(() => {
    addBatch();
    busy = false;
    // 这一批太短、哨兵还在视口里时不会再有新的回调：重新观察一次。
    if (loaded < CFG.threads) {
      observer.unobserve(trigger);
      observer.observe(trigger);
    }
  }, CFG.delay);
});
addBatch();
if (loaded < CFG.threads) observer.observe(trigger);`
}

export async function GET(request: NextRequest): Promise<NextResponse> {
  const blocked = playgroundBlocked()
  if (blocked) return blocked

  const query = request.nextUrl.searchParams
  const threads = intParam(query.get('threads'), 30, 1, 200)
  const perBatch = intParam(query.get('perBatch'), 10, 1, 50)
  const lang = LANGS.find(item => item === query.get('lang')) ?? 'zh'
  const words = WORDS[lang]

  const recommended = Array.from(
    { length: RECOMMENDED },
    (_, i) => `<div class="video-card"><a href="/video/${i + 1}"><span class="title">${words.video}${i + 1}</span></a><span class="views">${((i + 3) * 17) % 90}.${i % 10}万</span></div>`
  ).join('\n')
  const body = `<div class="layout">
<div class="left">
<div class="player">player</div>
<h1>${words.title}</h1>
<div id="commentapp"><thread-app></thread-app></div>
</div>
<aside class="right"><div class="rec-list">
${recommended}
</div><div class="rec-more"></div></aside>
</div>`

  const style =
    'html { scroll-behavior: smooth; } .layout { display: flex; gap: 24px; } .left { flex: 1; min-width: 0; } ' +
    '.player { height: 420px; background: #111; color: #555; display: flex; align-items: center; justify-content: center; } ' +
    '.right { width: 260px; } .rec-more { height: 40000px; } .video-card { padding: 6px 0; border-bottom: 1px solid #eee; display: flex; justify-content: space-between; gap: 8px; } ' +
    'thread-app, thread-item, reply-item, comment-body, reply-list, user-info, rich-text, action-bar, thread-header { display: block; } ' +
    'thread-item { padding: 10px 0; border-bottom: 1px solid #eee; } text-button { color: #1a5fb4; cursor: pointer; }'

  return htmlResponse(
    renderShell(words.title, body, { style, script: script(threads, perBatch, lang) }).replace('<html lang="zh">', `<html lang="${lang}">`)
  )
}
