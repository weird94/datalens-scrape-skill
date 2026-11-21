import { NextRequest, NextResponse } from '../_lib/next-shim'

import { htmlResponse, intParam, playgroundBlocked, renderShell } from '../_lib/shell'

/**
 * 演练场 · 同一个按钮在每个 slide / 卡片里各有一份，只有屏幕上那份是对的（pattern D14）。
 *
 * 真站的形状（2026-11-10，短视频站的视频弹窗）：弹窗是竖向堆叠的轮播，前后几个视频的 slide 都渲染着、
 * 只是移出了视口；弹窗底下还有一整页推荐流。每个 slide（以及推荐流的每张卡）都有同一个 class 的评论按钮。
 * 按文档顺序取「第一个渲染出来的」会点到视口外的上一个视频、或被弹窗盖住的推荐卡——点了不报错，
 * 而是切走当前视频，评论面板永远打不开，看起来像「评论还没加载」。
 *
 * query：
 * - slides：弹窗里的 slide 数（默认 5，2–12）
 * - current：当前播放第几个（默认 3，1–slides），前面的 slide 在视口上方
 * - comments：当前视频的评论数（默认 12，1–100），面板标题「共 N 条评论」与之相等
 * - lang：zh / en（默认 zh）
 * - classes：semantic / hash（默认 semantic）
 *
 * 点当前 slide 的评论按钮：300ms 后打开右侧评论面板。点任何别的评论按钮：切换视频（推荐卡切到第 1 个），面板关闭。
 */

type Lang = 'zh' | 'en'
type ClassStyle = 'semantic' | 'hash'

const LANGS: readonly Lang[] = ['zh', 'en']
const CLASS_STYLES: readonly ClassStyle[] = ['semantic', 'hash']
const FEED_CARDS = 12
const OPEN_DELAY_MS = 300

interface LangText {
  title: string
  feed: (index: number) => string
  video: (index: number) => string
  count: (n: number) => string
  comment: (index: number, video: number) => string
}

const TEXT: Record<Lang, LangText> = {
  zh: {
    title: '精选视频',
    feed: index => `推荐视频 ${index}`,
    video: index => `视频 ${index}：今天聊聊第 ${index} 个话题`,
    count: n => `共 ${n} 条评论`,
    comment: (index, video) => `评论 ${index}：视频 ${video} 下的第 ${index} 条评论。`,
  },
  en: {
    title: 'Featured videos',
    feed: index => `Recommended video ${index}`,
    video: index => `Video ${index}: today's topic number ${index}`,
    count: n => `${n} comments`,
    comment: (index, video) => `Comment ${index}: comment number ${index} under video ${video}.`,
  },
}

interface ClassNames {
  feed: string
  card: string
  player: string
  viewport: string
  track: string
  slide: string
  button: string
  panel: string
  item: string
}

const CLASS_NAMES: Record<ClassStyle, ClassNames> = {
  semantic: {
    feed: 'feed',
    card: 'card',
    player: 'player',
    viewport: 'viewport',
    track: 'track',
    slide: 'slide',
    button: 'comment-btn',
    panel: 'comments',
    item: 'comment',
  },
  hash: {
    feed: 'k3f9a1',
    card: 'p8d2c7',
    player: 'z1b6e4',
    viewport: 'm5c0a9',
    track: 'q7e3b2',
    slide: 'w2a8f5',
    button: 'h6d1c3',
    panel: 'j4f7b0',
    item: 'v9c2e6',
  },
}

/** 视频 k 的评论数：当前视频用 query 给的数，其余是看起来真实、但和它不同的数。 */
function countOf(video: number, current: number, comments: number): number {
  return video === current ? comments : 1000 + 379 * video
}

function style(n: ClassNames): string {
  return (
    `.${n.feed} { display: grid; grid-template-columns: repeat(4, 1fr); gap: 12px; } ` +
    `.${n.card} { height: 160px; padding: 8px; border: 1px solid #ddd; display: flex; flex-direction: column; justify-content: space-between; } ` +
    `.${n.player} { position: fixed; inset: 0; z-index: 10; display: flex; background: #111; color: #eee; } ` +
    `.${n.viewport} { position: relative; flex: 1; height: 100vh; overflow: hidden; } ` +
    `.${n.slide} { position: relative; height: 100vh; display: flex; align-items: center; justify-content: center; } ` +
    `.${n.slide} .${n.button} { position: absolute; right: 24px; top: 55%; } ` +
    `.${n.panel} { width: 360px; height: 100vh; overflow: auto; background: #fff; color: #222; padding: 12px; box-sizing: border-box; } ` +
    `.${n.panel} ul { list-style: none; padding: 0; margin: 0; } .${n.item} { padding: 8px 0; border-bottom: 1px solid #eee; }`
  )
}

function script(n: ClassNames, text: LangText, current: number, comments: number, slides: number): string {
  const counts = Array.from({ length: slides }, (_, i) => countOf(i + 1, current, comments))
  return `const N = ${JSON.stringify(n)};
const COUNTS = ${JSON.stringify(counts)};
const COMMENT = ${JSON.stringify(Array.from({ length: slides }, (_, i) => Array.from({ length: Math.min(counts[i], 100) }, (_, j) => text.comment(j + 1, i + 1))))};
const TITLES = ${JSON.stringify(counts.map(count => text.count(count)))};
const track = document.querySelector('.' + N.track);
const slides = Array.from(track.children);
const panel = document.querySelector('.' + N.panel);
let current = ${current - 1};
let opening = null;
function show(index) {
  current = index;
  track.style.transform = 'translateY(' + (-index * 100) + 'vh)';
  clearTimeout(opening);
  panel.hidden = true;
  panel.innerHTML = '';
  const query = new URLSearchParams(location.search);
  query.set('current', String(index + 1));
  history.replaceState(null, '', location.pathname + '?' + query.toString());
}
function openComments() {
  clearTimeout(opening);
  opening = setTimeout(() => {
    const items = COMMENT[current].map(t => '<li class="' + N.item + '">' + t + '</li>').join('');
    panel.innerHTML = '<h3>' + TITLES[current] + '</h3><ul>' + items + '</ul>';
    panel.hidden = false;
  }, ${OPEN_DELAY_MS});
}
document.addEventListener('click', event => {
  const button = event.target.closest('.' + N.button);
  if (!button) return;
  const slide = button.closest('.' + N.slide);
  const index = slide ? slides.indexOf(slide) : -1;
  if (index === current) openComments();
  else show(index >= 0 ? index : 0);
});
show(current);`
}

function pick<T extends string>(value: string | null, allowed: readonly T[], fallback: T): T {
  return allowed.find(item => item === value) ?? fallback
}

export async function GET(request: NextRequest): Promise<NextResponse> {
  const blocked = playgroundBlocked()
  if (blocked) return blocked

  const query = request.nextUrl.searchParams
  const slides = intParam(query.get('slides'), 5, 2, 12)
  const current = intParam(query.get('current'), 3, 1, slides)
  const comments = intParam(query.get('comments'), 12, 1, 100)
  const lang = pick(query.get('lang'), LANGS, 'zh')
  const n = CLASS_NAMES[pick(query.get('classes'), CLASS_STYLES, 'semantic')]
  const text = TEXT[lang]

  const feed = Array.from(
    { length: FEED_CARDS },
    (_, i) =>
      `<div class="${n.card}"><span>${text.feed(i + 1)}</span><button class="${n.button}" type="button">💬 ${200 + 37 * i}</button></div>`
  ).join('\n')
  const slideHtml = Array.from(
    { length: slides },
    (_, i) =>
      `<div class="${n.slide}"><h2>${text.video(i + 1)}</h2><button class="${n.button}" type="button">💬 ${countOf(i + 1, current, comments)}</button></div>`
  ).join('\n')

  const body = `<header><h1>${text.title}</h1></header>
<main>
<div class="${n.feed}">
${feed}
</div>
</main>
<div class="${n.player}">
<div class="${n.viewport}"><div class="${n.track}">
${slideHtml}
</div></div>
<aside class="${n.panel}" hidden></aside>
</div>`

  return htmlResponse(
    renderShell(text.title, body, { style: style(n), script: script(n, text, current, comments, slides) }).replace(
      '<html lang="zh">',
      `<html lang="${lang}">`
    )
  )
}
