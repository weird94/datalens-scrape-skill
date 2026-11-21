// Never losing rows: a run split into calls ends as one uninterrupted run would, and collect.mjs keeps the
// rows of the rounds it finished when it is killed.
// Uses the playground's mock pages (eval/, started here on a free port); skipped where eval/ is not around.
// Run with `node --test scripts/collect-chunks.test.mjs`.
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
import { CHUNK_SOURCES, chunkCall, collectInChunks } from './lib/chunks.mjs'
import { collectOnPage, gotoAndSettle, installDlk, runSetup, settle } from './lib/index.mjs'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const REPO = path.resolve(HERE, '../..')
const SERVE = path.join(REPO, 'eval/serve.mts')
const TSX = path.join(REPO, 'node_modules/.bin/tsx')
const haveFixtures = fs.existsSync(SERVE) && fs.existsSync(TSX)
const lib = { settle, gotoAndSettle, runSetup, installDlk }

let server
let base
let browser
/** Folders the tests made (runs, the stand-in CLI): removed at the end. */
const tmpDirs = []
const tmpDir = prefix => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix))
  tmpDirs.push(dir)
  return dir
}
before(async () => {
  if (!haveFixtures) return
  // Its own process group, so the whole tree (tsx starts a second node) goes when the tests end.
  server = spawn(TSX, [SERVE], { cwd: REPO, env: { ...process.env, PORT: '0' }, detached: true, stdio: ['ignore', 'pipe', 'inherit'] })
  base = await new Promise((resolve, reject) => {
    let text = ''
    server.stdout.on('data', chunk => {
      text += chunk
      const found = text.match(/fixtures on (http:\/\/localhost:\d+)/)
      if (found) resolve(`${found[1]}/dev-fixtures/playground`)
    })
    server.on('exit', code => reject(new Error(`fixture server exited (${code})`)))
  })
  browser = await chromium.launch()
})
after(async () => {
  await browser?.close()
  for (const dir of tmpDirs) fs.rmSync(dir, { recursive: true, force: true })
  if (server?.pid) {
    try {
      process.kill(-server.pid)
    } catch {
      // already gone
    }
  }
})

/** One call of a chunked run, the way the CLI ships it to the user's Chrome: the run-code text, evaluated against `page`. */
async function runCodeChunk(page, config, state, pauseAfter) {
  const fn = (0, eval)(runCodeSource(CHUNK_SOURCES, chunkCall(config, state, pauseAfter)))
  return JSON.parse(await fn(page))
}

async function newPage() {
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } })
  await context.addInitScript({ content: `(${installDlk})()` })
  return context.newPage()
}

/** The parts of a result that must not depend on where the run was split. */
const outcome = result => ({
  rows: result.rows,
  stopReason: result.stopReason,
  note: result.note,
  warning: result.warning,
  totalCheck: result.totalCheck,
  rounds: result.rounds.map(r => [r.label, r.added, r.total]),
  mergedByLink: result.mergedByLink,
  mergedSameRecord: result.mergedSameRecord,
  expandClicked: result.expandClicked,
  expandReplaced: result.expandReplaced,
  expandMissed: result.expandMissed,
  lastUrl: result.lastUrl,
})

const CASES = [
  {
    name: 'a list that loads as it scrolls',
    config: () => ({ url: `${base}/io-scroll?batches=5&batchSize=12`, rows: '#feed > li.item', fields: { text: '.' }, next: { type: 'scroll' } }),
  },
  {
    // The page counter crosses calls: the limit still stops the run, with its NOT THE END warning.
    name: 'a scrolling list stopped by maxPages',
    config: () => ({ url: `${base}/io-scroll?batches=8&batchSize=10`, rows: '#feed > li.item', fields: { text: '.' }, next: { type: 'scroll' }, maxPages: 3 }),
  },
  {
    // The last page's arrow is still there but does nothing: the stall counter must cross calls.
    name: 'a next control that pages through the list',
    config: () => ({ url: `${base}/numbered-pager/1?pages=3&perPage=10`, rows: '#list > li.item', fields: { text: '.' }, next: { type: 'click', selector: 'div.pager > a.arrow' } }),
  },
  {
    name: 'a load-more button',
    config: () => ({
      url: `${base}/shadow-thread?total=30&perBatch=10`,
      rows: 'comment-card',
      fields: { id: { css: '.', attr: 'data-id' }, author: '.author', text: 'p[slot=body]' },
      require: ['id'],
      dedupe: ['id'],
      next: { type: 'load-more', selector: 'button.more' },
    }),
  },
  {
    name: 'comments whose replies open with expand buttons',
    config: () => ({ url: `${base}/reply-threads?comments=10`, rows: '.comment-item', fields: { author: '.author', text: '.text' }, expand: ['button.reply-expand', 'button.reply-more:not(.collapse)'] }),
  },
  {
    // Records opened in place on every scroll: already opened ones are not clicked again in a later call.
    name: 'cards opened in place, more of them as the list scrolls',
    config: () => ({
      url: `${base}/excerpt-cards?posts=24&batch=8`,
      rows: '.post-card',
      fields: { title: '.post-title', link: { css: '.post-title a', attr: 'href' }, writer: '.byline .writer', posted: '.post-time', text: '.post-text' },
      expand: ['.read-more'],
      dedupe: ['link'],
    }),
  },
  {
    // Each page is a URL of its own: the page number of the next URL comes from the page counter.
    name: 'pages reached by URL',
    config: () => ({
      url: `${base}/wrapper-drop/1?pages=3&perPage=10&list=classed`,
      rows: 'div.video-list:not(aside > *) > div.item',
      fields: { title: '.title', link: { css: 'a', attr: 'href' } },
      next: { type: 'url', url: `${base}/wrapper-drop/{page}?pages=3&perPage=10&list=classed`, start: 2 },
      maxPages: 3,
    }),
  },
]

describe('a run split into calls ends as one run does', { skip: !haveFixtures && 'eval/ fixtures not found', concurrency: true }, () => {
  for (const { name, config } of CASES) {
    test(name, async () => {
      const cfg = { delayMs: 150, ...config() }
      const [whole, split] = await Promise.all([
        newPage().then(page => collectOnPage(page, structuredClone(cfg), lib)),
        newPage().then(async page => {
          let calls = 0
          const saved = []
          const result = await collectInChunks(
            state => {
              calls += 1
              // A state that lost its counters never ends: fail instead of hanging.
              if (calls > 100) throw new Error('more than 100 calls: the run does not end')
              return runCodeChunk(page, cfg, state, { steps: 1 })
            },
            state => saved.push(state.rows.length)
          )
          return { result, calls, saved }
        }),
      ])
      assert.ok(split.calls >= 3, `expected the run to be split, got ${split.calls} calls`)
      // Between calls the host has the rows so far, never fewer than before.
      assert.ok(split.saved.every((n, i) => n >= (split.saved[i - 1] ?? 0)), `rows between calls: ${split.saved}`)
      assert.ok(whole.rows.length > 0)
      assert.deepEqual(outcome(split.result), outcome(whole))
    })
  }
})

test('a call that finds the tab navigated since the last one stops with the rows so far', { skip: !haveFixtures && 'eval/ fixtures not found' }, async () => {
  const page = await newPage()
  const cfg = { url: `${base}/io-scroll?batches=4&batchSize=10`, rows: '#feed > li.item', fields: { text: '.' }, next: { type: 'scroll' }, delayMs: 150 }
  const first = await runCodeChunk(page, cfg, null, { steps: 2 })
  assert.equal(first.paused, true)
  const kept = first.state.rows.length
  assert.ok(kept > 0 && kept < 40, `rows after the first call: ${kept}`)
  // Someone used the tab between the calls: the page's own bookkeeping (element ids, what was opened) is gone.
  await page.goto(`${base}/io-scroll?batches=4&batchSize=10&other=1`)
  const result = await runCodeChunk(page, cfg, first.state, { steps: 2 })
  assert.equal(result.paused, undefined)
  assert.equal(result.stopReason, 'error')
  assert.match(result.note, /navigated between calls/)
  assert.equal(result.rows.length, kept)
})

test('a state from another version is refused, not half-used', { skip: !haveFixtures && 'eval/ fixtures not found' }, async () => {
  const page = await newPage()
  const result = await collectOnPage(page, { url: `${base}/io-scroll?batches=2&batchSize=5`, rows: '#feed > li.item', fields: { text: '.' } }, { ...lib, resume: { version: 0 } })
  assert.equal(result.stopReason, 'error')
  assert.match(result.note, /cannot resume/)
})

// ---------- collect.mjs killed half-way ----------
const csvRows = file => fs.readFileSync(file, 'utf8').split('\n').filter(Boolean).length - 1
const readJson = file => {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'))
  } catch {
    return null
  }
}
const pause = ms => new Promise(resolve => setTimeout(resolve, ms))

const SLOW_SCROLL = () => ({ url: `${base}/io-scroll?batches=20&batchSize=30&delayMs=600`, rows: '#feed > li.item', fields: { text: '.' }, next: { type: 'scroll' } })

/**
 * Start collect.mjs on `config` in a folder of its own. `ready(summary, out)` is polled (every 100 ms, up to
 * 60 s) until it holds. `detached`: a process group of its own (to signal the group, as a terminal Ctrl-C does).
 */
async function startRun(config, { ready = () => true, args = [], env = {}, detached = false, before = () => undefined } = {}) {
  const dir = tmpDir('scrape-kill-')
  const cfg = path.join(dir, 'cfg.json')
  fs.writeFileSync(cfg, JSON.stringify(config))
  const out = path.join(dir, 'rows.csv')
  const summaryFile = path.join(dir, 'rows.json')
  before(out, summaryFile)
  const child = spawn(process.execPath, [path.join(HERE, 'collect.mjs'), cfg, '--out', out, ...args], {
    stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, PLAYWRIGHT_FROM: REPO, ...env },
    detached,
  })
  let stderr = ''
  child.stderr.on('data', chunk => (stderr += chunk))
  child.stdout.resume()
  let done = null
  const exited = new Promise(resolve => child.on('exit', (code, signal) => resolve((done = { code, signal }))))
  const deadline = Date.now() + 60_000
  while (Date.now() < deadline && !done && !ready(readJson(summaryFile), { out, stderr: () => stderr })) await pause(100)
  return { child, exited, out, summaryFile, dir, stderr: () => stderr, done: () => done }
}

test('collect.mjs killed half-way leaves the rows of the rounds it finished', { skip: !haveFixtures && 'eval/ fixtures not found' }, async () => {
  const run = await startRun(SLOW_SCROLL(), { ready: summary => summary?.rows >= 60 })
  run.child.kill('SIGKILL')
  await run.exited
  const summary = readJson(run.summaryFile)
  assert.equal(summary.stopReason, 'running')
  assert.ok(summary.rows >= 60, `summary rows ${summary.rows}`)
  // The rows of every finished round, and maybe some of the round under way.
  assert.ok(summary.rows >= summary.roundLog.at(-1).total, `summary rows ${summary.rows}, last round total ${summary.roundLog.at(-1).total}`)
  // The CSV is written before the summary, so it has at least the rows the summary counts.
  const inCsv = csvRows(run.out)
  assert.ok(inCsv >= summary.rows && inCsv < 600, `csv rows ${inCsv}, summary rows ${summary.rows}`)
})

test('collect.mjs stopped by Ctrl-C writes what it has and says so', { skip: !haveFixtures && 'eval/ fixtures not found' }, async () => {
  const run = await startRun(SLOW_SCROLL(), { ready: summary => summary?.rows >= 60 })
  run.child.kill('SIGINT')
  const { code } = await run.exited
  assert.notEqual(code, 0)
  const summary = readJson(run.summaryFile)
  assert.equal(summary.stopReason, 'interrupted')
  assert.ok(summary.rows >= 60, `summary rows ${summary.rows}`)
  assert.equal(csvRows(run.out), summary.rows)
})

test('rows read while the first page is still being expanded are written before its round ends', { skip: !haveFixtures && 'eval/ fixtures not found' }, async () => {
  // Opening every record's replies on page 1 takes several seconds; the rows read meanwhile must not wait for it.
  const config = { url: `${base}/reply-threads?comments=20`, rows: '.comment-item', fields: { author: '.author', text: '.text' }, expand: ['button.reply-expand', 'button.reply-more:not(.collapse)'] }
  const run = await startRun(config, { ready: summary => summary?.rows > 0 && summary.roundLog.length === 0 })
  assert.equal(run.done(), null, `the run ended before its first round was saved half-way: ${run.stderr()}`)
  const midRound = readJson(run.summaryFile)
  assert.ok(midRound?.rows > 0 && midRound.roundLog.length === 0, `no rows written before the first round ended: ${JSON.stringify(midRound)}`)
  run.child.kill('SIGINT')
  const { code } = await run.exited
  assert.equal(code, 130)
  const summary = readJson(run.summaryFile)
  assert.equal(summary.stopReason, 'interrupted')
  assert.ok(summary.rows >= midRound.rows, `rows ${summary.rows}, saved half-way ${midRound.rows}`)
  assert.equal(csvRows(run.out), summary.rows)
})

test('a run that cannot save its rows for a while goes on and writes them all at the end', { skip: !haveFixtures && 'eval/ fixtures not found' }, async () => {
  // Saving fails while a folder sits where the CSV goes (a locked file does the same).
  const config = { url: `${base}/io-scroll?batches=4&batchSize=30&delayMs=300`, rows: '#feed > li.item', fields: { text: '.' }, next: { type: 'scroll' } }
  const run = await startRun(config, {
    before: out => { fs.mkdirSync(out); fs.writeFileSync(path.join(out, 'keep'), '') },
    ready: (_summary, { stderr }) => /could not save/.test(stderr()),
  })
  fs.rmSync(run.out, { recursive: true, force: true })
  const { code } = await run.exited
  assert.equal(code, 0, run.stderr())
  const summary = readJson(run.summaryFile)
  assert.equal(summary.stopReason, 'scroll-end')
  assert.equal(summary.rows, 120)
  assert.equal(csvRows(run.out), 120)
})

test('a run stopped before its first row leaves an earlier result at --out alone', { skip: !haveFixtures && 'eval/ fixtures not found' }, async () => {
  // The rows only come after a long first wait: the run is stopped before it has any.
  const config = { ...SLOW_SCROLL(), initialWaitMs: 8000 }
  const earlier = '\uFEFFtext\nfrom the run before\n'
  const keep = (out, summaryFile) => {
    fs.writeFileSync(out, earlier)
    fs.writeFileSync(summaryFile, JSON.stringify({ rows: 1, stopReason: 'scroll-end' }))
  }
  for (const signal of ['SIGKILL', 'SIGINT']) {
    // Long enough for the browser to be up and the page loading.
    const at = Date.now() + 2500
    const run = await startRun(config, { before: keep, ready: () => Date.now() > at })
    run.child.kill(signal)
    await run.exited
    assert.equal(fs.readFileSync(run.out, 'utf8'), earlier, `${signal}: the earlier CSV was replaced`)
    assert.equal(readJson(run.summaryFile).stopReason, 'scroll-end', `${signal}: the earlier summary was replaced`)
  }
})

test('rows saved less often on a long list still reach the file within a few seconds', { skip: !haveFixtures && 'eval/ fixtures not found' }, async () => {
  // 100 rows a round, quickly, then a batch that takes long: past 500 rows saves are spaced out, and the round
  // before the slow one must not wait for the next round to be written.
  const config = { url: `${base}/io-scroll?batches=9&batchSize=100&delayMs=0&slowBatch=7&slowMs=20000`, rows: '#feed > li.item', fields: { text: '.' }, next: { type: 'scroll' } }
  let at500 = 0
  const run = await startRun(config, {
    ready: summary => {
      if (!at500 && summary?.rows >= 500) at500 = Date.now()
      return summary?.rows >= 600
    },
  })
  const waited = Date.now() - at500
  run.child.kill('SIGKILL')
  await run.exited
  assert.ok(at500 > 0, 'never saw 500 rows')
  assert.ok(readJson(run.summaryFile).rows >= 600, 'never saw 600 rows')
  assert.ok(waited < 3500, `600 rows were written ${waited} ms after 500`)
})

// ---------- the Chrome path, with a stand-in for playwright-cli ----------
// The stand-in runs each run-code file against the first tab of a Chromium it reaches over CDP, so the tab and
// what the page keeps (window.__dlk) last from one call to the next, as in the user's Chrome.
const freePort = () =>
  new Promise(resolve => {
    const srv = net.createServer().listen(0, () => {
      const { port } = srv.address()
      srv.close(() => resolve(port))
    })
  })

async function standInCli() {
  const port = await freePort()
  const chrome = await chromium.launch({ args: [`--remote-debugging-port=${port}`] })
  const dir = tmpDir('scrape-cli-')
  const file = path.join(dir, 'playwright-cli.mjs')
  fs.writeFileSync(
    file,
    `import fs from 'node:fs'
import { chromium } from ${JSON.stringify(import.meta.resolve('playwright'))}
const args = process.argv.slice(2)
if (args.includes('list')) {
  console.log('- scrape:\\n  - status: open')
  process.exit(0)
}
const code = fs.readFileSync(args.find(a => a.startsWith('--filename=')).slice('--filename='.length), 'utf8')
const browser = await chromium.connectOverCDP('http://127.0.0.1:${port}')
const context = browser.contexts()[0]
const page = context.pages()[0] ?? (await context.newPage())
console.log(await (0, eval)(code)(page))
process.exit(0)
`
  )
  return { command: `${process.execPath} ${file}`, close: () => chrome.close() }
}

test('Ctrl-C in the terminal during a Chrome run writes what it has and says so', { skip: !haveFixtures && 'eval/ fixtures not found' }, async () => {
  const cli = await standInCli()
  try {
    const run = await startRun(SLOW_SCROLL(), {
      args: ['--browser', 'chrome'],
      env: { PLAYWRIGHT_CLI: cli.command, SCRAPE_CHUNK_SECONDS: '2' },
      detached: true,
      ready: summary => summary?.rows >= 60,
    })
    assert.equal(run.done(), null, `the run ended early: ${run.stderr()}`)
    // A terminal sends it to the whole process group: playwright-cli gets it too, mid-call.
    process.kill(-run.child.pid, 'SIGINT')
    const { code } = await run.exited
    const summary = readJson(run.summaryFile)
    assert.equal(summary.stopReason, 'interrupted', JSON.stringify(summary))
    assert.equal(code, 130)
    assert.ok(summary.rows >= 60, `summary rows ${summary.rows}`)
    assert.equal(csvRows(run.out), summary.rows)
  } finally {
    await cli.close()
  }
})
