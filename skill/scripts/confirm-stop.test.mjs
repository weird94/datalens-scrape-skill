// The host's say on whether a list ended (`confirmStop`): when the rules want to stop, the host is asked, and its
// answer decides. Run with `node --test scripts/confirm-stop.test.mjs`.
import assert from 'node:assert/strict'
import { after, before, test } from 'node:test'
import { chromium } from 'playwright'
import { collectOnPage, gotoAndSettle, installDlk, runSetup, settle } from './lib/index.mjs'

const lib = { settle, gotoAndSettle, runSetup, installDlk }

/** A feed loaded by scrolling: batches of 10 when the sentinel shows; batch `slowBatch` takes `slowMs`. */
function feed({ batches = 3, slowBatch = 0, slowMs = 0, extra = '', initial = 1 } = {}) {
  const page = `<!doctype html><html><head><meta charset="utf-8"><style>.item { height: 80px }</style></head><body>
<div id="list"></div><div id="sentinel" style="height: 1px"></div>${extra}
<script>
  const list = document.getElementById('list')
  let loaded = 0
  let batch = 0
  let busy = false
  const add = () => {
    for (let i = 0; i < 10; i += 1) {
      loaded += 1
      const item = document.createElement('div')
      item.className = 'item'
      item.innerHTML = '<b class="who">user ' + loaded + '</b><p class="text">text ' + loaded + '</p>'
      list.appendChild(item)
    }
    batch += 1
    busy = false
  }
  window.addMore = add
  for (let i = 0; i < ${initial}; i += 1) add()
  new IntersectionObserver(entries => {
    if (!entries.some(e => e.isIntersecting) || busy || batch >= ${batches}) return
    busy = true
    setTimeout(add, batch + 1 === ${slowBatch} ? ${slowMs} : 150)
  }).observe(document.getElementById('sentinel'))
</script></body></html>`
  return `data:text/html;charset=utf-8,${encodeURIComponent(page)}`
}

const config = (url, extra = {}) => ({ url, rows: '.item', fields: { who: '.who', text: '.text' }, next: { type: 'scroll' }, delayMs: 100, ...extra })

let browser
let page
before(async () => {
  browser = await chromium.launch()
  page = await browser.newPage({ viewport: { width: 1000, height: 700 } })
})
after(async () => browser?.close())

test('without the hook the rules decide alone, and no aiStop is reported', async () => {
  const result = await collectOnPage(page, config(feed(), { stagnantRounds: 1 }), lib)
  assert.equal(result.rows.length, 30)
  assert.equal(result.stopReason, 'scroll-end')
  assert.equal(result.aiStop, undefined)
})

test('a slow batch: the rules stop early alone; "still loading" from the host waits for it', async () => {
  const slow = feed({ slowBatch: 3, slowMs: 9000 })
  const alone = await collectOnPage(page, config(slow, { stagnantRounds: 1 }), lib)
  assert.equal(alone.rows.length, 20, 'the rules alone give up before the slow batch')

  const asked = []
  const result = await collectOnPage(page, config(slow, { stagnantRounds: 1 }), {
    ...lib,
    confirmStop: async request => {
      asked.push(request)
      return { verdict: request.rowCount < 30 ? 'still_loading' : 'complete', userMessage: 'done' }
    },
  })
  assert.equal(result.rows.length, 30)
  assert.equal(result.aiStop.outcome, 'confirmed-complete')
  assert.equal(result.aiStop.verdicts.at(-1), 'complete')
  assert.ok(asked.length >= 2)
  assert.equal(asked[0].stopReason, 'scroll-end')
  assert.equal(asked[0].evidence.listRootFound, true)
  assert.match(asked[0].evidence.tree, /rows collapsed/)
})

test('"complete" stops at once', async () => {
  let asks = 0
  const result = await collectOnPage(page, config(feed({ batches: 1 })), {
    ...lib,
    confirmStop: async () => {
      asks += 1
      return { verdict: 'complete' }
    },
  })
  assert.equal(result.rows.length, 10)
  assert.equal(asks, 1)
  assert.equal(result.aiStop.outcome, 'confirmed-complete')
})

test('a list that fits on the first screen asks too before ending as single-page', async () => {
  // Two batches are there from the start and fit on the screen; the third takes longer than the rules wait.
  const url = feed({ batches: 3, slowBatch: 3, slowMs: 9000, initial: 2 }).replace('height: 80px', 'height: 20px')
  const alone = await collectOnPage(page, config(url, { next: undefined }), lib)
  assert.equal(alone.stopReason, 'single-page')
  assert.equal(alone.rows.length, 20)

  const result = await collectOnPage(page, config(url, { next: undefined }), {
    ...lib,
    confirmStop: async ({ rowCount, stopReason }) => (rowCount < 30 ? { verdict: 'still_loading' } : { verdict: 'complete', userMessage: stopReason }),
  })
  assert.equal(result.rows.length, 30)
  assert.equal(result.aiStop.outcome, 'confirmed-complete')
  assert.equal(result.aiStop.verdicts[0], 'still_loading')
})

test('"incomplete" with a control: the host clicks a load-more button the config did not name', async () => {
  // Scrolling brings nothing more; a "Show more" button under the list adds 10 rows per click, up to 30.
  const url = feed({ batches: 1, extra: '<button id="more" onclick="if (document.querySelectorAll(\'.item\').length < 30) window.addMore(); else this.remove()">Show more</button>' })
  const result = await collectOnPage(page, config(url), {
    ...lib,
    confirmStop: async ({ evidence, rowCount }) => {
      const ref = evidence.tree.match(/button "Show more" \[ref=(e\d+)\]/)?.[1]
      if (rowCount >= 30) return { verdict: 'complete' }
      return ref ? { verdict: 'incomplete', remedy: { ref, action: 'click' } } : { verdict: 'no_evidence' }
    },
  })
  assert.equal(result.rows.length, 30)
  assert.equal(result.aiStop.remedies, 2)
  assert.equal(result.aiStop.outcome, 'confirmed-complete')
})

test('a control that signs in is never clicked: the run ends as possibly incomplete', async () => {
  const url = feed({ batches: 1, extra: '<button id="login" onclick="window.addMore()">Sign in to see more</button>' })
  const result = await collectOnPage(page, config(url, { stagnantRounds: 1 }), {
    ...lib,
    confirmStop: async ({ evidence }) => {
      const ref = evidence.tree.match(/button "Sign in to see more" \[ref=(e\d+)\]/)?.[1]
      return { verdict: 'incomplete', remedy: { ref, action: 'click' } }
    },
  })
  assert.equal(result.rows.length, 10)
  assert.equal(result.aiStop.remedies, 0)
  assert.equal(result.aiStop.outcome, 'possibly-incomplete')
})

test('a host that fails or keeps saying "still loading" without rows hands the decision back to the rules', async () => {
  const failing = await collectOnPage(page, config(feed({ batches: 1 }), { stagnantRounds: 1 }), {
    ...lib,
    confirmStop: async () => {
      throw new Error('network down')
    },
  })
  assert.equal(failing.rows.length, 10)
  assert.equal(failing.stopReason, 'scroll-end')
  assert.equal(failing.aiStop.outcome, 'rules (no AI verdict)')

  let asks = 0
  const stuck = await collectOnPage(page, config(feed({ batches: 1 }), { stagnantRounds: 1 }), {
    ...lib,
    confirmStop: async () => {
      asks += 1
      return { verdict: 'still_loading' }
    },
  })
  assert.equal(stuck.rows.length, 10)
  assert.equal(asks, 3)
  assert.equal(stuck.aiStop.outcome, 'rules (asked without new rows)')
})
