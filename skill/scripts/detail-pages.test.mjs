// detail.mjs end to end on the playground's list → detail fixture (eval/playground/fixtures/detail-links):
// late-rendered detail pages in two layouts, dead links, a "Read more" to click, related items before the
// record that reuse its classes, an optional field, a site that starts
// blocking (a captcha, or empty pages) after N requests, and pages that fail once. The fixture server
// (eval/serve.mts) is started on a free port. Run with `node --test scripts/detail-pages.test.mjs`.
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import net from 'node:net'
import os from 'node:os'
import path from 'node:path'
import { after, before, describe, test } from 'node:test'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright'
import { runCodeSource } from './lib/chrome.mjs'
import { parseCsv, toCsv } from './lib/csv.mjs'
import { detailBatchProgram, readDetailPage } from './lib/detail.mjs'
import { installDlk } from './lib/in-page.mjs'
import { gotoAndSettle, runSetup, settle } from './lib/page-helpers.mjs'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const SKILL = path.join(HERE, '..')
const REPO = path.join(SKILL, '..')
const SERVE = path.join(REPO, 'eval', 'serve.mts')
const TSX = path.join(REPO, 'node_modules', '.bin', 'tsx')
const BRANDS = ['Northwind', 'Acme', 'Globex', 'Initech', 'Umbrella', 'Stark']

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'detail-test-'))
let server
let origin
const run = Math.random().toString(36).slice(2, 8)

const freePort = () =>
  new Promise((resolve, reject) => {
    const probe = net.createServer().listen(0, () => {
      const { port } = probe.address()
      probe.close(() => resolve(port))
    })
    probe.on('error', reject)
  })

async function startServer() {
  const port = await freePort()
  server = spawn(TSX, [SERVE], { cwd: REPO, env: { ...process.env, PORT: String(port) }, stdio: 'ignore' })
  origin = `http://localhost:${port}`
  const deadline = Date.now() + 30_000
  while (Date.now() < deadline) {
    const ok = await fetch(`${origin}/dev-fixtures/playground/detail-links`).then(r => r.ok, () => false)
    if (ok) return
    await new Promise(resolve => setTimeout(resolve, 300))
  }
  throw new Error('fixture server did not start')
}

const FAKE_CLI = `${process.execPath} ${path.join(HERE, 'test-support', 'fake-playwright-cli.mjs')}`

/** Run a skill script; → { code, stdout, stderr, summary (parsed stdout when it is JSON) }. */
function script(name, args, { onSpawn, env = {}, detached = false } = {}) {
  return new Promise(resolve => {
    const child = spawn(process.execPath, [path.join(HERE, name), ...args], { cwd: SKILL, env: { ...process.env, PLAYWRIGHT_FROM: REPO, ...env }, detached })
    let stdout = ''
    let stderr = ''
    child.stdout.on('data', d => (stdout += d))
    child.stderr.on('data', d => (stderr += d))
    onSpawn?.(child)
    child.on('close', (code, signal) => {
      let summary = null
      try {
        summary = JSON.parse(stdout)
      } catch {
        // not a summary (usage error, or killed)
      }
      resolve({ code, signal, stdout, stderr, summary })
    })
  })
}

const write = (name, value) => {
  const file = path.join(tmp, name)
  fs.writeFileSync(file, typeof value === 'string' ? value : JSON.stringify(value, null, 2))
  return file
}
const readCsv = file => parseCsv(fs.readFileSync(file, 'utf8'))
const checkpointLines = file => (fs.existsSync(file) ? fs.readFileSync(file, 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l)) : [])
const detailUrl = (id, query) => `${origin}/dev-fixtures/playground/detail-links/${id}${query ? `?${query}` : ''}`
/** Send `signal` once the checkpoint has `lines` lines (0: after `ms`); for script()'s onSpawn. */
const signalWhen = (checkpoint, lines, signal, { group = false, ms = 0 } = {}) => child => {
  const started = Date.now()
  const timer = setInterval(() => {
    const ready = lines ? checkpointLines(checkpoint).length >= lines : Date.now() - started >= ms
    if (!ready) return
    clearInterval(timer)
    if (group) process.kill(-child.pid, signal)
    else child.kill(signal)
  }, 50)
  child.on('close', () => clearInterval(timer))
}
const listPage = n => `${origin}/dev-fixtures/playground/detail-links?items=${n}`
/** A list CSV by hand: one row per entry, `link` holding the URL (or whatever is given). */
const listOf = (name, links) => write(name, toCsv(['title', 'link'], links.map((link, i) => ({ title: `row ${i + 1}`, link }))))

const SPEC = {
  link: 'link',
  fields: { name: 'h1.name', brand: '.specs .brand, .maker a', sku: '.sku', description: '.description .full-text' },
  require: ['name'],
  expand: ['.read-more'],
  delayMs: 0,
  waitTimeoutMs: 4000,
}

// The list, collected by collect.mjs (12 products over 2 pages: #7 has no link, #9 is a dead link), and
// one clean detail run over it that the other tests compare with.
let listCsv
let specFile
let clean
before(async () => {
  await startServer()
  const listConfig = write('list.json', {
    url: `${origin}/dev-fixtures/playground/detail-links?items=12&perPage=6&lateMs=300&run=list-${run}`,
    rows: 'ul.products > li.item',
    fields: { title: '.title', link: { css: 'a.title', attr: 'href' }, price: '.price' },
    next: { type: 'click', selector: 'a.next' },
  })
  listCsv = path.join(tmp, 'list.csv')
  const collected = await script('collect.mjs', [listConfig, '--out', listCsv])
  assert.equal(collected.summary?.rows, 12, collected.stderr)
  specFile = write('detail.json', SPEC)
  clean = await script('detail.mjs', [listCsv, specFile, '--out', path.join(tmp, 'clean.csv')])
})

after(() => {
  server?.kill()
  fs.rmSync(tmp, { recursive: true, force: true })
})

describe('detail.mjs', { concurrency: 4 }, () => {
  test('list → detail: every list row kept in order, both layouts read, the field behind "Read more" read, dead link and missing link marked', () => {
    const { summary, code, stderr } = clean
    assert.equal(code, 0, stderr)
    assert.equal(summary.stopReason, 'done')
    assert.deepEqual(summary.status, { ok: 10, empty: 1, failed: 0, blocked: 0, pending: 0, 'no-link': 1 })
    assert.equal(summary.deadLinks.count, 1)
    assert.deepEqual(summary.fillRate, { name: '10/10 (100%)', brand: '10/10 (100%)', sku: '10/10 (100%)', description: '10/10 (100%)' })
    assert.equal(summary.warnings, undefined)

    const { columns, rows } = readCsv(path.join(tmp, 'clean.csv'))
    assert.deepEqual(columns, ['title', 'link', 'price', 'name', 'brand', 'sku', 'description', 'detail_status'])
    assert.deepEqual(rows.map(r => r.title), Array.from({ length: 12 }, (_, i) => `Product ${i + 1}`))
    for (const row of rows) {
      const id = Number(row.title.split(' ')[1])
      if (id === 7) {
        assert.equal(row.detail_status, 'no-link')
        continue
      }
      if (id === 9) {
        // The dead link keeps its list data.
        assert.deepEqual([row.detail_status, row.price, row.name], ['empty', '$37.00', ''])
        continue
      }
      assert.equal(row.detail_status, 'ok')
      assert.equal(row.name, `Product ${id}`)
      assert.equal(row.brand, BRANDS[id % BRANDS.length], `brand of product ${id}`)
      assert.equal(row.sku, `SKU-${String(id).padStart(4, '0')}`)
      assert.match(row.description, new RegExp(`^Full description of product ${id}:`))
    }
    assert.ok(fs.existsSync(path.join(tmp, 'clean.json')), 'summary saved next to the CSV')
  })

  test('--max-rows previews the first links; a selector taken from one layout shows up as a fill-rate warning', async () => {
    const naive = write('naive.json', { ...SPEC, fields: { ...SPEC.fields, brand: '.specs .brand' } })
    const { summary, code } = await script('detail.mjs', [listCsv, naive, '--out', path.join(tmp, 'preview.csv'), '--max-rows', '5'])
    assert.equal(code, 0)
    assert.equal(summary.stopReason, 'max-rows')
    assert.deepEqual(summary.status, { ok: 5, empty: 0, failed: 0, blocked: 0, pending: 6, 'no-link': 1 })
    assert.equal(summary.fillRate.brand, '4/5 (80%)')
    const text = summary.warnings.join('\n')
    assert.match(text, /"brand" is filled on 4\/5 ok pages .*detail-links\/4/)
    // #4 shows its brand outside the spec table: the warning quotes #4's record text, brand included.
    const brandWarning = summary.warnings.find(w => w.includes('"brand"'))
    assert.match(brandWarning, /On http:\S+\/detail-links\/4\S* the page's main content \(no "root" set\) reads: "Product 4 by Umbrella \$22\.00 SKU SKU-0004 Full description of product 4: [^"]+"\. Look for the value there/)
    // Only the page with a blank field keeps its record text in the checkpoint.
    const lines = checkpointLines(path.join(tmp, 'preview.detail.jsonl'))
    assert.deepEqual(lines.filter(l => l.recordText).map(l => l.url.split('?')[0].split('/').pop()), ['4'])
    assert.match(text, /NOT THE END: preview of the first 5 links/)
    const { rows } = readCsv(path.join(tmp, 'preview.csv'))
    assert.equal(rows.length, 12)
    assert.deepEqual(rows.map(r => r.detail_status).slice(0, 8), ['ok', 'ok', 'ok', 'ok', 'ok', 'pending', 'no-link', 'pending'])
  })

  test('killed mid-run, the same command resumes: no page read twice, same result as a clean run', async () => {
    const out = path.join(tmp, 'resume.csv')
    const checkpoint = path.join(tmp, 'resume.detail.jsonl')
    const killed = await script('detail.mjs', [listCsv, specFile, '--out', out], {
      onSpawn: child => {
        const timer = setInterval(() => {
          if (checkpointLines(checkpoint).length >= 3) {
            clearInterval(timer)
            child.kill('SIGKILL')
          }
        }, 100)
        child.on('close', () => clearInterval(timer))
      },
    })
    assert.equal(killed.signal, 'SIGKILL')
    const before = checkpointLines(checkpoint).length
    assert.ok(before >= 3 && before < 11, `killed after ${before} pages`)

    const resumed = await script('detail.mjs', [listCsv, specFile, '--out', out])
    assert.equal(resumed.summary.stopReason, 'done')
    assert.equal(resumed.summary.fetchedThisRun, 11 - before)
    assert.deepEqual(resumed.summary.status, clean.summary.status)
    const lines = checkpointLines(checkpoint)
    assert.equal(lines.length, 11)
    assert.equal(new Set(lines.map(l => l.url)).size, 11)
    assert.equal(fs.readFileSync(out, 'utf8'), fs.readFileSync(path.join(tmp, 'clean.csv'), 'utf8'))
  })

  test('Ctrl-C stops with stopReason "interrupted" and keeps what was read', async () => {
    const out = path.join(tmp, 'sigint.csv')
    const checkpoint = path.join(tmp, 'sigint.detail.jsonl')
    const stopped = await script('detail.mjs', [listCsv, specFile, '--out', out], {
      onSpawn: child => {
        const timer = setInterval(() => {
          if (checkpointLines(checkpoint).length >= 2) {
            clearInterval(timer)
            child.kill('SIGINT')
          }
        }, 100)
        child.on('close', () => clearInterval(timer))
      },
    })
    assert.equal(stopped.code, 130)
    assert.equal(stopped.summary.stopReason, 'interrupted')
    assert.match(stopped.summary.note, /rerun the same command to resume/)
    assert.ok(stopped.summary.status.pending > 0)
    const { rows } = readCsv(out)
    assert.equal(rows.length, 12)
    assert.equal(rows.filter(r => r.detail_status === 'ok').length, stopped.summary.status.ok)
  })

  test('a failed page is retried until maxAttempts, then left as failed; rerunning with more tries picks it up', async () => {
    // flaky: products 5 and 10 answer 503 the first time they are asked for.
    const once = `flaky=1&lateMs=200&run=flaky-a-${run}`
    const links = [detailUrl(1, once), detailUrl(5, once), detailUrl(10, once)]
    const list = listOf('flaky.csv', links)
    const oneTry = write('flaky-one.json', { ...SPEC, maxAttempts: 1 })
    const out = path.join(tmp, 'flaky.csv.out.csv')
    const first = await script('detail.mjs', [list, oneTry, '--out', out])
    assert.deepEqual([first.summary.status.ok, first.summary.status.failed], [1, 2])
    assert.match(first.summary.warnings.join('\n'), /2 pages failed .*HTTP 503/)
    const again = await script('detail.mjs', [list, oneTry, '--out', out])
    assert.equal(again.summary.fetchedThisRun, 0)
    assert.equal(again.summary.status.failed, 2)
    const twoTries = write('flaky-two.json', { ...SPEC, maxAttempts: 2 })
    const third = await script('detail.mjs', [list, twoTries, '--out', out])
    assert.equal(third.summary.fetchedThisRun, 2)
    assert.deepEqual(third.summary.status, { ok: 3, empty: 0, failed: 0, blocked: 0, pending: 0, 'no-link': 0 })

    // Within one run a failure goes to the back of the queue while it has tries left.
    const fresh = `flaky=1&lateMs=200&run=flaky-b-${run}`
    const list2 = listOf('flaky2.csv', [detailUrl(5, fresh), detailUrl(1, fresh)])
    const inRun = await script('detail.mjs', [list2, twoTries, '--out', path.join(tmp, 'flaky2.out.csv')])
    assert.equal(inRun.summary.status.ok, 2)
    const lines = checkpointLines(path.join(tmp, 'flaky2.out.detail.jsonl'))
    assert.deepEqual(lines.map(l => [l.url.split('?')[0].split('/').pop(), l.status, l.attempts]), [
      ['5', 'failed', 1],
      ['1', 'ok', 1],
      ['5', 'ok', 2],
    ])
  })

  test('three blocked pages in a row stop the run; the checkpoint keeps the pages read; a rerun retries the blocked ones', async () => {
    const q = `blockAfter=2&lateMs=200&run=block-${run}`
    const list = listOf('block.csv', [1, 2, 3, 4, 5, 6, 8].map(id => detailUrl(id, q)))
    const out = path.join(tmp, 'block.out.csv')
    const first = await script('detail.mjs', [list, specFile, '--out', out])
    assert.equal(first.summary.stopReason, 'blocked')
    assert.deepEqual(first.summary.status, { ok: 2, empty: 0, failed: 0, blocked: 3, pending: 2, 'no-link': 0 })
    assert.match(first.summary.note, /3 pages in a row looked blocked .*challenge element/)
    assert.match(first.summary.note, /Ask the user .*--browser chrome/)
    const again = await script('detail.mjs', [list, specFile, '--out', out])
    assert.equal(again.summary.stopReason, 'blocked')
    assert.equal(again.summary.fetchedThisRun, 3)
    assert.equal(again.summary.status.ok, 2)
  })

  test('empty pages in a row: an ok page read again tells a soft block (stop, retry them later) from pages that are empty (go on)', async () => {
    // Soft block: after 2 requests the site serves empty shells, no captcha, no block text.
    const q = `softBlockAfter=2&lateMs=200&run=soft-${run}`
    const list = listOf('soft.csv', [1, 2, 3, 4, 5, 6].map(id => detailUrl(id, q)))
    const quick = write('quick.json', { ...SPEC, waitTimeoutMs: 1500 })
    const out = path.join(tmp, 'soft.out.csv')
    const soft = await script('detail.mjs', [list, quick, '--out', out])
    assert.equal(soft.summary.stopReason, 'blocked')
    assert.match(soft.summary.note, /3 pages read empty with no ok page between them, and .*detail-links\/1\?.*now reads empty/)
    assert.deepEqual(soft.summary.status, { ok: 2, empty: 0, failed: 0, blocked: 3, pending: 1, 'no-link': 0 })
    assert.deepEqual(soft.summary.canary.map(c => c.status), ['empty'])

    // Pages that really are empty (here: list pages, which have no product name), between ok ones, and the
    // same link twice (read once) and a cell that is not a URL.
    const real = `lateMs=200&run=empty-${run}`
    const list2 = listOf('empty.csv', [detailUrl(1, real), listPage(3), listPage(4), listPage(5), detailUrl(2, real), detailUrl(1, real), 'n/a'])
    const empty = await script('detail.mjs', [list2, quick, '--out', path.join(tmp, 'empty.out.csv')])
    assert.equal(empty.summary.stopReason, 'done')
    assert.equal(empty.summary.fetchedThisRun, 5)
    // Counted by row, like the detail_status column: the link read once fills two rows.
    assert.deepEqual(empty.summary.status, { ok: 3, empty: 3, failed: 0, blocked: 0, pending: 0, 'no-link': 1 })
    assert.deepEqual(empty.summary.canary.map(c => [c.status, c.afterEmpty]), [['ok', 3]])
    assert.match(empty.summary.warnings.join('\n'), /3 of 5 pages read as empty \(no field read anything\)/)
    const { rows } = readCsv(path.join(tmp, 'empty.out.csv'))
    assert.deepEqual(rows.map(r => r.detail_status), ['ok', 'empty', 'empty', 'empty', 'ok', 'ok', 'no-link'])
  })

  test('a detail field named like a list column fails fast, before any page is opened', async () => {
    const clash = write('clash.json', { ...SPEC, fields: { title: 'h1.name' } })
    const result = await script('detail.mjs', [listCsv, clash, '--out', path.join(tmp, 'clash.csv')])
    assert.equal(result.code, 2)
    assert.match(result.stderr, /"title" already is a column of the output; rename it .*"detail_title"/)
    assert.ok(!fs.existsSync(path.join(tmp, 'clash.csv')))
  })

  test('a spec change reads the pages again instead of keeping rows read with the old selectors', async () => {
    const out = path.join(tmp, 'respec.csv')
    const q = `lateMs=200&run=respec-${run}`
    const list = listOf('respec-list.csv', [detailUrl(1, q), detailUrl(4, q)])
    const narrow = write('respec-a.json', { ...SPEC, fields: { name: 'h1.name', brand: '.specs .brand' } })
    const first = await script('detail.mjs', [list, narrow, '--out', out])
    assert.equal(first.summary.fillRate.brand, '1/2 (50%)')
    const wide = write('respec-b.json', { ...SPEC, fields: { name: 'h1.name', brand: '.specs .brand, .maker a' } })
    const second = await script('detail.mjs', [list, wide, '--out', out])
    assert.equal(second.summary.fetchedThisRun, 2)
    assert.equal(second.summary.rereadAfterSpecChange, 2)
    assert.equal(second.summary.fillRate.brand, '2/2 (100%)')
  })

  test('--browser chrome ships the reader as source: the run-code program reads pages on its own, with nothing from module scope', async () => {
    const q = `lateMs=200&run=program-${run}`
    const urls = [detailUrl(1, q), detailUrl(4, q), detailUrl(9, q)]
    const { sources, call } = detailBatchProgram(urls, SPEC, { limit: 3 })
    // The same text lib/chrome.mjs hands to `playwright-cli run-code`, evaluated without this module's imports.
    const program = new Function(`return (${runCodeSource(sources, call)})`)()
    const browser = await chromium.launch()
    try {
      const page = await browser.newPage()
      const { results } = JSON.parse(await program(page))
      assert.deepEqual(results.map(r => r.status), ['ok', 'ok', 'empty'])
      assert.equal(results[1].fields.brand, BRANDS[4])
      assert.match(results[1].fields.description, /^Full description of product 4:/)
      assert.equal(results[2].notFound, true)
      assert.equal(results[1].recordText, undefined, 'no record text when every field read')
      // A field read blank on an ok page: the record's text comes back too (root given: the record only).
      const naive = { ...SPEC, root: 'article.product-detail', fields: { ...SPEC.fields, brand: '.specs .brand' } }
      const again = detailBatchProgram([detailUrl(4, q)], naive, { limit: 3 })
      const { results: [compact] } = JSON.parse(await new Function(`return (${runCodeSource(again.sources, again.call)})`)()(page))
      assert.equal(compact.status, 'ok')
      assert.match(compact.recordText, /^Product 4 by Umbrella \$22\.00 SKU SKU-0004 Full description of product 4:/)
      assert.equal(compact.recordScope, 'root')
    } finally {
      await browser.close()
    }
  })
  test('a corner reCAPTCHA badge on every page is no block: late content is waited for and read', async () => {
    const q = `badge=1&lateMs=2500&run=badge-${run}`
    const list = listOf('badge.csv', [1, 2, 3, 4].map(id => detailUrl(id, q)))
    const { summary } = await script('detail.mjs', [list, write('badge.json', { ...SPEC, waitTimeoutMs: 6000 }), '--out', path.join(tmp, 'badge.out.csv')])
    assert.equal(summary.stopReason, 'done', summary.note)
    assert.deepEqual(summary.status, { ok: 4, empty: 0, failed: 0, blocked: 0, pending: 0, 'no-link': 0 })
  })

  test('SIGTERM stops like Ctrl-C: nothing recorded as failed, the rerun finishes like a clean run', async () => {
    const out = path.join(tmp, 'term.csv')
    const checkpoint = path.join(tmp, 'term.detail.jsonl')
    const stopped = await script('detail.mjs', [listCsv, specFile, '--out', out], { onSpawn: signalWhen(checkpoint, 2, 'SIGTERM') })
    assert.equal(stopped.code, 143)
    assert.equal(stopped.summary.stopReason, 'interrupted')
    assert.deepEqual(checkpointLines(checkpoint).filter(l => l.status === 'failed'), [])
    const resumed = await script('detail.mjs', [listCsv, specFile, '--out', out])
    assert.equal(resumed.summary.stopReason, 'done')
    assert.deepEqual(resumed.summary.status, clean.summary.status)
    assert.equal(fs.readFileSync(out, 'utf8'), fs.readFileSync(path.join(tmp, 'clean.csv'), 'utf8'))
  })

  test('a checkpoint line cut off by a kill is not glued to the next run\'s first line', async () => {
    const q = `lateMs=200&run=torn-${run}`
    const list = listOf('torn.csv', [1, 2, 3].map(id => detailUrl(id, q)))
    const out = path.join(tmp, 'torn.out.csv')
    const checkpoint = path.join(tmp, 'torn.out.detail.jsonl')
    await script('detail.mjs', [list, specFile, '--out', out])
    const lines = fs.readFileSync(checkpoint, 'utf8').split('\n')
    fs.writeFileSync(checkpoint, `${lines[0]}\n${lines[1]}\n${lines[2].slice(0, 60)}`)
    const second = await script('detail.mjs', [list, specFile, '--out', out])
    assert.equal(second.summary.fetchedThisRun, 1)
    const third = await script('detail.mjs', [list, specFile, '--out', out])
    assert.equal(third.summary.fetchedThisRun, 0)
    assert.deepEqual(third.summary.status.ok, 3)
  })

  test('a link that cannot be reached does not make the next pages in the tab fail', async () => {
    const dead = `http://127.0.0.1:${await freePort()}/nothing-here`
    const q = `lateMs=100&run=refused-${run}`
    const list = listOf('refused.csv', [dead, ...[1, 2, 3, 4].map(id => detailUrl(id, q))])
    const { summary } = await script('detail.mjs', [list, write('refused.json', { ...SPEC, maxAttempts: 1 }), '--out', path.join(tmp, 'refused.out.csv')])
    assert.deepEqual([summary.status.ok, summary.status.failed], [4, 1])
  })

  test('a canary page that fails once (a server error) is tried again instead of stopping the run', async () => {
    // flaky=2: product 5 answers 503 on its second request only — the canary's.
    const q = `flaky=2&lateMs=200&run=canary-${run}`
    const list = listOf('canary.csv', [detailUrl(5, q), listPage(3), listPage(4), listPage(5), detailUrl(1, q)])
    const { summary } = await script('detail.mjs', [list, write('canary.json', { ...SPEC, waitTimeoutMs: 1500 }), '--out', path.join(tmp, 'canary.out.csv')])
    assert.equal(summary.stopReason, 'done', summary.note)
    assert.deepEqual(summary.canary.map(c => c.status), ['failed', 'ok'])
    assert.deepEqual([summary.status.ok, summary.status.empty], [2, 3])
  })

  test('no page has read ok yet after 3 empty ones: stop ("no-data"), and those pages stay to be read again', async () => {
    const quick = write('nodata.json', { ...SPEC, waitTimeoutMs: 1500 })
    // Pages that really are empty at the start of the list: a rerun reads the others first, then these again.
    const q = `lateMs=200&run=nodata-${run}`
    const list = listOf('nodata.csv', [listPage(3), listPage(4), listPage(5), detailUrl(1, q), detailUrl(2, q)])
    const out = path.join(tmp, 'nodata.out.csv')
    const first = await script('detail.mjs', [list, quick, '--out', out])
    assert.equal(first.summary.stopReason, 'no-data')
    assert.equal(first.summary.fetchedThisRun, 3)
    assert.match(first.summary.note, /none has read ok/)
    const second = await script('detail.mjs', [list, quick, '--out', out])
    assert.equal(second.summary.stopReason, 'done', second.summary.note)
    assert.equal(second.summary.fetchedThisRun, 5)
    assert.deepEqual([second.summary.status.ok, second.summary.status.empty], [2, 3])
    const third = await script('detail.mjs', [list, quick, '--out', out])
    assert.equal(third.summary.fetchedThisRun, 0)

    // A site that serves empty pages from the first request on: rerunning reads those pages again.
    const soft = `softBlockAfter=1&lateMs=200&run=nodata-soft-${run}`
    await fetch(detailUrl(1, soft))
    const list2 = listOf('nodata-soft.csv', [2, 3, 4, 5, 6].map(id => detailUrl(id, soft)))
    const out2 = path.join(tmp, 'nodata-soft.out.csv')
    const blockedFirst = await script('detail.mjs', [list2, quick, '--out', out2])
    assert.equal(blockedFirst.summary.stopReason, 'no-data')
    const again = await script('detail.mjs', [list2, quick, '--out', out2])
    assert.equal(again.summary.stopReason, 'no-data')
    assert.equal(again.summary.fetchedThisRun, 3)
    const urls = checkpointLines(path.join(tmp, 'nodata-soft.out.detail.jsonl')).map(l => l.url)
    assert.ok(urls.slice(3).some(u => urls.slice(0, 3).includes(u)), 'pages of the first run were read again')
  })

  test('interrupted in the middle of a run of empty pages, the rerun does not keep them as empty', async () => {
    const q = `softBlockAfter=3&lateMs=200&run=softint-${run}`
    const list = listOf('softint.csv', [1, 2, 3, 4, 5, 6, 8, 10].map(id => detailUrl(id, q)))
    const quick = write('softint.json', { ...SPEC, waitTimeoutMs: 1500 })
    const out = path.join(tmp, 'softint.out.csv')
    const checkpoint = path.join(tmp, 'softint.out.detail.jsonl')
    const stopped = await script('detail.mjs', [list, quick, '--out', out], { onSpawn: signalWhen(checkpoint, 5, 'SIGINT') })
    assert.equal(stopped.summary.stopReason, 'interrupted')
    const again = await script('detail.mjs', [list, quick, '--out', out])
    assert.equal(again.summary.stopReason, 'blocked')
    const { rows } = readCsv(out)
    assert.deepEqual(rows.slice(0, 5).map(r => r.detail_status), ['ok', 'ok', 'ok', 'blocked', 'blocked'])
    assert.deepEqual(rows.filter(r => r.detail_status === 'empty'), [])
  })

  test('"require" waits for the fields there before any click, not for the field behind "Read more"', async () => {
    const q = `lateMs=200&run=wait-${run}`
    const list = listOf('wait.csv', [2, 3].map(id => detailUrl(id, q)))
    const spec = write('wait.json', { ...SPEC, require: ['name', 'description'], waitTimeoutMs: 8000 })
    const { summary } = await script('detail.mjs', [list, spec, '--out', path.join(tmp, 'wait.out.csv')])
    assert.equal(summary.status.ok, 2)
    // About 5 s a page here; waiting out waitTimeoutMs before the click took over 10 s a page.
    assert.ok(summary.seconds < 15, `took ${summary.seconds}s`)
  })

  test('related items before the record reuse its classes: with root they are not read, without root the first match in page order is theirs', async () => {
    // related=1: two "customers also viewed" cards (products id+1, id+2) come before the record; warranty=1: id % 3 === 0 has none.
    const q = `related=1&warranty=1&lateMs=200&run=related-${run}`
    const ids = [1, 2, 3, 4, 5, 6]
    const list = listOf('related.csv', ids.map(id => detailUrl(id, q)))
    const fields = { name: 'h1.name', brand: '.specs .brand, .maker a', warranty: '.warranty', description: '.description .full-text' }
    const [scoped, whole] = await Promise.all(
      [{ root: 'article.product-detail' }, {}].map((extra, i) =>
        script('detail.mjs', [list, write(`related-${i}.json`, { ...SPEC, ...extra, fields }), '--out', path.join(tmp, `related-${i}.csv`)])
      )
    )
    for (const { summary } of [scoped, whole]) assert.deepEqual(summary.status, { ok: 6, empty: 0, failed: 0, blocked: 0, pending: 0, 'no-link': 0 })

    const scopedRows = readCsv(path.join(tmp, 'related-0.csv')).rows
    for (const [i, id] of ids.entries()) {
      assert.equal(scopedRows[i].brand, BRANDS[id % BRANDS.length], `brand of product ${id}`)
      assert.equal(scopedRows[i].warranty, id % 3 ? `${1 + (id % 3)} years` : '', `warranty of product ${id}`)
      assert.match(scopedRows[i].description, new RegExp(`^Full description of product ${id}:`))
    }
    // A field the items really lack: the warning says so, and does not call it another layout.
    assert.equal(scoped.summary.fillRate.warranty, '4/6 (67%)')
    const warning = scoped.summary.warnings.find(w => w.includes('"warranty"'))
    assert.match(warning, /either those items lack this field/)
    assert.match(warning, /keep the selector and report the fill rate/)

    // Without root: the comma list takes the first element in page order (a related card's maker link, not
    // the record's spec table), and the optional field is "filled" everywhere with another product's value.
    const wholeRows = readCsv(path.join(tmp, 'related-1.csv')).rows
    for (const [i, id] of ids.entries()) assert.equal(wholeRows[i].brand, BRANDS[(id + 1) % BRANDS.length], `brand of product ${id} without root`)
    assert.equal(whole.summary.fillRate.warranty, '6/6 (100%)')
  })

  test('with root, expand clicks only the buttons inside the record', async () => {
    const browser = await chromium.launch()
    try {
      const page = await browser.newPage()
      const lib = { settle, gotoAndSettle, runSetup, installDlk }
      const url = detailUrl(2, `related=1&lateMs=200&run=expand-${run}`)
      const scoped = await readDetailPage(page, url, { ...SPEC, root: 'article.product-detail' }, lib)
      assert.equal(scoped.status, 'ok')
      assert.equal(scoped.expandClicks, 1)
      assert.match(scoped.fields.description, /^Full description of product 2:/)
      // Without root every "Read more" on the page is clicked: the record's and the two related cards'.
      const whole = await readDetailPage(page, url, SPEC, lib)
      assert.equal(whole.expandClicks, 3)
    } finally {
      await browser.close()
    }
  })

  test('arguments: --out may not be the config, a value flag needs its value, --max-rows over finished links is done', async () => {
    const spec = write('victim.json', SPEC)
    const before = fs.readFileSync(spec, 'utf8')
    const same = await script('detail.mjs', [listCsv, spec, '--out', spec])
    assert.equal(same.code, 2)
    assert.match(same.stderr, /--out/)
    assert.equal(fs.readFileSync(spec, 'utf8'), before)
    const bare = await script('detail.mjs', [listCsv, specFile, '--out', path.join(tmp, 'bare.csv'), '--max-rows'])
    assert.equal(bare.code, 2)
    assert.match(bare.stderr, /--max-rows/)
    fs.copyFileSync(path.join(tmp, 'clean.detail.jsonl'), path.join(tmp, 'done.detail.jsonl'))
    const done = await script('detail.mjs', [listCsv, specFile, '--out', path.join(tmp, 'done.csv'), '--max-rows', '3'])
    assert.equal(done.summary.fetchedThisRun, 0)
    assert.equal(done.summary.stopReason, 'done')
  })

  test('a second detail pass over a detail output gets its own status column and reads back', async () => {
    const spec = write('chain.json', { link: 'link', fields: { price2: '.product-detail .price' }, require: ['price2'], delayMs: 0, waitTimeoutMs: 4000 })
    const out = path.join(tmp, 'chain.csv')
    const { code, stderr } = await script('detail.mjs', [path.join(tmp, 'clean.csv'), spec, '--out', out, '--max-rows', '2'])
    assert.equal(code, 0, stderr)
    const { columns, rows } = readCsv(out)
    assert.deepEqual(columns.slice(-3), ['detail_status', 'price2', 'detail_status_2'])
    // The detail page shows the same price as the list.
    assert.deepEqual(rows.slice(0, 2).map(r => [r.detail_status, r.price2 === r.price && r.price !== '', r.detail_status_2]), [
      ['ok', true, 'ok'],
      ['ok', true, 'ok'],
    ])
  })

  describe('--browser chrome (a stand-in playwright-cli drives a bundled Chromium)', () => {
    const env = { PLAYWRIGHT_CLI: FAKE_CLI }
    test('same rows as the bundled browser', async () => {
      const out = path.join(tmp, 'chrome.csv')
      const { summary, stderr } = await script('detail.mjs', [listCsv, specFile, '--out', out, '--browser', 'chrome'], { env })
      assert.equal(summary?.stopReason, 'done', stderr)
      assert.equal(fs.readFileSync(out, 'utf8'), fs.readFileSync(path.join(tmp, 'clean.csv'), 'utf8'))
    })
    test('SIGINT to the script stops it with "interrupted" while a batch is running', async () => {
      const out = path.join(tmp, 'chrome-int.csv')
      const started = Date.now()
      const stopped = await script('detail.mjs', [listCsv, specFile, '--out', out, '--browser', 'chrome'], { env, onSpawn: signalWhen(null, 0, 'SIGINT', { ms: 2500 }) })
      assert.equal(stopped.code, 130, stopped.stderr)
      assert.equal(stopped.summary.stopReason, 'interrupted')
      assert.ok(Date.now() - started < 8000, `took ${Date.now() - started} ms`)
    })
    test('Ctrl-C in a terminal (SIGINT to the whole process group) is an interrupt too, not an error', async () => {
      const out = path.join(tmp, 'chrome-group.csv')
      const stopped = await script('detail.mjs', [listCsv, specFile, '--out', out, '--browser', 'chrome'], { env, detached: true, onSpawn: signalWhen(null, 0, 'SIGINT', { ms: 2500, group: true }) })
      assert.equal(stopped.code, 130, stopped.stderr)
      assert.equal(stopped.summary.stopReason, 'interrupted')
    })
    test('a Chrome window that does not draw the tab stops with "tab-not-rendering"', async () => {
      const out = path.join(tmp, 'chrome-hidden.csv')
      const { summary } = await script('detail.mjs', [listCsv, specFile, '--out', out, '--browser', 'chrome'], { env: { ...env, FAKE_CLI_HIDDEN: '1' } })
      assert.equal(summary.stopReason, 'tab-not-rendering')
      assert.match(summary.note, /keep it visible/)
      assert.equal(summary.status.pending, 11)
    })
  })
})
