import { NextRequest, NextResponse } from '../_lib/next-shim'

import { htmlResponse, intParam, playgroundBlocked } from '../_lib/shell'

/**
 * 演练场 · 创作者后台：用户要的几项数字分散在几个视图里，没有一个视图全有（pattern G1）。
 *
 * 形状来自 2026-11-17 一次真实的侧栏 AI 采集（社交平台的个人主页 + 专业后台）：用户要「所有视频和帖子的
 * 播放量、点赞数、评论数」，agent 在下面几个视图之间来回跳了 36 步，一行没采，积分耗尽。
 * - view=profile（默认）：主页动态。每条帖子有点赞（表情）数、评论数、分享数，**没有播放量**。滚动加载，每批 6 条。
 * - view=reels：视频网格，**只有播放量**，只有视频帖。
 * - view=library：「内容库」表格，每行一条帖子：标题、日期、状态、播放量、覆盖人数、评论、分享。
 *   「列」按钮打开勾选菜单，可加「链接点击」「播放时长」，**没有点赞列**。
 * - view=insights：「数据分析」，只有全账号汇总数字，没有逐帖数据。
 *
 * 正确做法（任一）：采内容库（播放 + 评论，24 行）并告诉用户点赞在这里拿不到、在主页动态里；或采主页动态（点赞 +
 * 评论，24 行）并说明播放量在内容库；或两份都采。陷阱：在视图之间反复找一个同时有三项的地方。
 *
 * 不抄原站：文案、class（按名字派生的哈希式 class）、URL 都是合成的。
 *
 * query：
 * - view：profile / reels / library / insights（默认 profile）
 * - lang：hu（默认，同原始会话）/ en（held-out）
 * - posts：帖子数（默认 24，6–60），每 3 条里 1 条是视频
 * - batch：主页动态每批条数（默认 6）
 */

type Lang = 'hu' | 'en'
type View = 'profile' | 'reels' | 'library' | 'insights'

const TEXT = {
  hu: {
    creator: 'Minta Alkotó',
    posts: 'Bejegyzések',
    reels: 'Reels',
    manage: 'Bejegyzések kezelése',
    insights: 'Elemzési adatok',
    dashboard: 'Professzionális irányítópult',
    library: 'Tartalomkönyvtár',
    profile: 'Profil',
    overview: 'Áttekintés',
    columns: 'Oszlopok',
    search: 'Keresés a bejegyzések között',
    like: 'Tetszik',
    comment: 'Hozzászólás',
    share: 'Megosztás',
    reactionsLabel: (n: string) => `Reakciók: ${n}`,
    commentsText: (n: number) => `${n} hozzászólás`,
    sharesText: (n: number) => `${n} megosztás`,
    published: 'Közzétéve',
    postTitle: (i: number, video: boolean) => `${video ? 'Videó' : 'Poszt'} ${i}: ${video ? 'nyári turné, ' : ''}${HU_LINES[i % HU_LINES.length]}`,
    insightsNote: 'Az elmúlt 28 nap összesítése',
    totalViews: 'Megtekintések',
    totalReach: 'Elért fiókok',
    totalInteractions: 'Tartalominterakciók',
    followers: 'Követők',
    thousand: 'E',
  },
  en: {
    creator: 'Sample Creator',
    posts: 'Posts',
    reels: 'Reels',
    manage: 'Manage posts',
    insights: 'Insights',
    dashboard: 'Professional dashboard',
    library: 'Content library',
    profile: 'Profile',
    overview: 'Overview',
    columns: 'Columns',
    search: 'Search posts',
    like: 'Like',
    comment: 'Comment',
    share: 'Share',
    reactionsLabel: (n: string) => `Reactions: ${n}`,
    commentsText: (n: number) => `${n} comments`,
    sharesText: (n: number) => `${n} shares`,
    published: 'Published',
    postTitle: (i: number, video: boolean) => `${video ? 'Video' : 'Post'} ${i}: ${video ? 'summer tour, ' : ''}${EN_LINES[i % EN_LINES.length]}`,
    insightsNote: 'Totals for the last 28 days',
    totalViews: 'Views',
    totalReach: 'Accounts reached',
    totalInteractions: 'Content interactions',
    followers: 'Followers',
    thousand: 'K',
  },
} as const

const HU_LINES = ['köszönjük a sok üzenetet', 'új helyszín a hétvégén', 'a kulisszák mögött', 'próba előtt', 'jegyek a linkben', 'élő közvetítés ma este']
const EN_LINES = ['thanks for all the messages', 'new venue this weekend', 'behind the scenes', 'before rehearsal', 'tickets in the link', 'live tonight']

interface Column {
  key: string
  hu: string
  en: string
  on: boolean
}

/** The library table's columns; there is no likes / reactions column, on or off. */
const COLUMNS: Column[] = [
  { key: 'title', hu: 'Cím', en: 'Title', on: true },
  { key: 'date', hu: 'Közzététel dátuma', en: 'Publish date', on: true },
  { key: 'status', hu: 'Állapot', en: 'Status', on: true },
  { key: 'views', hu: 'Megtekintések', en: 'Views', on: true },
  { key: 'reach', hu: 'Elérés', en: 'Reach', on: true },
  { key: 'comments', hu: 'Hozzászólások', en: 'Comments', on: true },
  { key: 'shares', hu: 'Megosztások', en: 'Shares', on: true },
  { key: 'linkClicks', hu: 'Linkkattintások', en: 'Link clicks', on: false },
  { key: 'watch', hu: 'Lejátszási idő', en: 'Watch time', on: false },
]

interface CreatorPost {
  index: number
  video: boolean
  title: string
  date: string
  views: number
  reach: number
  reactions: number
  comments: number
  shares: number
  linkClicks: number
  watchMinutes: number
}

function creatorPosts(count: number, lang: Lang): CreatorPost[] {
  return Array.from({ length: count }, (_, k) => {
    const index = k + 1
    const video = index % 3 === 0
    const views = 1_000 + ((index * 7_919) % 48_000)
    const day = 28 - (k % 28)
    return {
      index,
      video,
      title: TEXT[lang].postTitle(index, video),
      date: `2026-${String(10 - Math.floor(k / 28)).padStart(2, '0')}-${String(day).padStart(2, '0')}`,
      views,
      reach: Math.round(views * 0.8),
      reactions: 20 + ((index * 613) % 2_000),
      comments: 1 + ((index * 37) % 180),
      shares: (index * 13) % 60,
      linkClicks: (index * 7) % 90,
      watchMinutes: video ? 30 + ((index * 53) % 900) : 0,
    }
  })
}

/** Hash-looking class names derived from a role name, like a CSS-in-JS build's. */
function cls(...names: string[]): string {
  return names
    .map(name => {
      let h = 2166136261
      for (const ch of `ch:${name}`) h = Math.imul(h ^ ch.charCodeAt(0), 16777619) >>> 0
      return `x${h.toString(36).slice(0, 6)}`
    })
    .join(' ')
}

function compact(n: number, lang: Lang): string {
  if (n < 1_000) return String(n)
  const k = (n / 1_000).toFixed(1).replace(/\.0$/, '')
  return `${lang === 'hu' ? k.replace('.', ',') : k} ${TEXT[lang].thousand}`
}

function full(n: number, lang: Lang): string {
  return n.toLocaleString(lang === 'hu' ? 'hu-HU' : 'en-US')
}

const escape = (text: string) => text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

function link(view: View, lang: Lang, posts: number): string {
  return `?view=${view}&lang=${lang}${posts === 24 ? '' : `&posts=${posts}`}`
}

function feedPost(post: CreatorPost, lang: Lang): string {
  const t = TEXT[lang]
  const media = post.video
    ? `<div class="${cls('media')}"><div class="${cls('media-inner')}" style="height:180px;background:#223"></div></div>`
    : ''
  return `<div role="article" aria-posinset="${post.index}" class="${cls('article', 'card')}">
<div class="${cls('head')}"><a href="#post-${post.index}" class="${cls('author')}">${t.creator}</a> <span class="${cls('when')}">${post.date}</span></div>
<div dir="auto" class="${cls('body')}">${escape(post.title)}</div>
${media}
<div class="${cls('bar')}">
<span role="button" tabindex="0" aria-label="${t.reactionsLabel(full(post.reactions, lang))}" class="${cls('reactions')}"><span class="${cls('emoji')}">👍❤️</span><span class="${cls('count')}">${compact(post.reactions, lang)}</span></span>
<span class="${cls('stat')}">${t.commentsText(post.comments)}</span>
<span class="${cls('stat')}">${t.sharesText(post.shares)}</span>
</div>
<div class="${cls('actions')}"><div role="button" tabindex="0">${t.like}</div><div role="button" tabindex="0">${t.comment}</div><div role="button" tabindex="0">${t.share}</div></div>
</div>`
}

function profileView(posts: CreatorPost[], lang: Lang, batch: number): { body: string; script: string } {
  const t = TEXT[lang]
  const count = posts.length
  const body = `<div class="${cls('profile-head')}">
<h1 class="${cls('name')}">${t.creator}</h1>
<div class="${cls('pro-links')}"><a href="${link('library', lang, count)}">${t.manage}</a> · <a href="${link('insights', lang, count)}">${t.insights}</a> · <a href="${link('insights', lang, count)}">${t.dashboard}</a></div>
<div role="tablist" class="${cls('tabs')}"><a role="tab" aria-selected="true" href="${link('profile', lang, count)}">${t.posts}</a> <a role="tab" aria-selected="false" href="${link('reels', lang, count)}">${t.reels}</a></div>
</div>
<div role="main" class="${cls('main')}"><div class="${cls('feed-outer')}"><div class="${cls('feed')}" id="feed"></div><div id="feed-more" class="${cls('loading')}" style="height:40px"></div></div></div>`
  const script = `
const posts = ${JSON.stringify(posts.map(post => feedPost(post, lang)))};
const feed = document.getElementById('feed');
const more = document.getElementById('feed-more');
let shown = 0;
let loading = false;
function append() {
  posts.slice(shown, shown + ${batch}).forEach(html => feed.insertAdjacentHTML('beforeend', html));
  shown = Math.min(posts.length, shown + ${batch});
  if (shown >= posts.length) { observer.disconnect(); more.remove(); }
}
const observer = new IntersectionObserver(entries => {
  if (!entries.some(e => e.isIntersecting) || loading || shown >= posts.length) return;
  loading = true;
  setTimeout(() => { append(); loading = false; }, 700);
});
append();
observer.observe(more);
`
  return { body, script }
}

function reelsView(posts: CreatorPost[], lang: Lang): string {
  const t = TEXT[lang]
  const tiles = posts
    .filter(post => post.video)
    .map(
      post =>
        `<a href="#reel-${post.index}" class="${cls('tile')}"><div class="${cls('thumb')}" style="height:160px;background:#334"></div><span class="${cls('plays')}">▶ ${compact(post.views, lang)}</span></a>`
    )
    .join('\n')
  return `<div class="${cls('profile-head')}"><h1 class="${cls('name')}">${t.creator}</h1>
<div role="tablist" class="${cls('tabs')}"><a role="tab" aria-selected="false" href="${link('profile', lang, posts.length)}">${t.posts}</a> <a role="tab" aria-selected="true" href="${link('reels', lang, posts.length)}">${t.reels}</a></div></div>
<div role="main"><div class="${cls('grid')}" style="display:grid;grid-template-columns:repeat(4,1fr);gap:4px">${tiles}</div></div>`
}

function dashboardNav(lang: Lang, count: number, current: View): string {
  const t = TEXT[lang]
  const item = (view: View, label: string) =>
    `<a role="link" href="${link(view, lang, count)}" class="${cls('nav-item')}"${view === current ? ' aria-current="page"' : ''}>${label}</a>`
  return `<nav class="${cls('side-nav')}" style="float:left;width:180px;display:flex;flex-direction:column;gap:8px">
<strong>${t.dashboard}</strong>${item('insights', t.overview)}${item('library', t.library)}${item('insights', t.insights)}${item('profile', t.profile)}</nav>`
}

function libraryView(posts: CreatorPost[], lang: Lang): { body: string; script: string } {
  const t = TEXT[lang]
  const values = posts.map(post => ({
    title: `<a href="#post-${post.index}" class="${cls('row-link')}"><span class="${cls('row-thumb')}" style="display:inline-block;width:32px;height:32px;background:#ccd"></span> <span class="${cls('row-title')}">${escape(post.title)}</span></a>`,
    date: post.date,
    status: lang === 'hu' ? 'Közzétéve' : 'Published',
    views: full(post.views, lang),
    reach: full(post.reach, lang),
    comments: full(post.comments, lang),
    shares: full(post.shares, lang),
    linkClicks: full(post.linkClicks, lang),
    watch: post.video ? `${post.watchMinutes} min` : '–',
  }))
  const columns = COLUMNS.map(column => ({ key: column.key, label: column[lang], on: column.on }))
  const body = `${dashboardNav(lang, posts.length, 'library')}
<div role="main" class="${cls('dash-main')}" style="margin-left:200px">
<h1 class="${cls('dash-title')}">${t.library}</h1>
<div class="${cls('toolbar')}" style="display:flex;gap:12px;align-items:center;position:relative">
<input class="${cls('search')}" placeholder="${t.search}">
<div role="button" tabindex="0" aria-haspopup="menu" class="${cls('columns-button')}" id="columns-button" style="border:1px solid #bbb;padding:4px 10px;cursor:pointer">${t.columns}</div>
<div id="menu-host"></div>
</div>
<div class="${cls('table-wrap')}"><table role="grid" class="${cls('table', 'grid', 'full')}" style="border-collapse:collapse"><thead></thead><tbody></tbody></table></div>
</div>`
  const script = `
const columns = ${JSON.stringify(columns)};
const rows = ${JSON.stringify(values)};
const cellClass = ${JSON.stringify(cls('cell'))};
const rowClass = ${JSON.stringify(cls('row', 'tr'))};
const table = document.querySelector('table');
function render() {
  const on = columns.filter(c => c.on);
  table.tHead.innerHTML = '<tr>' + on.map((c, i) => '<th role="columnheader" aria-colindex="' + (i + 2) + '" class="' + cellClass + '">' + c.label + '</th>').join('') + '</tr>';
  table.tBodies[0].innerHTML = rows.map((r, n) => '<tr data-index="' + n + '" class="' + rowClass + '">' + on.map((c, i) => '<td role="gridcell" aria-colindex="' + (i + 2) + '" class="' + cellClass + '">' + r[c.key] + '</td>').join('') + '</tr>').join('');
}
const host = document.getElementById('menu-host');
function closeMenu() { host.innerHTML = ''; }
function openMenu() {
  host.innerHTML = '<div role="menu" style="position:absolute;top:32px;left:220px;background:#fff;border:1px solid #999;padding:6px;z-index:10">' +
    columns.map(c => '<div role="menuitemcheckbox" tabindex="0" aria-checked="' + c.on + '" aria-label="' + c.label + '" style="padding:2px 8px;cursor:pointer"><span>' + (c.on ? '☑ ' : '☐ ') + '</span><span>' + c.label + '</span></div>').join('') + '</div>';
}
document.getElementById('columns-button').addEventListener('click', e => { e.stopPropagation(); host.innerHTML ? closeMenu() : openMenu(); });
host.addEventListener('click', e => {
  e.stopPropagation();
  const item = e.target.closest('[role="menuitemcheckbox"]');
  if (!item) return;
  const column = columns.find(c => c.label === item.getAttribute('aria-label'));
  column.on = !column.on;
  render();
  openMenu();
});
document.addEventListener('click', closeMenu);
render();
`
  return { body, script }
}

function insightsView(posts: CreatorPost[], lang: Lang): string {
  const t = TEXT[lang]
  const sum = (key: 'views' | 'reach' | 'reactions') => posts.reduce((total, post) => total + post[key], 0)
  const interactions = posts.reduce((total, post) => total + post.reactions + post.comments + post.shares, 0)
  const card = (label: string, value: number) =>
    `<div class="${cls('metric')}" style="border:1px solid #ddd;padding:12px"><div class="${cls('metric-label')}">${label}</div><div class="${cls('metric-value')}">${compact(value, lang)}</div></div>`
  return `${dashboardNav(lang, posts.length, 'insights')}
<div role="main" class="${cls('dash-main')}" style="margin-left:200px">
<h1 class="${cls('dash-title')}">${t.insights}</h1><p>${t.insightsNote}</p>
<div class="${cls('metrics')}" style="display:flex;gap:12px">${card(t.totalViews, sum('views'))}${card(t.totalReach, sum('reach'))}${card(t.totalInteractions, interactions)}${card(t.followers, 3_412)}</div>
</div>`
}

function page(lang: Lang, title: string, body: string, script = ''): string {
  return `<!doctype html>
<html lang="${lang}">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${title}</title>
<style>body{font:14px/1.5 system-ui,sans-serif;margin:16px;color:#1c1e21}a{color:#1d4ed8}
[role=article]{border:1px solid #ddd;border-radius:8px;padding:12px;margin:12px 0;max-width:560px}
td,th{border-bottom:1px solid #eee;padding:6px 10px;text-align:left}</style></head>
<body>${body}${script ? `<script>${script}</script>` : ''}</body></html>`
}

export async function GET(request: NextRequest): Promise<NextResponse> {
  const blocked = playgroundBlocked()
  if (blocked) return blocked

  const query = request.nextUrl.searchParams
  const lang: Lang = query.get('lang') === 'en' ? 'en' : 'hu'
  const view = (['profile', 'reels', 'library', 'insights'] as const).find(v => v === query.get('view')) ?? 'profile'
  const posts = creatorPosts(intParam(query.get('posts'), 24, 6, 60), lang)
  const batch = intParam(query.get('batch'), 6, 1, 60)
  const t = TEXT[lang]

  if (view === 'profile') {
    const { body, script } = profileView(posts, lang, batch)
    return htmlResponse(page(lang, `${t.creator} | ${t.posts}`, body, script))
  }
  if (view === 'reels') return htmlResponse(page(lang, `${t.creator} | ${t.reels}`, reelsView(posts, lang)))
  if (view === 'library') {
    const { body, script } = libraryView(posts, lang)
    return htmlResponse(page(lang, t.library, body, script))
  }
  return htmlResponse(page(lang, t.insights, insightsView(posts, lang)))
}
