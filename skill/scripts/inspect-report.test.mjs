// The inspect report's element tools in a real page: refs, find, readable html, click effects and
// why a selector matched nothing. Run with `node --test scripts/inspect-report.test.mjs`.
import assert from 'node:assert/strict'
import { after, before, test } from 'node:test'
import { chromium } from 'playwright'
import { formatInspectReport, gotoAndSettle, inspectOnPage, installDlk, runSetup, settle } from './lib/index.mjs'

const PAGE = `<!doctype html><html><head><meta charset="utf-8"></head><body>
<style>.item { color: red }</style>
<ul class="list">
  <li class="item"><span class="who">ann</span><p class="text">first</p></li>
  <li class="item"><span class="who">bob</span><p class="text">second</p></li>
  <li class="item"><span class="who">cid</span><p class="text">third</p></li>
</ul>
<div class="bar">
  <div class="count">12</div><div class="count">1758</div><div class="count">40</div>
</div>
<button class="more" id="more"><i></i><div class="label"><span>展开3条回复</span></div></button>
<button class="noop">nothing</button>
<div id="card" style="padding: 4px"><!-- a comment --><svg class="icon"><path d="M0 0L10 10"/></svg>
  <a href="https://example.com/a/very/long/path/that/goes/on/and/on/and/on/for/well/over/one/hundred/characters/in/total/index.html">link</a>
  <b class="tag">a</b><b class="tag">b</b><b class="tag">c</b><b class="tag">d</b><b class="tag">e</b>
</div>
<shadow-host></shadow-host>
<script>
  document.querySelector('shadow-host').attachShadow({ mode: 'open' }).innerHTML = '<style>p { margin: 0 }</style><p class="inner">inside the shadow</p>'
  document.getElementById('more').addEventListener('click', () => {
    for (let i = 0; i < 5; i += 1) {
      const li = document.createElement('li')
      li.className = 'item'
      li.innerHTML = '<span class="who">new</span><p class="text">reply ' + i + '</p>'
      document.querySelector('.list').appendChild(li)
    }
  })
</script>
</body></html>`
const URL_OF_PAGE = `data:text/html;charset=utf-8,${encodeURIComponent(PAGE)}`
const lib = { settle, gotoAndSettle, runSetup, installDlk }

let browser
let page
before(async () => {
  browser = await chromium.launch()
  page = await browser.newPage()
})
after(async () => browser?.close())

async function fresh() {
  await page.goto(URL_OF_PAGE)
  await page.evaluate(installDlk)
}
const dlk = (fn, arg) => page.evaluate(fn, arg)

test('find names the element holding a text, with a ref and the button to click', async () => {
  await fresh()
  const result = await dlk(t => window.__dlk.find(t), '展开3条回复')
  assert.equal(result.count, 1)
  const [hit] = result.hits
  assert.equal(hit.tag, 'span')
  assert.match(hit.ref, /^[a-z]{3}\d+$/)
  assert.equal(hit.click.tag, 'button')
  const marked = await dlk(r => window.__dlk.markFirstClickable(`ref=${r}`), hit.click.ref)
  assert.equal(marked.usable, true)
  assert.equal(await page.getAttribute('[data-dlk-target]', 'id'), 'more')
})

test('a ref picks one of several elements that share a selector, and goes stale with the page', async () => {
  await fresh()
  const result = await dlk(() => window.__dlk.find('1758'))
  assert.equal(result.hits[0].matches, 3)
  const ref = result.hits[0].ref
  const probe = await dlk(r => window.__dlk.probe(`ref=${r}`), ref)
  assert.equal(probe.count, 1)
  assert.equal(probe.first[0].text, '1758')
  await fresh()
  const stale = await dlk(r => window.__dlk.probe(`ref=${r}`), ref)
  assert.equal(stale.count, 0)
  assert.match(stale.why, /not on the page any more/)
})

test('a selector that matched nothing says why', async () => {
  await fresh()
  const syntax = await dlk(() => window.__dlk.markFirstClickable(':nth-match(div.count, 2)'))
  assert.equal(syntax.found, 0)
  assert.match(syntax.why, /not a selector the engine understands/)
  const text = await dlk(() => window.__dlk.markFirstClickable('div.count:has-text("9999")'))
  assert.match(text.why, /div\.count matches 3 elements but none contains "9999" \("12", "1758", "40"\)/)
  const none = await dlk(() => window.__dlk.probe('div.missing'))
  assert.match(none.why, /nothing matches div\.missing/)
  const hasText = await dlk(() => window.__dlk.markFirstClickable('div.count:has-text("1758")'))
  assert.equal(hasText.usable, true)
})

test('html leaves out styles, comments, svg internals and inline styles, and shortens long runs and values', async () => {
  await fresh()
  const { html } = await dlk(() => window.__dlk.probe('#card', 1, true))
  assert.doesNotMatch(html, /a comment|<path|padding/)
  assert.match(html, /<svg class="icon"\/>/)
  assert.match(html, /<b class="tag">a<\/b><b class="tag">b<\/b> …\(3 more b\.tag\)/)
  assert.match(html, /href="https:\/\/example\.com\/[^"]{20,60}…\/in\/total\/index\.html"/)
  const host = await dlk(() => window.__dlk.probe('shadow-host', 1, true))
  assert.equal(host.html, '<shadow-host><template shadowrootmode="open"><p class="inner">inside the shadow</p></template></shadow-host>')
})

test('html that is still too long says how much there is and how to see the rest', async () => {
  await fresh()
  await dlk(() => {
    const big = document.createElement('div')
    big.id = 'big'
    big.innerHTML = Array.from({ length: 300 }, (_, i) => `<p class="p${i}">paragraph number ${i} with some words</p>`).join('')
    document.body.appendChild(big)
  })
  const { html } = await dlk(() => window.__dlk.probe('#big', 1, true))
  assert.match(html, /…\[cut at 4000 of \d+ chars\. For the rest, ask for the html of an element inside this one/)
})

test('an inspect that asks about elements is brief, and a click reports what it changed', async () => {
  const report = await inspectOnPage(page, { url: URL_OF_PAGE, clicks: ['button.more', 'button.noop', 'div.count:has-text("zz")'], probes: ['li.item'], find: ['nothing'] }, lib)
  assert.equal(report.brief, true)
  assert.equal(report.controls, undefined)
  assert.equal(report.textHead, undefined)
  const [more, noop, missing] = report.clicks
  assert.match(more.change, /×3 → ×8/)
  assert.match(noop.change, /no visible change/)
  assert.match(missing.result, /none contains "zz"/)
  const text = formatInspectReport({ ...report, browser: 'bundled' })
  assert.match(text, /OVERVIEW skipped/)
  assert.doesNotMatch(text, /CONTROLS|TEXT HEAD/)
  assert.match(text, /FIND "nothing" {2}×1/)
  assert.match(text, /li\.item {2}×8/)
  assert.match(text, /· \[ref=[a-z]{3}\d+\] new reply 4/)
})

test('a plain inspect still gives the full overview, with refs on controls', async () => {
  const report = await inspectOnPage(page, { url: URL_OF_PAGE }, lib)
  assert.equal(report.brief, false)
  const text = formatInspectReport({ ...report, browser: 'bundled' })
  assert.match(text, /CONTROLS/)
  assert.match(text, /TEXT HEAD/)
  assert.match(text, /- \[ref=[a-z]{3}\d+\] #more {2}button {2}"展开3条回复"/)
})

const TREE_PAGE = `<!doctype html><html><head><meta charset="utf-8"></head><body>
<div class="wrap"><div class="inner"><section id="comments">
  <comment-thread><span slot="who">ann</span></comment-thread>
  <comment-thread><span slot="who">bob</span></comment-thread>
  <comment-thread><span slot="who">cid</span></comment-thread>
  <comment-thread><span slot="who">dan</span></comment-thread>
</section></div></div>
<div id="hidden" style="display:none"><p>secret text</p></div>
<div class="deco"><div class="layers">
  <div class="layer"><i></i><i></i></div><div class="layer"><i></i><i></i></div><div class="layer"><i></i><i></i></div><div class="layer"><i></i><i></i></div>
</div></div>
<script>
  customElements.define('comment-thread', class extends HTMLElement {
    constructor() {
      super()
      this.attachShadow({ mode: 'open' }).innerHTML = '<style>p { margin: 0 }</style><div class="head"><slot name="who"></slot></div><p class="body">hello</p><button class="more"><span>共3条回复</span></button>'
    }
  })
</script>
</body></html>`
const TREE_URL = `data:text/html;charset=utf-8,${encodeURIComponent(TREE_PAGE)}`

test('the page tree shows shadow and slotted content in place, folds repeats and leaves out hidden and decorative parts', async () => {
  await page.goto(TREE_URL)
  await page.evaluate(installDlk)
  const { text, lines } = await dlk(() => window.__dlk.tree())
  assert.match(text, /^ {2}div\.wrap > div\.inner > section#comments$/m)
  assert.match(text, /^ {4}comment-thread \(shadow\)\n {6}div\.head > span "ann"\n {6}p\.body "hello"\n {6}button\.more \[ref=[a-z]{3}\d+\]\n {8}span "共3条回复"$/m)
  assert.match(text, /…\(2 more comment-thread\)/)
  assert.doesNotMatch(text, /secret|"cid"|"dan"/)
  assert.match(text, /div\.deco > div\.layers \[ref=[a-z]{3}\d+\] \{\+\d+ lines, no text\}/)
  assert.ok(lines > text.split('\n').length)
  // The button's ref clicks the button inside the shadow root.
  const ref = text.match(/button\.more \[ref=(\w+)\]/)[1]
  assert.equal((await dlk(r => window.__dlk.markFirstClickable(`ref=${r}`), ref)).usable, true)
})

test('a page tree over budget closes parts with a ref, and tree(ref) opens one', async () => {
  await page.goto(TREE_URL)
  await page.evaluate(installDlk)
  await dlk(() => {
    for (let s = 0; s < 40; s += 1) {
      const section = document.createElement('section')
      section.className = `part-${s}`
      section.innerHTML = Array.from({ length: 10 }, (_, i) => `<p class="line-${i}">section ${s} line ${i} with some words</p>`).join('')
      document.body.appendChild(section)
    }
  })
  const whole = await dlk(() => window.__dlk.tree())
  assert.ok(whole.text.length <= 5600, `tree is ${whole.text.length} chars`)
  const closed = whole.text.match(/section\.part-(\d+) \[ref=(\w+)\] \{\+10 lines: "section \d+ line 0 with some words[^"]*…"\}/)
  assert.ok(closed, whole.text.slice(-600))
  const part = await dlk(r => window.__dlk.tree(`ref=${r}`), closed[2])
  assert.equal(part.lines, 11)
  assert.match(part.text, new RegExp(`^section\\.part-${closed[1]}\\n {2}p\\.line-0 "section ${closed[1]} line 0 with some words"`))
  const missing = await dlk(() => window.__dlk.tree('div.nowhere'))
  assert.match(missing.why, /nothing matches div\.nowhere/)
})

test('the report carries the tree, a SHADOW note, and the parts asked for with tree', async () => {
  const full = formatInspectReport({ ...(await inspectOnPage(page, { url: TREE_URL }, lib)), browser: 'bundled' })
  assert.match(full, /^SHADOW {3}4 open shadow roots/m)
  assert.match(full, /\nTREE \(the page as it renders, \d+ lines in all:[^\n]*\nbody\n {2}div\.wrap/)
  const brief = await inspectOnPage(page, { url: TREE_URL, tree: ['comment-thread'] }, lib)
  assert.equal(brief.brief, true)
  assert.equal(brief.tree, undefined)
  const text = formatInspectReport({ ...brief, browser: 'bundled' })
  assert.match(text, /\nTREE comment-thread \(first of 4\) {2}\d+ lines in all\ncomment-thread \(shadow\)\n {2}div\.head > span "ann"/)
  assert.doesNotMatch(text, /CONTROLS/)
})

// A real page (scroll-behavior: smooth on html and body): the read right after scrollTo saw the old position, and
// three of those in a row stopped a scrape that was still loading rows as scroll-blocked.
test('a scroll step moves at once on a page that scrolls smoothly', async () => {
  const smooth = `<!doctype html><html style="scroll-behavior: smooth"><body style="scroll-behavior: smooth"><div style="height: 5000px">tall</div></body></html>`
  await page.goto(`data:text/html;charset=utf-8,${encodeURIComponent(smooth)}`)
  await page.evaluate(installDlk)
  const step = await dlk(() => window.__dlk.scrollStep(null, 0))
  assert.equal(step.before, 0)
  assert.ok(step.after > 4000, `after ${step.after}`)
  assert.equal(step.atBottom, true)
})
