// Recognising a row read again: a picture that loads late, a count that ticks, the preview's rows — the same
// record, not a new row. Two records that only look alike stay two rows.
// Run with `node --test scripts/row-identity.test.mjs`.
import assert from 'node:assert/strict'
import { after, before, test } from 'node:test'
import { chromium } from 'playwright'
import { collectOnPage, gotoAndSettle, installDlk, runSetup, settle } from './lib/index.mjs'
import { rowIdentity } from './lib/row-identity.mjs'

const { isLiveNumber, isMediaUrl } = rowIdentity()

test('values that change while the record stays: counts, prices, clocks, elapsed time', () => {
  for (const value of [
    '38', '874', '1.2万', '3.4万次播放', '1.2K views', '-0.05 (-0.85%)', '2:31', '$1.32T', '2,801円',
    '1.234 Aufrufe', '12 commentaires', '1,2 тыс. просмотров', '1,234回再生', '1,234회', '3 hours ago',
    '3分钟前', '120 me gusta', '1234人付款', 'USD 1,299.00', 'Rp 15.000', '١٬٢٣٤٫٥٠ ر.س', '+٠٫٣٥٪',
    '۱۲۰٬۰۰۰ تومان', '₹1,23,456',
  ]) {
    assert.equal(isLiveNumber(value), true, value)
  }
})

test("values that are the record's own: dates, identifiers, specs, attribute words", () => {
  for (const value of [
    '2026-10-25 20:46', '3 bedrooms', '5 min read', '350 Seiten', '4人', '73 个讲座', '9 Mar', 'PHP 8',
    'TOP 10', 'AMD 7950', '+86 138 0013 8000', '(555) 123 4567', '12.03.2024', '192.168.0.1', '100234',
    '128GB', 'iPhone 15', 'level 6', '',
  ]) {
    assert.equal(isLiveNumber(value), false, value)
  }
})

test('pictures and video by their address', () => {
  assert.equal(isMediaUrl('https://i1.hdslb.com/bfs/face/0c1e3584.jpg@96w_96h_1c_1s.avif'), true)
  assert.equal(isMediaUrl('//cdn.example.com/a/b.webp?x=1'), true)
  assert.equal(isMediaUrl('data:image/png;base64,iVBOR'), true)
  assert.equal(isMediaUrl('https://space.bilibili.com/325545539'), false)
  assert.equal(isMediaUrl('https://example.com/item.html'), false)
  assert.equal(isMediaUrl('photo.jpg'), false)
})

// 30 comments in three batches, loaded when the end of the list comes into view. A comment's avatar gets
// its address only once the comment is on screen, from the page's script (no data-src to read before);
// comment 1's likes tick. Comment 25 is comment 4's
// words posted again by the same user: another record.
const COMMENTS = `<!doctype html><html><head><meta charset="utf-8">
<style>.c { height: 90px } .avatar { width: 20px; height: 20px }</style></head><body>
<div id="list"></div><div id="sentinel" style="height: 1px"></div>
<script>
  const list = document.getElementById('list')
  const FACES = new WeakMap()
  const seen = new IntersectionObserver(entries => {
    for (const entry of entries) {
      if (!entry.isIntersecting) continue
      const img = entry.target.querySelector('.avatar')
      setTimeout(() => { img.src = FACES.get(img) }, 100)
      seen.unobserve(entry.target)
    }
  })
  let loaded = 0
  const add = () => {
    for (let i = 0; i < 10; i += 1) {
      loaded += 1
      const n = loaded === 25 ? 4 : loaded
      const item = document.createElement('div')
      item.className = 'c'
      item.innerHTML = '<img class="avatar"><b class="who">user ' + n + '</b><p class="text">words ' + n + '</p><span class="likes">' + (loaded * 3) + '</span>'
      FACES.set(item.querySelector('.avatar'), 'https://img.example.com/face/' + n + '.jpg@48w.avif')
      list.appendChild(item)
      seen.observe(item)
    }
  }
  add()
  const likes = list.querySelector('.likes')
  setInterval(() => { likes.textContent = String(Number(likes.textContent) + 1) }, 400)
  new IntersectionObserver(entries => {
    if (entries.some(entry => entry.isIntersecting) && loaded < 30) setTimeout(add, 150)
  }).observe(document.getElementById('sentinel'))
</script></body></html>`
const COMMENTS_URL = `data:text/html;charset=utf-8,${encodeURIComponent(COMMENTS)}`
const COMMENTS_CONFIG = {
  url: COMMENTS_URL,
  rows: '#list > .c',
  fields: { who: '.who', text: '.text', avatar: { css: '.avatar', attr: 'src' }, likes: '.likes' },
}
const lib = { settle, gotoAndSettle, runSetup, installDlk }

let browser
let page
before(async () => {
  browser = await chromium.launch()
  page = await browser.newPage({ viewport: { width: 1000, height: 600 } })
})
after(async () => browser?.close())

const words = rows => rows.map(row => row.text)

test('a comment read again once its avatar loaded and its likes ticked is the same row', async () => {
  const result = await collectOnPage(page, COMMENTS_CONFIG, lib)
  const expected = Array.from({ length: 30 }, (_, i) => `words ${i === 24 ? 4 : i + 1}`)
  assert.deepEqual(words(result.rows), expected)
  // What the page showed last is kept: the avatars that loaded.
  assert.ok(result.rows.filter(row => row.avatar).length >= 25, `avatars: ${result.rows.filter(row => row.avatar).length}`)
})

test("the preview's rows, read before their avatars loaded, are not taken again", async () => {
  const seedRows = Array.from({ length: 6 }, (_, i) => ({ who: `user ${i + 1}`, text: `words ${i + 1}`, avatar: '', likes: String((i + 1) * 3) }))
  const result = await collectOnPage(page, COMMENTS_CONFIG, { ...lib, seedRows })
  assert.deepEqual(words(result.rows), Array.from({ length: 30 }, (_, i) => `words ${i === 24 ? 4 : i + 1}`))
  assert.ok(result.rows[1].avatar, 'the seeded row got the avatar the page showed later')
})

// Two pages drawn into the same three list items. Each page has a "Widget" at another price: two products.
const PAGED = `<!doctype html><html><head><meta charset="utf-8"></head><body>
<ul id="list"><li><b class="name"></b> <span class="price"></span></li><li><b class="name"></b> <span class="price"></span></li><li><b class="name"></b> <span class="price"></span></li></ul>
<button id="next">Next</button>
<script>
  const PAGES = [[['Apple', '$1'], ['Widget', '$10'], ['Pear', '$2']], [['Plum', '$3'], ['Widget', '$12'], ['Fig', '$4']]]
  const show = p => document.querySelectorAll('#list li').forEach((li, i) => {
    li.querySelector('.name').textContent = PAGES[p][i][0]
    li.querySelector('.price').textContent = PAGES[p][i][1]
  })
  show(0)
  document.getElementById('next').addEventListener('click', e => { show(1); e.target.remove() })
</script></body></html>`

test('a look-alike on the next page drawn into the same element is another record', async () => {
  const config = {
    url: `data:text/html;charset=utf-8,${encodeURIComponent(PAGED)}`,
    rows: '#list > li',
    fields: { name: '.name', price: '.price' },
    next: { type: 'click', selector: '#next' },
  }
  const result = await collectOnPage(page, config, lib)
  assert.deepEqual(result.rows.map(row => `${row.name} ${row.price}`), ['Apple $1', 'Widget $10', 'Pear $2', 'Plum $3', 'Widget $12', 'Fig $4'])
})
