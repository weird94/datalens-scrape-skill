import { NextRequest, NextResponse } from '../_lib/next-shim'

import { htmlResponse, intParam, playgroundBlocked, renderShell } from '../_lib/shell'

import { COPY, type Copy, type ExcerptPost, excerptPosts, type Lang } from './posts'

/**
 * 演练场 · 卡片点「展开阅读」就地展开，作者和发表时间只在展开后出现（pattern C13）。
 *
 * query：
 * - posts：帖子总数（默认 24，6–60）
 * - batch：每批几张卡（默认 8，2–20）。先出一批，滚到底 300ms 后再追加一批，出完显示「没有更多了」。
 * - lang：文案语言 zh | en（默认 zh）。只换文案，结构与陷阱不变。
 * - cls：class 命名 semantic | hash（默认 semantic）。
 * 非法的 lang / cls 回落到默认值。
 *
 * 形状：信息流卡片。折叠时：标题链接、摘要「<作者>：<正文开头>…」、「展开阅读」按钮、操作栏（点赞 N、N 条评论）；
 * 没有作者行，也没有发表时间。点「展开阅读」250ms 后卡片就地重画：作者行（头像、作者链接，每 3 篇有一个徽章）、
 * 完整正文（前面没有「<作者>：」）、「发表于 …」、「收起」按钮（与「展开阅读」不同 class）。
 * 每第 4 篇的正文里有「&」，摘要按转义后的 HTML 截断，截断点落在「&amp;」中间，摘要以「&am…」结尾。
 * 每第 5 篇是一句话的短回答，比截断长度还短，摘要照样是「<作者>：<整句>…」；其中每第 10 篇不带「…」：「<作者>：<整句>」。
 *
 * 陷阱：采集器先读到折叠的卡（作者、时间为空），点开后同一张卡重读，正文从「作者：摘要…」变成不带前缀的全文。
 * 只认「新文本以旧文本开头」为变长的合并规则会把它当成内容被换掉，保留第一次读到的值——作者、头像、时间整列为空，
 * 正文停在摘要。（形状来自 2026-11-18 某问答社区首页推荐流；类名、按钮与徽章文案、正文都是编的，不取自那个站。）
 */

type ClassStyle = 'semantic' | 'hash'

const LANGS: readonly Lang[] = ['zh', 'en']
const CLASS_STYLES: readonly ClassStyle[] = ['semantic', 'hash']


interface ClassNames {
  feed: string
  card: string
  title: string
  byline: string
  avatar: string
  writer: string
  badge: string
  body: string
  text: string
  open: string
  close: string
  time: string
  bar: string
  vote: string
  comment: string
  status: string
}

const CLASS_NAMES: Record<ClassStyle, ClassNames> = {
  semantic: {
    feed: 'feed',
    card: 'post-card',
    title: 'post-title',
    byline: 'byline',
    avatar: 'avatar',
    writer: 'writer',
    badge: 'badge',
    body: 'post-body',
    text: 'post-text',
    open: 'read-more',
    close: 'read-less',
    time: 'post-time',
    bar: 'actions',
    vote: 'vote',
    comment: 'comment-count',
    status: 'feed-status',
  },
  hash: {
    feed: 'q7f2k1',
    card: 'c3m8x0',
    title: 'h5t1p9',
    byline: 'b2y6n4',
    avatar: 'a9v3r7',
    writer: 'w4k8e2',
    badge: 'g6d1s5',
    body: 'r8x2c6',
    text: 't1z5q3',
    open: 'o7e4m9',
    close: 'l3s9f1',
    time: 'm5w2j8',
    bar: 'k2a7u4',
    vote: 'v6p0h3',
    comment: 'n8c4b6',
    status: 'z1u5y7',
  },
}


function styleFor(names: ClassNames): string {
  return `.${names.card} { padding: 12px 0; border-bottom: 1px solid #eee; }
.${names.title} { font-size: 16px; margin: 0 0 6px; }
.${names.byline} { display: flex; gap: 8px; align-items: center; margin-bottom: 6px; }
.${names.avatar} { width: 24px; height: 24px; border-radius: 50%; background: #ddd; }
.${names.badge} { color: #888; font-size: 12px; }
.${names.open}, .${names.close} { border: 0; background: none; color: #1a5fb4; cursor: pointer; padding: 0 4px; }
.${names.time} { color: #888; font-size: 12px; margin-top: 6px; }
.${names.bar} { display: flex; gap: 12px; margin-top: 8px; }
.${names.bar} button { border: 1px solid #ccd; background: #f5f7fb; padding: 2px 10px; }
.${names.status} { padding: 24px 0 600px; color: #888; text-align: center; }`
}

function scriptFor(names: ClassNames, copy: Copy, posts: ExcerptPost[], batch: number): string {
  const strings = {
    open: copy.open,
    close: copy.close,
    end: copy.end,
    loading: copy.loading,
    upvote: posts.map((post) => copy.upvote(post.upvotes)),
    comments: posts.map((post) => copy.comments(post.comments)),
    posted: posts.map((post) => copy.posted(post.posted)),
  }
  return `var NAMES = ${JSON.stringify(names)};
var POSTS = ${JSON.stringify(posts)};
var TEXT = ${JSON.stringify(strings)};
var BATCH = ${batch};
var feed = document.querySelector('.' + NAMES.feed);
var statusLine = document.querySelector('.' + NAMES.status);
var shown = 0;
var loading = false;
function bar(index) {
  return '<div class="' + NAMES.bar + '"><button type="button" class="' + NAMES.vote + '">' + TEXT.upvote[index] + '</button>' +
    '<button type="button" class="' + NAMES.comment + '">' + TEXT.comments[index] + '</button></div>';
}
function title(post) {
  return '<h2 class="' + NAMES.title + '"><a href="' + post.link + '">' + post.title + '</a></h2>';
}
function collapsed(card, post, index) {
  card.innerHTML = title(post) +
    '<div class="' + NAMES.body + '"><span class="' + NAMES.text + '"></span>' +
    '<button type="button" class="' + NAMES.open + '">' + TEXT.open + '</button></div>' + bar(index);
  // 摘要是按转义后的 HTML 截的，原样当文字显示（截断点在实体中间时就露出「&am…」）。
  card.querySelector('.' + NAMES.text).textContent = post.excerpt;
  card.querySelector('.' + NAMES.open).addEventListener('click', function () {
    setTimeout(function () { opened(card, post, index); }, 250);
  });
}
function opened(card, post, index) {
  card.innerHTML = title(post) +
    '<div class="' + NAMES.byline + '"><img class="' + NAMES.avatar + '" alt="" src="' + post.avatar + '">' +
    '<a class="' + NAMES.writer + '" href="' + post.writerLink + '">' + post.writer + '</a>' +
    (post.badge ? '<span class="' + NAMES.badge + '">' + post.badge + '</span>' : '') + '</div>' +
    '<div class="' + NAMES.body + '"><span class="' + NAMES.text + '">' + post.html + '</span>' +
    '<div class="' + NAMES.time + '">' + TEXT.posted[index] + '</div>' +
    '<button type="button" class="' + NAMES.close + '">' + TEXT.close + '</button></div>' + bar(index);
  card.querySelector('.' + NAMES.close).addEventListener('click', function () { collapsed(card, post, index); });
}
function more() {
  var end = Math.min(POSTS.length, shown + BATCH);
  for (; shown < end; shown += 1) {
    var card = document.createElement('div');
    card.className = NAMES.card;
    collapsed(card, POSTS[shown], shown);
    feed.appendChild(card);
  }
  statusLine.textContent = shown >= POSTS.length ? TEXT.end : TEXT.loading;
}
window.addEventListener('scroll', function () {
  if (loading || shown >= POSTS.length) return;
  if (window.scrollY + window.innerHeight < document.documentElement.scrollHeight - 400) return;
  loading = true;
  setTimeout(function () { more(); loading = false; }, 300);
}, { passive: true });
more();`
}

function oneOf<T extends string>(value: string | null, options: readonly T[], fallback: T): T {
  return options.find((option) => option === value) ?? fallback
}

export async function GET(request: NextRequest): Promise<NextResponse> {
  const blocked = playgroundBlocked()
  if (blocked) return blocked

  const params = request.nextUrl.searchParams
  const total = intParam(params.get('posts'), 24, 6, 60)
  const batch = intParam(params.get('batch'), 8, 2, 20)
  const lang = oneOf(params.get('lang'), LANGS, 'zh')
  const copy = COPY[lang]
  const names = CLASS_NAMES[oneOf(params.get('cls'), CLASS_STYLES, 'semantic')]
  const posts = excerptPosts(total, lang)

  const body = `<h1>${copy.heading}</h1>
<div class="${names.feed}"></div>
<div class="${names.status}"></div>`

  return htmlResponse(renderShell(copy.title, body, { style: styleFor(names), script: scriptFor(names, copy, posts, batch) }))
}
