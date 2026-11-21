import { NextRequest, NextResponse } from '../_lib/next-shim'

import { htmlResponse, intParam, playgroundBlocked, renderShell } from '../_lib/shell'

/**
 * 演练场 · 分页器长在列表容器里、和行同层（pattern D7，case D07-002 / D07-003）。
 *
 * 结果列表容器的直接子节点除了数据行，还有一个反馈块、一个数字页码分页器（1 2 3 + 下一页，全是 button，
 * JS 原地换页并 pushState）、一个页脚和一个订阅提示。所有子节点都带同一个原子类（`common`），
 * 识别出的 itemSelector 只剩这个类时，分页器本身就被当成了「一行」：
 * - 分析阶段：分页上下文把行折成占位符，分页器跟着被折掉，模型只看得到侧栏轮播的「下一页」箭头
 *   （离列表很远），于是判成没有分页；
 * - 执行阶段：就算选中了分页器，它长在「某一行」里，会被当成行内按钮拒掉。
 * 结果是只采到第 1 页。
 *
 * 形状来自 2026-11-03 在一个职位搜索结果页（登录态）上的复现：要 40 条只采到第 1 页 25 条，
 * 分页理由是「唯一的下一页在照片轮播里」。类名、属性、文案都不是那个站的。
 *
 * query：
 * - pages：总页数（默认 3，1–10）
 * - perPage：每页行数（默认 10，1–30）
 * - variant：a（默认，英文，一套哈希类名）或 b（中文，另一套哈希类名，留出集）
 */

interface Variant {
  classes: {
    shell: string
    root: string
    common: string
    rowWrap: string
    card: string
    title: string
    org: string
    place: string
    age: string
    sep: string
    pagerBox: string
    pageButton: string
    nextButton: string
    foot: string
    alerts: string
    aside: string
    carousel: string
  }
  text: {
    heading: string
    titleOf: (index: number) => string
    orgOf: (index: number) => string
    place: string
    ageOf: (index: number) => string
    feedback: string
    pageLabel: (page: number) => string
    next: string
    previousPhoto: string
    nextPhoto: string
    photos: string
    foot: string[]
    alerts: string
  }
}

const VARIANTS: Record<'a' | 'b', Variant> = {
  a: {
    classes: {
      shell: 'k2v q8m',
      root: 'r7d m1x c0q',
      common: 'c0q',
      rowWrap: 'w4n c0q',
      card: 'p9s',
      title: 't3h',
      org: 'o5j',
      place: 'l6g',
      age: 'a1y',
      sep: 's8e',
      pagerBox: 'g2z f7u c0q',
      pageButton: 'b5i',
      nextButton: 'n6r',
      foot: 'h1k e3w c0q',
      alerts: 'u9p c0q',
      aside: 'd4t',
      carousel: 'v2o',
    },
    text: {
      heading: 'Search results',
      titleOf: index => `Analyst role ${index}`,
      orgOf: index => `Northwind Labs ${index}`,
      place: 'Harbor City (Hybrid)',
      ageOf: index => `Posted ${(index % 6) + 1} days ago`,
      feedback: 'Were these results useful?',
      pageLabel: page => `Page ${page}`,
      next: 'Next',
      previousPhoto: 'Previous',
      nextPhoto: 'Next',
      photos: 'Team photos',
      foot: ['About', 'Help', 'Privacy'],
      alerts: 'Get alerts for this search',
    },
  },
  b: {
    classes: {
      shell: 'zq1 yy7',
      root: 'mm3 xa8 jj5',
      common: 'jj5',
      rowWrap: 'ee2 jj5',
      card: 'cc9',
      title: 'tt4',
      org: 'oo6',
      place: 'pp1',
      age: 'gg8',
      sep: 'ss3',
      pagerBox: 'nn7 kk0 jj5',
      pageButton: 'bb2',
      nextButton: 'xx4',
      foot: 'ff6 hh9 jj5',
      alerts: 'aa1 jj5',
      aside: 'dd5',
      carousel: 'rr8',
    },
    text: {
      heading: '搜索结果',
      titleOf: index => `数据岗位 ${index}`,
      orgOf: index => `青石科技 ${index}`,
      place: '临江市（混合办公）',
      ageOf: index => `${(index % 6) + 1} 天前发布`,
      feedback: '这些结果有帮助吗？',
      pageLabel: page => `第 ${page} 页`,
      next: '下一页',
      previousPhoto: '上一张',
      nextPhoto: '下一张',
      photos: '团队照片',
      foot: ['关于', '帮助', '隐私'],
      alerts: '订阅这个搜索',
    },
  },
}

function rowHtml(variant: Variant, index: number): string {
  const c = variant.classes
  const t = variant.text
  return `<div class="${c.rowWrap}"><div class="${c.card}" role="button" tabindex="0"><p class="${c.title}">${t.titleOf(index)}</p><p class="${c.org}">${t.orgOf(index)}</p><p class="${c.place}">${t.place}</p><p class="${c.age}">${t.ageOf(index)}</p></div></div>`
}

function rowsHtml(variant: Variant, page: number, perPage: number): string {
  const rows = Array.from({ length: perPage }, (_, offset) => rowHtml(variant, (page - 1) * perPage + offset + 1))
  return rows.join(`<hr class="${variant.classes.sep}" role="presentation">`)
}

function pagerHtml(variant: Variant, page: number, pages: number): string {
  const c = variant.classes
  const t = variant.text
  const buttons = Array.from({ length: pages }, (_, offset) => {
    const target = offset + 1
    const current = target === page ? 'true' : 'false'
    return `<li><button class="${c.pageButton}" type="button" aria-label="${t.pageLabel(target)}" aria-current="${current}" data-page="${target}">${target}</button></li>`
  }).join('')
  const nextDisabled = page >= pages ? ' disabled' : ''
  return `<div class="${c.pagerBox}"><ul>${buttons}</ul><button class="${c.nextButton}" type="button" aria-label="${t.next}" data-next="1"${nextDisabled}><svg width="12" height="12" viewBox="0 0 12 12"><path d="M4 2l4 4-4 4" stroke="currentColor" fill="none"/></svg><span>${t.next}</span></button></div>`
}

function asideHtml(variant: Variant): string {
  const c = variant.classes
  const t = variant.text
  const photos = Array.from({ length: 4 }, (_, offset) => `<li><span class="${c.carousel}">${offset + 1}/4</span></li>`).join('')
  // 侧栏照片轮播的「下一张」箭头：离列表很远，是唯一不在列表里的「下一页」样控件
  return `<aside class="${c.aside}"><h2>${t.photos}</h2><button type="button" aria-label="${t.previousPhoto}">‹</button><ul>${photos}</ul><button type="button" aria-label="${t.nextPhoto}">›</button></aside>`
}

function listChildrenHtml(variant: Variant, page: number, pages: number, perPage: number): string {
  const c = variant.classes
  const t = variant.text
  const foot = t.foot.map(label => `<a href="#">${label}</a>`).join(' ')
  return `${rowsHtml(variant, page, perPage)}
<hr class="${c.sep}" role="presentation">
<div class="${c.rowWrap}"><h2>${t.feedback}</h2><button type="button" aria-label="+1">+1</button></div>
<hr class="${c.sep}" role="presentation">
${pagerHtml(variant, page, pages)}
<div class="${c.foot}"><p>${foot}</p></div>
<div class="${c.alerts}"><h3>${t.alerts}</h3></div>`
}

/** 原地换页：点页码或「下一页」重画列表容器的子节点，并 pushState 一个新地址（next-link oracle 靠地址判断是否翻成功）。 */
function pagingScript(variant: Variant, pages: number, perPage: number): string {
  const c = variant.classes
  const t = variant.text
  const config = JSON.stringify({ pages, perPage, classes: c })
  const labels = JSON.stringify({
    place: t.place,
    feedback: t.feedback,
    next: t.next,
    foot: t.foot,
    alerts: t.alerts,
  })
  return `
const CONFIG = ${config};
const LABELS = ${labels};
const titleOf = ${t.titleOf.toString()};
const orgOf = ${t.orgOf.toString()};
const ageOf = ${t.ageOf.toString()};
const pageLabel = ${t.pageLabel.toString()};
const root = document.querySelector('[data-results-root]');
let current = Number(new URLSearchParams(location.search).get('p') || '1');
function row(index) {
  const c = CONFIG.classes;
  return '<div class="' + c.rowWrap + '"><div class="' + c.card + '" role="button" tabindex="0"><p class="' + c.title + '">' + titleOf(index) + '</p><p class="' + c.org + '">' + orgOf(index) + '</p><p class="' + c.place + '">' + LABELS.place + '</p><p class="' + c.age + '">' + ageOf(index) + '</p></div></div>';
}
function render(page) {
  const c = CONFIG.classes;
  const sep = '<hr class="' + c.sep + '" role="presentation">';
  const rows = [];
  for (let offset = 0; offset < CONFIG.perPage; offset += 1) rows.push(row((page - 1) * CONFIG.perPage + offset + 1));
  let buttons = '';
  for (let target = 1; target <= CONFIG.pages; target += 1) {
    buttons += '<li><button class="' + c.pageButton + '" type="button" aria-label="' + pageLabel(target) + '" aria-current="' + (target === page) + '" data-page="' + target + '">' + target + '</button></li>';
  }
  const nextDisabled = page >= CONFIG.pages ? ' disabled' : '';
  const pager = '<div class="' + c.pagerBox + '"><ul>' + buttons + '</ul><button class="' + c.nextButton + '" type="button" aria-label="' + LABELS.next + '" data-next="1"' + nextDisabled + '><svg width="12" height="12" viewBox="0 0 12 12"><path d="M4 2l4 4-4 4" stroke="currentColor" fill="none"/></svg><span>' + LABELS.next + '</span></button></div>';
  const foot = LABELS.foot.map(function (label) { return '<a href="#">' + label + '</a>'; }).join(' ');
  root.innerHTML = rows.join(sep) + sep + '<div class="' + c.rowWrap + '"><h2>' + LABELS.feedback + '</h2><button type="button" aria-label="+1">+1</button></div>' + sep + pager + '<div class="' + c.foot + '"><p>' + foot + '</p></div><div class="' + c.alerts + '"><h3>' + LABELS.alerts + '</h3></div>';
}
function go(page) {
  if (page < 1 || page > CONFIG.pages || page === current) return;
  current = page;
  const url = new URL(location.href);
  url.searchParams.set('p', String(page));
  history.pushState({ page: page }, '', url.toString());
  render(page);
  window.scrollTo(0, 0);
}
root.addEventListener('click', function (event) {
  const target = event.target instanceof Element ? event.target.closest('button') : null;
  if (!target || target.disabled) return;
  if (target.dataset.next) go(current + 1);
  else if (target.dataset.page) go(Number(target.dataset.page));
});
`
}

export async function GET(request: NextRequest): Promise<NextResponse> {
  const blocked = playgroundBlocked()
  if (blocked) return blocked

  const params = request.nextUrl.searchParams
  const pages = intParam(params.get('pages'), 3, 1, 10)
  const perPage = intParam(params.get('perPage'), 10, 1, 30)
  const variant = VARIANTS[params.get('variant') === 'b' ? 'b' : 'a']
  const page = intParam(params.get('p'), 1, 1, pages)
  const c = variant.classes

  const body = `<div class="${c.shell}">
<main><h1>${variant.text.heading}</h1>
<div class="${c.root}" data-results-root>
${listChildrenHtml(variant, page, pages, perPage)}
</div></main>
${asideHtml(variant)}
</div>`

  return htmlResponse(
    renderShell(variant.text.heading, body, {
      style: `.${c.shell.split(' ')[0]} { display: grid; grid-template-columns: 1fr 260px; gap: 24px; } .${c.card.split(' ')[0]} { padding: 8px 0; cursor: pointer; } .${c.pagerBox.split(' ')[0]} { display: flex; gap: 8px; align-items: center; } .${c.pagerBox.split(' ')[0]} ul { display: flex; gap: 4px; }`,
      script: pagingScript(variant, pages, perPage),
    })
  )
}
