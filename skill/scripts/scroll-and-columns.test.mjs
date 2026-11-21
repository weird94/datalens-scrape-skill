// Scrolling a list whose end is not the end of the page, and telling what the rows show that no column reads.
// Run with `node --test scripts/scroll-and-columns.test.mjs`.
import assert from 'node:assert/strict'
import { after, before, test } from 'node:test'
import { chromium } from 'playwright'
import { collectOnPage, gotoAndSettle, inspectOnPage, installDlk, runSetup, settle } from './lib/index.mjs'

// 30 items in three batches. The next batch loads when the sentinel after the list comes into view; the
// column beside the list is far taller than the list, so the bottom of the page is nowhere near the sentinel.
const PAGE = `<!doctype html><html><head><meta charset="utf-8">
<style>html { scroll-behavior: smooth } .layout { display: flex } .item { height: 60px } .side { width: 200px; height: 30000px }</style></head><body>
<div class="layout"><div class="main"><div id="list"></div><div id="sentinel" style="height: 1px"></div></div><div class="side">side</div></div>
<script>
  const list = document.getElementById('list')
  let loaded = 0
  const add = () => {
    for (let i = 0; i < 10; i += 1) {
      loaded += 1
      const item = document.createElement('div')
      item.className = 'item'
      item.innerHTML = '<b class="who">user ' + loaded + '</b> <span class="level">LV' + (loaded % 6) + '</span><p class="text">text ' + loaded + '</p>'
        + '<time class="when">2026-10-' + String(1 + (loaded % 27)).padStart(2, '0') + '</time> <button class="like"><i></i><span class="n">' + loaded * 3 + '</span></button> <button class="reply">reply</button>'
      list.appendChild(item)
    }
  }
  add()
  const observer = new IntersectionObserver(entries => {
    if (!entries.some(entry => entry.isIntersecting) || loaded >= 30) return
    setTimeout(add, 150)
  })
  observer.observe(document.getElementById('sentinel'))
</script>
</body></html>`
const URL_OF_PAGE = `data:text/html;charset=utf-8,${encodeURIComponent(PAGE)}`
const lib = { settle, gotoAndSettle, runSetup, installDlk }

let browser
let page
before(async () => {
  browser = await chromium.launch()
  page = await browser.newPage({ viewport: { width: 1000, height: 700 } })
})
after(async () => browser?.close())

test('scrolling brings the end of the list into view, so a list shorter than its page still loads more', async () => {
  const config = { url: URL_OF_PAGE, rows: '.item', fields: { who: '.who', text: '.text' }, next: { type: 'scroll' } }
  const result = await collectOnPage(page, config, lib)
  assert.equal(result.rows.length, 30)
  assert.equal(result.stopReason, 'scroll-end')
})

// The whole list fits on the screen and its first price ticks: scrolling by default must not read the
// ticking row again and again as new rows.
const TICKER = `<!doctype html><html><head><meta charset="utf-8"></head><body><ul id="list">${Array.from(
  { length: 20 },
  (_, i) => `<li class="item">item ${i + 1} <span class="price">${100 + i}</span></li>`
).join('')}</ul>
<script>
  const price = document.querySelector('#list .price')
  let value = 100
  setInterval(() => { value += 1; price.textContent = String(value) }, 300)
</script></body></html>`

test('a page that does not scroll is read once, so a ticking price is not taken for new rows', async () => {
  const config = { url: `data:text/html;charset=utf-8,${encodeURIComponent(TICKER)}`, rows: '#list > li', fields: { text: '.' } }
  const result = await collectOnPage(page, config, lib)
  assert.equal(result.rows.length, 20)
  assert.equal(result.stopReason, 'single-page')
})

test('an inspect scroll passes over the page instead of jumping to its bottom', async () => {
  const report = await inspectOnPage(page, { url: URL_OF_PAGE, scroll: true, probes: ['.item'] }, lib)
  assert.ok(report.probes[0].count > 10, `items after one scroll: ${report.probes[0].count}`)
})

test('the parts of a row that no column reads are named: texts, and numbers inside buttons, not button labels', async () => {
  const short = await collectOnPage(page, { url: URL_OF_PAGE, rows: '.item', fields: { who: '.who', text: '.text' }, next: { type: 'none' } }, lib)
  assert.deepEqual(
    short.unreadParts.parts.map(part => part.selector).sort(),
    ['button.like span.n', 'div.item span.level', 'div.item time.when']
  )
  const whole = await collectOnPage(
    page,
    { url: URL_OF_PAGE, rows: '.item', fields: { who: '.who', level: '.level', text: '.text', when: '.when', likes: '.like .n' }, next: { type: 'none' } },
    lib
  )
  assert.equal(whole.unreadParts, null)
})
