import { NextRequest, NextResponse } from '../../_lib/next-shim'

import { htmlResponse, intParam, playgroundBlocked, renderShell } from '../../_lib/shell'
import { BASE, isCompactTemplate, isDeadLink, isFlaky, product, type Product } from '../products'

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
const CAPTCHA_STYLE = `
.captcha-box { width: 320px; padding: 16px; border: 1px solid #ccc; }
.captcha-track { height: 40px; background: #eee; }
`
const BADGE = `<div class="grecaptcha-badge" style="position:fixed;right:0;bottom:14px;width:256px;height:60px;box-shadow:0 0 5px gray;overflow:hidden"><iframe title="reCAPTCHA" width="256" height="60" style="border:0"></iframe></div>`

/** 详情页的可选部件（query 打开）；全关时输出与 H01-001 的原样一致。 */
interface Variant {
  related: boolean
  warranty: boolean
}

function warrantyRow(p: Product, v: Variant): string {
  return v.warranty && p.warranty ? `<tr><th>Warranty</th><td class="warranty">${p.warranty}</td></tr>` : ''
}

/** 「Customers also viewed」：主记录前面的两张卡片，class 与主记录相同。 */
function relatedHtml(p: Product, v: Variant): string {
  const card = (r: Product): string =>
    `<div class="product-card"><h3 class="name"><a href="${BASE}/${r.id}">${r.name}</a></h3><p class="maker">by <a href="/brands/${r.brand.toLowerCase()}">${r.brand}</a></p><p class="price">${r.price}</p>${v.warranty && r.warranty ? `<p class="warranty">${r.warranty}</p>` : ''}<p class="teaser">${r.summary}</p><button class="read-more" type="button">Read more</button></div>`
  return `<aside class="related"><h2>Customers also viewed</h2>
${[product(p.id + 1), product(p.id + 2)].map(card).join('\n')}
</aside>
`
}

function detailHtml(p: Product, v: Variant): string {
  const before = v.related ? relatedHtml(p, v) : ''
  const warranty = warrantyRow(p, v)
  const description = `<section class="description"><p class="summary">${p.summary}</p><button class="read-more" type="button">Read more</button></section>`
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

function renderScript(p: Product, lateMs: number, v: Variant): string {
  // 有相关卡片时，主记录的按钮和摘要要限定在 article 里（卡片在前，document.querySelector 会先碰到卡片）。
  const main = v.related ? 'article.product-detail ' : ''
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
  });${v.related ? RELATED_SCRIPT : ''}
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
  const variant: Variant = { related: query.get('related') === '1', warranty: query.get('warranty') === '1' }

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
  return htmlResponse(renderShell(p.name, body, { style: STYLE, script: renderScript(p, lateMs, variant) }))
}
