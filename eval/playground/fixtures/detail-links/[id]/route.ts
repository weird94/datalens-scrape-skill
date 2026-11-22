import { NextRequest, NextResponse } from '../../_lib/next-shim'

import { htmlResponse, intParam, playgroundBlocked, renderShell } from '../../_lib/shell'
import { BASE, isCompactTemplate, isDeadLink, isFlaky, product, type Product, type Review, REVIEWS_INLINE, reviews } from '../products'

/**
 * 演练场 · 列表 → 详情页（pattern H1）：详情页 /dev-fixtures/playground/detail-links/<id>。
 *
 * 详情页要考的几件事：
 * - 晚渲染：首屏只有「Loading…」，lateMs 毫秒后脚本才插入商品详情（默认 1500）。
 * - 两套模板：大多数商品的品牌在规格表 table.specs 的 td.brand 里；每第 4 件（id % 4 === 0）是紧凑模板，
 *   规格表里没有品牌行，品牌在标题下的 p.maker > a 里。只照一个样本写的选择器会漏掉另一套。
 * - 死链：id % 9 === 0 返回 HTTP 404。
 * - 「Read more」：完整描述（.full-text）点了 button.read-more 才插入（300ms 后），按钮随之消失。
 * - blockAfter=N（配合 run=<key> 分开各次运行）：同一个 run 的第 N 次之后的详情请求都返回人机验证页
 *   （HTTP 200，div.captcha-box + 「Verify you are human」），不再恢复。默认 0 = 不拦截。
 * - softBlockAfter=N（同样按 run 计数）：第 N 次之后的详情请求返回 HTTP 200 的空壳页——只有导航和「Loading…」，
 *   内容永远不来，也没有任何验证码或拦截文案（有的站限流时就这样）。默认 0 = 不限流。
 * - flaky=1：id % 5 === 0 的详情页，同一个 run 里第一次请求返回 HTTP 503，之后正常。
 * - flaky=2：id % 5 === 0 的详情页，同一个 run 里第二次请求返回 HTTP 503，第一次和之后都正常（读过的页再读一次时偶发失败）。
 * - related=1：商品详情前面（DOM 顺序在前）多一块「Customers also viewed」：aside.related 里两张 div.product-card，
 *   复用主记录的 class（.name / .maker a / .price / .warranty），各带一个 button.read-more。整页选择器会先读到它；
 *   root 设成主记录（article.product-detail）才读对、expand 也只该点主记录里的按钮。
 * - warranty=1：规格表多一行 Warranty（td.warranty）；id % 3 === 0 的商品没有保修，这一行不出现、页面别处也没有
 *   （真正的可选字段：填充率低不是因为换了模板）。
 * - reviews=1：主记录（article 里、描述后面）有评价区 section.reviews：ul.review-list 里每条 li.review 有
 *   .author / .rating（星星文字，分数只在 aria-label「Rated N out of 5」里）/ time.date（datetime 属性）/ p.text。
 *   条数按商品不同（products.ts reviewCount，有 0 条的：只有「No reviews yet.」）；超过 REVIEWS_INLINE 条时其余
 *   藏在 button.show-reviews「Show all N reviews」后面，点了 300ms 后插入、按钮消失。和 related=1 一起开时，
 *   相关商品卡片里也各有一条同 class 的「Top review」（section.reviews 里的 li.review），只有把子列表限定在主记录里才不会混进来。
 * - reviewPager=1（配合 reviews=1）：多出来的评价不在按钮后面，而在另一个 URL：a.reviews-next「Next reviews ›」
 *   指向本页加 reviewPage=2，那一页的评价区只列从第 REVIEWS_INLINE+1 条起的评价。
 * - reviewStep=N（配合 reviews=1）：多出来的评价不是一次全出来，而是在 button.load-more-reviews「Load more reviews」后面，
 *   每点一次 300ms 后多插入 N 条，全部插完按钮才消失（长评论区的「加载更多」：要点很多次）。
 * - reviewsLateMs=N（配合 reviews=1）：主记录先出来，评价区先只有标题和「Loading reviews…」，再过 N 毫秒评价列表
 *   （和按钮）才插进去（评价单独一个请求、比商品信息晚到）。
 * - badge=1：每个详情页右下角常驻一个 reCAPTCHA v3 徽标（position:fixed 的 div.grecaptcha-badge + iframe title="reCAPTCHA"），
 *   很多站每页都挂着它；它不是拦截，内容照常渲染。
 *
 * 计数按 run 分开、存在模块里：fixture 服务器重启才清零。
 */

/** run → 该 run 已收到的详情请求数。 */
const requestsByRun = new Map<string, number>()
/** `${run}:${id}`：flaky 页已经失败过一次的。 */
const flakyServed = new Set<string>()
/** `${run}:${id}` → 该详情页在这个 run 里被请求的次数（flaky=2 用）。 */
const servedById = new Map<string, number>()

const STYLE = `
.specs th { text-align: left; padding-right: 16px; }
.read-more { margin-left: 8px; }
`
const REVIEW_STYLE = `
.review { padding: 6px 0; border-bottom: 1px solid #eee; }
.review .rating { color: #c80; }
`
const CAPTCHA_STYLE = `
.captcha-box { width: 320px; padding: 16px; border: 1px solid #ccc; }
.captcha-track { height: 40px; background: #eee; }
`
const BADGE = `<div class="grecaptcha-badge" style="position:fixed;right:0;bottom:14px;width:256px;height:60px;box-shadow:0 0 5px gray;overflow:hidden"><iframe title="reCAPTCHA" width="256" height="60" style="border:0"></iframe></div>`

/** 详情页的可选部件（query 打开）；全关时输出与 H01-001 的原样一致。 */
interface Variant {
  related: boolean
  warranty: boolean
  reviews: boolean
  reviewPager: boolean
  /** reviewPager=1 时的评价页码（1 或 2）。 */
  reviewPage: number
  /** >0：其余评价在「Load more reviews」后面，每点一次多出这么多条。 */
  reviewStep: number
  /** >0：评价列表比主记录晚这么多毫秒出现。 */
  reviewsLateMs: number
}

function reviewHtml(r: Review, prefix = ''): string {
  return `<li class="review"><span class="author">${r.author}</span> <span class="rating" aria-label="Rated ${r.rating} out of 5">${'★'.repeat(r.rating)}${'☆'.repeat(5 - r.rating)}</span> <time class="date" datetime="${r.date}">${r.dateText}</time><p class="text">${prefix}${r.text}</p></li>`
}

/** 主记录里的评价区；超过 REVIEWS_INLINE 条时其余在按钮后面（或 reviewPager 时在第 2 页）。 */
function reviewsHtml(p: Product, v: Variant): string {
  const all = reviews(p.id)
  if (!all.length) return `<section class="reviews"><h2>Reviews (0)</h2><p class="no-reviews">No reviews yet.</p></section>`
  const shown = v.reviewPager && v.reviewPage === 2 ? all.slice(REVIEWS_INLINE) : all.slice(0, REVIEWS_INLINE)
  const more =
    all.length <= REVIEWS_INLINE || (v.reviewPager && v.reviewPage === 2)
      ? ''
      : v.reviewPager
        ? `<a class="reviews-next" href="${BASE}/${p.id}?reviews=1&amp;reviewPager=1&amp;reviewPage=2">Next reviews ›</a>`
        : v.reviewStep
          ? `<button class="load-more-reviews" type="button">Load more reviews</button>`
          : `<button class="show-reviews" type="button">Show all ${all.length} reviews</button>`
  const list = `<ul class="review-list">${shown.map(r => reviewHtml(r)).join('')}</ul>${more}`
  if (v.reviewsLateMs) return `<section class="reviews"><h2>Reviews (${all.length})</h2><div class="reviews-body"><p class="loading-reviews">Loading reviews…</p></div></section>`
  return `<section class="reviews"><h2>Reviews (${all.length})</h2>${list}</section>`
}

/** reviewsLateMs：晚到的评价列表（和它的按钮），插进 .reviews-body。 */
function lateReviewsHtml(p: Product, v: Variant): string {
  if (!v.reviews || !v.reviewsLateMs || !reviews(p.id).length) return ''
  return reviewsHtml(p, { ...v, reviewsLateMs: 0 }).replace(/^<section class="reviews"><h2>[^<]*<\/h2>/, '').replace(/<\/section>$/, '')
}

/** 点「Show all N reviews」后插入的评价。 */
function hiddenReviewsHtml(p: Product, v: Variant): string {
  return v.reviews && !v.reviewPager ? reviews(p.id).slice(REVIEWS_INLINE).map(r => reviewHtml(r)).join('') : ''
}

function warrantyRow(p: Product, v: Variant): string {
  return v.warranty && p.warranty ? `<tr><th>Warranty</th><td class="warranty">${p.warranty}</td></tr>` : ''
}

/** 「Customers also viewed」：主记录前面的两张卡片，class 与主记录相同。 */
function relatedHtml(p: Product, v: Variant): string {
  const card = (r: Product): string =>
    `<div class="product-card"><h3 class="name"><a href="${BASE}/${r.id}">${r.name}</a></h3><p class="maker">by <a href="/brands/${r.brand.toLowerCase()}">${r.brand}</a></p><p class="price">${r.price}</p>${v.warranty && r.warranty ? `<p class="warranty">${r.warranty}</p>` : ''}<p class="teaser">${r.summary}</p><button class="read-more" type="button">Read more</button>${v.reviews && reviews(r.id).length ? `<section class="reviews"><ul class="review-list">${reviewHtml(reviews(r.id)[0], 'Top review: ')}</ul></section>` : ''}</div>`
  return `<aside class="related"><h2>Customers also viewed</h2>
${[product(p.id + 1), product(p.id + 2)].map(card).join('\n')}
</aside>
`
}

function detailHtml(p: Product, v: Variant): string {
  const before = v.related ? relatedHtml(p, v) : ''
  const warranty = warrantyRow(p, v)
  const description = `<section class="description"><p class="summary">${p.summary}</p><button class="read-more" type="button">Read more</button></section>${v.reviews ? `\n${reviewsHtml(p, v)}` : ''}`
  if (isCompactTemplate(p.id)) {
    return `${before}<article class="product-detail compact">
<header><h1 class="name">${p.name}</h1><p class="maker">by <a href="/brands/${p.brand.toLowerCase()}">${p.brand}</a></p></header>
<p class="price">${p.price}</p>
<table class="specs"><tr><th>SKU</th><td class="sku">${p.sku}</td></tr>${warranty}</table>
${description}
</article>`
  }
  return `${before}<article class="product-detail">
<h1 class="name">${p.name}</h1>
<p class="price">${p.price}</p>
<table class="specs">
<tr><th>Brand</th><td class="brand">${p.brand}</td></tr>
<tr><th>SKU</th><td class="sku">${p.sku}</td></tr>
${warranty ? `${warranty}\n` : ''}</table>
${description}
</article>`
}

/** related=1：卡片的「Read more」把 teaser 补全后消失（和主记录的按钮一样是真的展开按钮）。 */
const RELATED_SCRIPT = `
  document.querySelectorAll('.related .read-more').forEach((more) => more.addEventListener('click', () => {
    setTimeout(() => {
      more.previousElementSibling.textContent += ' See its own page for more.';
      more.remove();
    }, 300);
  }));`

/** reviews=1：「Show all N reviews」把其余评价插进主记录的列表后消失；reviewStep 时「Load more reviews」每次插 N 条。 */
function reviewsScript(hidden: string, main: string, step = 0): string {
  if (!hidden) return ''
  if (step) {
    return `
  const MORE_REVIEW_ITEMS = ${JSON.stringify(hidden.match(/<li class="review">[\s\S]*?<\/li>/g) ?? [])};
  const loadMore = document.querySelector('${main}.load-more-reviews');
  if (loadMore) loadMore.addEventListener('click', () => {
    setTimeout(() => {
      document.querySelector('${main}.review-list').insertAdjacentHTML('beforeend', MORE_REVIEW_ITEMS.splice(0, ${step}).join(''));
      if (!MORE_REVIEW_ITEMS.length) loadMore.remove();
    }, 300);
  });`
  }
  return `
  const MORE_REVIEWS = ${JSON.stringify(hidden)};
  const showReviews = document.querySelector('${main}.show-reviews');
  if (showReviews) showReviews.addEventListener('click', () => {
    setTimeout(() => {
      document.querySelector('${main}.review-list').insertAdjacentHTML('beforeend', MORE_REVIEWS);
      showReviews.remove();
    }, 300);
  });`
}

function renderScript(p: Product, lateMs: number, v: Variant): string {
  // 有相关卡片时，主记录的按钮和摘要要限定在 article 里（卡片在前，document.querySelector 会先碰到卡片）。
  const main = v.related ? 'article.product-detail ' : ''
  const wiring = reviewsScript(hiddenReviewsHtml(p, v), main, v.reviewStep)
  const late = lateReviewsHtml(p, v)
  return `
const DETAIL = ${JSON.stringify(detailHtml(p, v))};
const FULL = ${JSON.stringify(p.fullText)};
setTimeout(() => {
  document.getElementById('app').innerHTML = DETAIL;
  const button = document.querySelector('${main}.read-more');
  button.addEventListener('click', () => {
    setTimeout(() => {
      const full = document.createElement('div');
      full.className = 'full-text';
      full.textContent = FULL;
      document.querySelector('${main}.summary').replaceWith(full);
      button.remove();
    }, 300);
  });${v.related ? RELATED_SCRIPT : ''}${late ? `
  setTimeout(() => {
    document.querySelector('${main}.reviews-body').innerHTML = ${JSON.stringify(late)};${wiring}
  }, ${v.reviewsLateMs});` : wiring}
}, ${lateMs});`
}

const CAPTCHA = `<div class="captcha-box">
<h1>Verify you are human</h1>
<p>Please complete the security check to continue.</p>
<div class="captcha-track"><div class="captcha-handle">&gt;&gt;</div></div>
</div>`

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }): Promise<NextResponse> {
  const blocked = playgroundBlocked()
  if (blocked) return blocked

  const { id: idParam } = await params
  const query = request.nextUrl.searchParams
  const lateMs = intParam(query.get('lateMs'), 1500, 0, 10_000)
  const blockAfter = intParam(query.get('blockAfter'), 0, 0, 1000)
  const softBlockAfter = intParam(query.get('softBlockAfter'), 0, 0, 1000)
  const flaky = query.get('flaky')
  const badge = query.get('badge') === '1'
  const run = query.get('run') ?? 'default'
  const variant: Variant = {
    related: query.get('related') === '1',
    warranty: query.get('warranty') === '1',
    reviews: query.get('reviews') === '1',
    reviewPager: query.get('reviewPager') === '1',
    reviewPage: query.get('reviewPage') === '2' ? 2 : 1,
    reviewStep: intParam(query.get('reviewStep'), 0, 0, 10),
    reviewsLateMs: intParam(query.get('reviewsLateMs'), 0, 0, 10_000),
  }

  const served = (requestsByRun.get(run) ?? 0) + 1
  requestsByRun.set(run, served)
  if (blockAfter > 0 && served > blockAfter) {
    return htmlResponse(renderShell('Security check', CAPTCHA, { style: CAPTCHA_STYLE }))
  }
  if (softBlockAfter > 0 && served > softBlockAfter) {
    const shell = `<nav class="crumbs"><a href="/dev-fixtures/playground/detail-links">Products</a></nav>
<main id="app"><p class="loading">Loading…</p></main>`
    return htmlResponse(renderShell('Products', shell, { style: STYLE }))
  }

  const id = Number(idParam)
  if (!Number.isInteger(id) || id < 1 || id > 500 || isDeadLink(id)) {
    return new NextResponse(renderShell('Not found', '<h1>Page not found</h1>'), {
      status: 404,
      headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' },
    })
  }
  const key = `${run}:${id}`
  const servedHere = (servedById.get(key) ?? 0) + 1
  servedById.set(key, servedHere)
  const failsNow = flaky === '1' ? !flakyServed.has(key) : flaky === '2' ? servedHere === 2 : false
  if (failsNow && isFlaky(id)) {
    flakyServed.add(key)
    return new NextResponse(renderShell('Service unavailable', '<h1>Service temporarily unavailable</h1><p>Please try again later.</p>'), {
      status: 503,
      headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' },
    })
  }

  const p = product(id)
  const body = `<nav class="crumbs"><a href="/dev-fixtures/playground/detail-links">Products</a> › ${p.name}</nav>
<main id="app"><p class="loading">Loading…</p></main>${badge ? BADGE : ''}`
  return htmlResponse(renderShell(p.name, body, { style: variant.reviews ? STYLE + REVIEW_STYLE : STYLE, script: renderScript(p, lateMs, variant) }))
}
