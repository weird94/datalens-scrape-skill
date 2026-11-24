// The host's stop (the user's "stop here", the points budget) is heard between expand passes, not only between
// pages: a record whose own pager runs for many pages (replies under a comment) keeps one round going for a
// long time, and the run has to end there with what it has read.
// Run with `node --test scripts/expand-host-stop.test.mjs`.
import assert from 'node:assert/strict'
import { after, before, test } from 'node:test'
import { chromium } from 'playwright'
import { collectOnPage, gotoAndSettle, installDlk, runSetup, settle } from './lib/index.mjs'

// Three comments, each with its replies under it and a pager for them: "next" swaps in the next 3 replies, for
// 12 pages. The comment and its replies are rows of the same list. Each page's replies are as long as real ones
// are: of other lengths than the page before (the collector sees the swap by the page's text length).
const PAGES = 12
const PAGE = `<!doctype html><html><head><meta charset="utf-8"></head><body>
<div id="feed"></div>
<script>
  window.__page = []
  const feed = document.getElementById('feed')
  for (let t = 0; t < 3; t += 1) {
    const thread = document.createElement('div')
    thread.className = 'thread'
    thread.innerHTML = '<div class="c"><span class="text">comment ' + t + '</span></div><div class="replies"></div>' +
      '<div class="pager"><button class="next">next</button></div>'
    const replies = thread.querySelector('.replies')
    window.__page[t] = 1
    const show = () => {
      const p = window.__page[t]
      replies.innerHTML = [0, 1, 2].map(i => '<div class="c"><span class="text">reply ' + t + '-' + p + '-' + i + '</span>' +
        '<span class="said">' + 'ha'.repeat(p) + '</span></div>').join('')
    }
    show()
    thread.querySelector('.next').addEventListener('click', () => setTimeout(() => {
      window.__page[t] += 1
      show()
      if (window.__page[t] >= ${PAGES}) thread.querySelector('.pager').remove()
    }, 20))
    feed.appendChild(thread)
  }
</script>
</body></html>`
const CONFIG = {
  url: `data:text/html;charset=utf-8,${encodeURIComponent(PAGE)}`,
  rows: '.c',
  fields: { text: '.text' },
  expand: ['.next'],
  next: { type: 'none' },
}
const ALL_ROWS = 3 * (1 + PAGES * 3)

let browser
let page
before(async () => {
  browser = await chromium.launch()
  page = await browser.newPage()
})
after(async () => browser?.close())

test('a stop asked half-way through the records\' own pagers ends the run there, with the rows read so far', async () => {
  const asked = []
  const lib = {
    settle,
    gotoAndSettle,
    runSetup,
    installDlk,
    // The user presses "stop here" once 30 rows are in.
    shouldStop: rowCount => {
      asked.push(rowCount)
      return rowCount >= 30 ? 'stopped-by-user' : null
    },
  }
  const result = await collectOnPage(page, CONFIG, lib)
  const pagesShown = await page.evaluate(() => Math.max(...window.__page))

  assert.equal(result.stopReason, 'stopped-by-user')
  // Asked while page 1's round was still opening replies, not only once that round was over.
  assert.ok(asked.some(count => count > 0 && count < ALL_ROWS), JSON.stringify(asked))
  assert.ok(pagesShown < PAGES / 2, `the pagers went on to page ${pagesShown} of ${PAGES}`)
  // What was read before the stop is kept: the comments and the replies of the pages shown.
  assert.ok(result.rows.length >= 30 && result.rows.length < ALL_ROWS / 2, `${result.rows.length} rows`)
  const texts = new Set(result.rows.map(row => row.text))
  for (const text of ['comment 0', 'comment 1', 'comment 2', 'reply 0-1-0', 'reply 2-2-2']) assert.ok(texts.has(text), text)
  // A stop by the host is no reason to report controls among the rows as left unclicked.
  assert.equal(result.expandMissed?.length ?? 0, 0, JSON.stringify(result.expandMissed))
})

test('without a stop, the same pagers are read to their last page', async () => {
  const lib = { settle, gotoAndSettle, runSetup, installDlk }
  const result = await collectOnPage(page, CONFIG, lib)
  assert.equal(result.stopReason, 'single-page')
  assert.equal(result.rows.length, ALL_ROWS)
})
