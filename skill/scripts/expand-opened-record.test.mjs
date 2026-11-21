// A record whose expand button opens it in place: the collapsed card shows a cut-off text, and only the
// opened card shows who wrote it and when. The row the collector keeps is the opened record.
// Run with `node --test scripts/expand-opened-record.test.mjs`.
import assert from 'node:assert/strict'
import { after, before, test } from 'node:test'
import { chromium } from 'playwright'
import { collectOnPage, gotoAndSettle, installDlk, runSetup, settle } from './lib/index.mjs'

// Eight posts. Collapsed, a post shows its title, "<writer>: <start of the text>…" and an "Open" button;
// opened (after a short wait), it shows the writer's name and link, the date, and the whole text without
// the "<writer>: " label in front. Post 4's cut falls inside "&amp;", so the cut-off text ends in "&am".
// Post 6's collapsed text is a teaser that the opened text does not start with. Post 7 is one short line,
// cut-marked all the same: "<writer>: <the whole line>…"; post 8 is one short line without a cut mark.
const PAGE = `<!doctype html><html><head><meta charset="utf-8"></head><body>
<div id="feed"></div>
<script>
  const POSTS = [
    ['Why do trains run late in winter?', 'Ana Lee', 'Cold rails shrink and crack, so lines run slower in winter to stay safe. Crews also clear ice from the points every morning.'],
    ['How do bees find their way home?', 'Bo Chen', 'Bees use the sun as a compass and remember landmarks near the hive. On cloudy days they read polarised light instead.'],
    ['Is it worth learning to type fast?', 'Cara Diaz', 'Typing fast matters less than thinking clearly, but it removes friction. Most people reach sixty words a minute with a month of practice.'],
    ['What makes bread rise?', 'Dev Rao', 'Yeast eats sugar and gives off gas, and gluten traps it like a balloon. Salt &amp; warmth control how fast that happens.'],
    ['Why is the sea salty?', 'Eli Moss', 'Rain wears minerals out of rocks and rivers carry them to the sea. The water evaporates, the salt stays behind.'],
    ['How do noise-cancelling headphones work?', 'Fay Kim', 'A microphone hears the outside noise and the speaker plays the opposite wave, so the two cancel out before reaching your ear.'],
    ['Should I learn Rust?', 'Gil Ross', 'Yes, if you enjoy it.'],
    ['Is a standing desk worth it?', 'Hal Ng', 'Not worth it, honestly.'],
  ]
  const CUT = 80
  const feed = document.getElementById('feed')
  POSTS.forEach(([title, writer, text], index) => {
    const card = document.createElement('div')
    card.className = 'card'
    const link = '/post/' + (index + 1)
    const plain = text.replace('&amp;', '&')
    // Post 2's teaser is spaced differently from its opened text (as teasers do around inline links and code).
    const lead = index === 1 ? text.replace('sun as', 'sun as ').replace('compass', ' compass') : text
    const teaser = index === 5 ? 'Short answer: physics. Long answer inside…' : index === 7 ? writer + ': ' + text : writer + ': ' + lead.slice(0, CUT) + '…'
    const collapsed = () => {
      card.innerHTML = '<h2 class="title"><a href="' + link + '">' + title + '</a></h2>' +
        '<div class="body"><span class="text"></span><button class="open">Open</button></div>' +
        '<div class="bar"><button class="vote">Upvote ' + (10 + index) + '</button></div>'
      card.querySelector('.text').textContent = teaser
      card.querySelector('.open').addEventListener('click', () => setTimeout(opened, 60))
    }
    const opened = () => {
      card.innerHTML = '<h2 class="title"><a href="' + link + '">' + title + '</a></h2>' +
        '<div class="byline"><a class="writer" href="/people/' + (index + 1) + '">' + writer + '</a></div>' +
        '<div class="body"><span class="text"></span><div class="when">Posted 2026-11-0' + (index + 1) + '</div></div>' +
        '<div class="bar"><button class="vote">Upvote ' + (10 + index) + '</button></div>'
      card.querySelector('.text').textContent = plain
    }
    collapsed()
    feed.appendChild(card)
  })
</script>
</body></html>`
const URL_OF_PAGE = `data:text/html;charset=utf-8,${encodeURIComponent(PAGE)}`
const lib = { settle, gotoAndSettle, runSetup, installDlk }
const CONFIG = {
  url: URL_OF_PAGE,
  rows: '.card',
  fields: {
    title: '.title',
    link: { css: '.title a', attr: 'href' },
    writer: '.byline .writer',
    writer_link: { css: '.byline .writer', attr: 'href' },
    posted: '.when',
    text: '.text',
  },
  expand: ['.open'],
  dedupe: ['link'],
}

let browser
let page
before(async () => {
  browser = await chromium.launch()
  page = await browser.newPage()
})
after(async () => browser?.close())

test('a record opened by its expand button keeps what the opened record shows', async () => {
  const result = await collectOnPage(page, CONFIG, lib)
  assert.equal(result.rows.length, 8)
  assert.deepEqual(
    result.rows.map(row => row.writer),
    ['Ana Lee', 'Bo Chen', 'Cara Diaz', 'Dev Rao', 'Eli Moss', 'Fay Kim', 'Gil Ross', 'Hal Ng']
  )
  assert.ok(result.rows.every(row => row.posted.startsWith('Posted 2026-11-0')), JSON.stringify(result.rows.map(row => row.posted)))
  assert.ok(result.rows.every(row => row.writer_link.includes('/people/')))
  // Posts 1–5, 7 and 8: "<writer>: <start>…" (or the whole short line) became the whole text, without the label.
  for (const row of [...result.rows.slice(0, 5), ...result.rows.slice(6)]) {
    assert.ok(!row.text.endsWith('…'), `still cut off: ${row.text}`)
    assert.ok(!row.text.includes(`${row.writer}:`), `label kept: ${row.text}`)
  }
  assert.ok(result.rows[3].text.includes('Salt & warmth'), result.rows[3].text)
  assert.equal(result.rows[6].text, 'Yes, if you enjoy it.')
  assert.equal(result.rows[7].text, 'Not worth it, honestly.')
  // Post 6's teaser is not the start of its text: that cell keeps the first value and says so.
  assert.equal(result.rows[5].text, 'Short answer: physics. Long answer inside…')
  assert.equal(result.expandReplaced, 1)
  assert.deepEqual(result.expandReplacedCells.map(cell => [cell.column, cell.rows]), [['text', 1]])
  assert.ok(result.expandReplacedCells[0].was.startsWith('Short answer'), result.expandReplacedCells[0].was)
  // Its teaser was cut off and the opened text is whole: the cells only the opened post shows were taken.
  assert.deepEqual(result.expandFilledCells.map(cell => cell.column).sort(), ['posted', 'writer', 'writer_link'])
  // What the expand selector clicked, by label: the confirmation card names it.
  assert.deepEqual(result.expandClicked, [{ selector: '.open', clicks: 8, labels: ['Open'] }])
})

// Three cards whose own pager ("next") swaps the item they show: the short cut-off line "Episode 1N…"
// becomes "Episode 1(N+1)…" and the next item has a picture the first one lacks. That is another item, not
// the first one opened: the row keeps the first item whole — its line, and no picture from the next item.
const PAGER_PAGE = `<!doctype html><html><head><meta charset="utf-8"></head><body>
<div id="list"></div>
<script>
  const list = document.getElementById('list')
  for (let index = 0; index < 3; index += 1) {
    const card = document.createElement('div')
    card.className = 'card'
    card.innerHTML = '<h2 class="title"><a href="/show/' + (index + 1) + '">Show ' + (index + 1) + '</a></h2>' +
      '<div class="item"><span class="line">Episode 1' + index + '…</span></div><button class="next">next</button>'
    card.querySelector('.next').addEventListener('click', () => setTimeout(() => {
      card.querySelector('.item').innerHTML = '<span class="line">Episode 1' + (index + 1) + '…</span><img class="pic" src="https://example.com/' + index + '.jpg">'
      card.querySelector('.next').remove()
    }, 60))
    list.appendChild(card)
  }
</script>
</body></html>`

test('a pager inside a record shows another item: the row keeps the first item and takes nothing from the next', async () => {
  const config = {
    url: `data:text/html;charset=utf-8,${encodeURIComponent(PAGER_PAGE)}`,
    rows: '.card',
    fields: { title: '.title', link: { css: '.title a', attr: 'href' }, line: '.line', pic: { css: '.pic', attr: 'src' } },
    expand: ['.next'],
    dedupe: ['link'],
  }
  const result = await collectOnPage(page, config, lib)
  assert.deepEqual(result.rows.map(row => row.line), ['Episode 10…', 'Episode 11…', 'Episode 12…'])
  assert.deepEqual(result.rows.map(row => row.pic), ['', '', ''])
  assert.equal(result.expandReplaced, 3)
  assert.deepEqual(result.expandFilledCells, [])
  assert.deepEqual(result.expandClicked, [{ selector: '.next', clicks: 3, labels: ['next'] }])
})

// Comments whose "Show N replies" buttons differ only in their count, and a second selector for a pager.
const REPLIES_PAGE = `<!doctype html><html><head><meta charset="utf-8"></head><body>
<div id="list"></div>
<script>
  const list = document.getElementById('list')
  ;[12, 3, 1200].forEach((count, index) => {
    const comment = document.createElement('div')
    comment.className = 'comment'
    comment.innerHTML = '<p class="text">Comment ' + index + '</p><button class="show">Show ' + count.toLocaleString('en-US') + ' replies</button>'
    comment.querySelector('.show').addEventListener('click', event => {
      event.target.outerHTML = '<div class="reply comment"><p class="text">Reply to ' + index + '</p></div>' +
        (index === 0 ? '<button class="page">Next page</button>' : '')
      const pager = comment.querySelector('.page')
      if (pager) pager.addEventListener('click', () => {
        pager.outerHTML = '<div class="reply comment"><p class="text">Reply 2 to ' + index + '</p></div>'
      })
    })
    list.appendChild(comment)
  })
</script>
</body></html>`

test('expand clicks are reported per selector, one label per kind of control whatever its count', async () => {
  const config = {
    url: `data:text/html;charset=utf-8,${encodeURIComponent(REPLIES_PAGE)}`,
    rows: '.comment',
    fields: { text: '.text' },
    expand: ['.show', '.page'],
  }
  const result = await collectOnPage(page, config, lib)
  assert.equal(result.rows.length, 7)
  assert.deepEqual(result.expandClicked, [
    { selector: '.show', clicks: 3, labels: ['Show 12 replies'] },
    { selector: '.page', clicks: 1, labels: ['Next page'] },
  ])
})
