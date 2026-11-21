// Where the collector puts rows that expand clicks bring: each reply under its own comment, also when
// the same words appear twice on a page, under several comments, or when the run stops at maxRows.
// Run with `node --test scripts/collector-order.test.mjs`.
import assert from 'node:assert/strict'
import { after, before, test } from 'node:test'
import { chromium } from 'playwright'
import { collectOnPage, gotoAndSettle, installDlk, runSetup, settle } from './lib/index.mjs'

// Four comments. Their replies sit behind "view replies"; comment 2 pages its replies, a page turn
// replaces them. "spam / same words" is posted under comments 1, 2 (page 2) and 3; "echo / twice" twice in
// a row under comment 2.
const PAGE = `<!doctype html><html><head><meta charset="utf-8"></head><body>
<div id="feed"></div>
<script>
  const THREADS = [
    { pages: [[['a', 'r1-1'], ['b', 'r1-2'], ['spam', 'same words'], ['c', 'r1-3']]] },
    { pages: [[['d', 'r2-1'], ['e', 'r2-2'], ['echo', 'twice'], ['echo', 'twice'], ['f', 'r2-3']], [['g', 'r2-4'], ['spam', 'same words'], ['h', 'r2-5']]] },
    { pages: [[['spam', 'same words'], ['i', 'r3-1']]] },
    { pages: [] },
  ]
  const feed = document.getElementById('feed')
  THREADS.forEach((thread, index) => {
    const box = document.createElement('div')
    box.className = 'thread'
    box.innerHTML = '<div class="comment"><b class="who">u' + (index + 1) + '</b><p class="text">c' + (index + 1) + '</p></div><div class="replies"></div>'
    const replies = box.querySelector('.replies')
    const show = page => {
      const items = thread.pages[page].map(([who, text]) => '<div class="reply"><b class="who">' + who + '</b><p class="text">' + text + '</p></div>').join('')
      const next = page + 1 < thread.pages.length ? '<button class="next">next</button>' : ''
      replies.innerHTML = items + next
      const button = replies.querySelector('.next')
      if (button) button.addEventListener('click', () => setTimeout(() => show(page + 1), 40))
    }
    if (thread.pages.length) {
      replies.innerHTML = '<button class="more">view replies</button>'
      replies.querySelector('.more').addEventListener('click', () => setTimeout(() => show(0), 40))
    }
    feed.appendChild(box)
  })
</script>
</body></html>`
const URL_OF_PAGE = `data:text/html;charset=utf-8,${encodeURIComponent(PAGE)}`
const lib = { settle, gotoAndSettle, runSetup, installDlk }
const CONFIG = {
  url: URL_OF_PAGE,
  rows: '.comment, .reply',
  fields: { who: '.who', text: '.text' },
  expand: ['.more', '.next'],
}

let browser
let page
before(async () => {
  browser = await chromium.launch()
  page = await browser.newPage()
})
after(async () => browser?.close())

const texts = rows => rows.map(row => row.text)

test('replies stay under their own comment when the same words repeat on a page and under other comments', async () => {
  const result = await collectOnPage(page, CONFIG, lib)
  assert.deepEqual(texts(result.rows), [
    'c1', 'r1-1', 'r1-2', 'same words', 'r1-3',
    'c2', 'r2-1', 'r2-2', 'twice', 'r2-3', 'r2-4', 'r2-5',
    'c3', 'r3-1',
    'c4',
  ])
  // Comment 2's last page is shorter than its first: fewer rows on the page, but nothing was hidden.
  assert.equal(result.expandShrank, null)
  assert.equal(result.expandNoEffect, null)
  assert.deepEqual(result.expandMissed, [])
})

test('rows taken up to maxRows are in page order, not appended after the rows read before the clicks', async () => {
  const result = await collectOnPage(page, { ...CONFIG, maxRows: 6 }, lib)
  assert.equal(result.stopReason, 'max-rows')
  assert.deepEqual(texts(result.rows), ['c1', 'r1-1', 'r1-2', 'c2', 'c3', 'c4'])
  // What the limit left unread on that read: 2 more under c1, 5 under c2, 2 under c3 — the elements no
  // read has taken yet, not the four comments an earlier read already took.
  assert.equal(result.rounds[0].cutAtMaxRows, 9)
})

test('a column filled down from the comment keeps the same words under several comments as rows of their own', async () => {
  // "under" reads only on a comment row; the replies inherit it, and it is part of the dedupe key.
  const config = { ...CONFIG, fields: { ...CONFIG.fields, under: ':scope.comment > .text' }, fillDown: ['under'] }
  const result = await collectOnPage(page, config, lib)
  assert.deepEqual(
    result.rows.map(row => `${row.under}/${row.text}`),
    [
      'c1/c1', 'c1/r1-1', 'c1/r1-2', 'c1/same words', 'c1/r1-3',
      'c2/c2', 'c2/r2-1', 'c2/r2-2', 'c2/twice', 'c2/r2-3', 'c2/r2-4', 'c2/same words', 'c2/r2-5',
      'c3/c3', 'c3/same words', 'c3/r3-1',
      'c4/c4',
    ]
  )
})

// Two comments page their replies with a "next" button that stays the same element. A turn of the slow one
// takes far longer than the fast one's, and — as on real sites — a click while a turn is on its way moves
// one page further: the page in between is never shown.
const PAGED = `<!doctype html><html><head><meta charset="utf-8"></head><body>
<div id="feed"></div>
<script>
  const SPEED = { slow: 2500, fast: 60 }
  for (const name of ['slow', 'fast']) {
    const box = document.createElement('div')
    box.className = 'thread'
    box.innerHTML = '<div class="comment"><b class="who">' + name + '</b><p class="text">' + name + '</p></div><div class="replies"></div><button class="next">next</button>'
    const replies = box.querySelector('.replies')
    const next = box.querySelector('.next')
    let page = 1
    let asked = 1
    const show = () => {
      // Each page is a little longer than the one before, so a turn shows in the size of the page.
      replies.innerHTML = [1, 2].map(n => '<div class="reply"><b class="who">' + name + '</b><p class="text">' + name + ' p' + page + '-' + n + '!'.repeat(page) + '</p></div>').join('')
      if (page >= 4) next.remove()
    }
    next.addEventListener('click', () => {
      asked = Math.min(4, asked + 1)
      const to = asked
      setTimeout(() => {
        if (asked !== to) return
        page = to
        show()
      }, SPEED[name])
    })
    show()
    document.getElementById('feed').appendChild(box)
  }
</script>
</body></html>`

test('a pager whose turn is still on its way is not clicked again, so no page of replies is skipped', async () => {
  const config = { ...CONFIG, url: `data:text/html;charset=utf-8,${encodeURIComponent(PAGED)}`, expand: ['.next'] }
  const result = await collectOnPage(page, config, lib)
  const pages = name => [1, 2, 3, 4].flatMap(p => [`${name} p${p}-1${'!'.repeat(p)}`, `${name} p${p}-2${'!'.repeat(p)}`])
  assert.deepEqual(texts(result.rows), ['slow', ...pages('slow'), 'fast', ...pages('fast')])
})
