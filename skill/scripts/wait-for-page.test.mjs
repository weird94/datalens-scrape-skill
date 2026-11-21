// Waiting for the page after an action: content that arrives inside shadow roots, and content that
// arrives after a silent gap (a request on its way). Run with `node --test scripts/wait-for-page.test.mjs`.
import assert from 'node:assert/strict'
import { after, before, test } from 'node:test'
import { chromium } from 'playwright'
import { gotoAndSettle, inspectOnPage, installDlk, runSetup, settle } from './lib/index.mjs'

// Everything the page shows lives in one component's shadow root. "grow" adds a line every 300ms, eight
// times; "slow" answers once, after 2.5s of nothing at all.
const PAGE = `<!doctype html><html><head><meta charset="utf-8"></head><body>
<the-list></the-list>
<script>
  const root = document.querySelector('the-list').attachShadow({ mode: 'open' })
  root.innerHTML = '<ul id="items"><li class="item">first</li><li class="item">second</li><li class="item">third</li></ul><button id="grow">grow</button><button id="slow">view replies</button>'
  const items = root.getElementById('items')
  const add = text => {
    const li = document.createElement('li')
    li.className = 'item'
    li.textContent = text
    items.appendChild(li)
  }
  root.getElementById('grow').addEventListener('click', () => {
    let n = 0
    const timer = setInterval(() => {
      n += 1
      add('grown ' + n)
      if (n >= 8) clearInterval(timer)
    }, 300)
  })
  root.getElementById('slow').addEventListener('click', () => setTimeout(() => add('a reply that took its time'), 2500))
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

const itemCount = () => page.evaluate(() => document.querySelector('the-list').shadowRoot.querySelectorAll('.item').length)

test('settle waits while content keeps arriving inside a shadow root', async () => {
  await page.goto(URL_OF_PAGE)
  await page.evaluate(installDlk)
  await page.evaluate(() => document.querySelector('the-list').shadowRoot.getElementById('grow').click())
  await settle(page, { quietMs: 800, maxMs: 8000 })
  assert.equal(await itemCount(), 11)
})

test('an inspect click waits for what the click asked for, not just for a quiet page', async () => {
  const report = await inspectOnPage(page, { url: URL_OF_PAGE, clicks: ['#slow'], probes: ['.item'] }, lib)
  const [slow] = report.clicks
  assert.doesNotMatch(slow.change, /no visible change/)
  assert.equal(await itemCount(), 4)
})

test('an inspect click that does nothing says how long it waited', async () => {
  const report = await inspectOnPage(page, { url: URL_OF_PAGE, clicks: ['.item'] }, lib)
  assert.match(report.clicks[0].change, /no visible change .*within \d+s/)
})
