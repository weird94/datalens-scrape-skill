// `collect.mjs … --resume`: a list run that was cut off (killed, interrupted, an error) or stopped at a limit
// goes on where it stopped when the list can be addressed (page URLs), and is read again from the top with the
// saved rows kept when it cannot (scrolling, load-more). Either way the result is the one an uninterrupted run
// gives. Uses the playground's mock pages (eval/, started here on a free port, logging the pages asked for).
// Run with `node --test scripts/collect-resume.test.mjs`.
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { after, before, describe, test } from 'node:test'
import { fileURLToPath } from 'node:url'
import { parseCsv } from './lib/csv.mjs'
import { configKey, priorRounds, resumePlan } from './lib/resume.mjs'
import { REPO, haveFixtures, standInCli, startFixtureServer } from './test-support/fixture-server.mjs'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const skip = !haveFixtures && 'eval/ fixtures not found'

let fixtures
let base
const tmpDirs = []
const tmpDir = () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'scrape-resume-'))
  tmpDirs.push(dir)
  return dir
}
before(async () => {
  if (!haveFixtures) return
  fixtures = await startFixtureServer()
  base = fixtures.base
})
after(() => {
  fixtures?.stop()
  for (const dir of tmpDirs) fs.rmSync(dir, { recursive: true, force: true })
})

const pause = ms => new Promise(resolve => setTimeout(resolve, ms))
const readJson = file => {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'))
  } catch {
    return null
  }
}

/**
 * Run collect.mjs in `dir` (config written to dir/cfg.json when given) to its end, or until `killWhen(summary)`
 * holds: then the process (its group, with `detached`) gets `signal` — SIGKILL by default, as a crash or a closed
 * laptop does. `whileRunning(dir)` runs once the summary says `running`, before the kill.
 * → { code, stdout, stderr, summary, csv (text), requests (the pages the server was asked for meanwhile) }
 */
async function collect(dir, config, { args = [], env = {}, killWhen = null, detached = false, signal = 'SIGKILL', whileRunning = null } = {}) {
  const cfg = path.join(dir, 'cfg.json')
  if (config) fs.writeFileSync(cfg, JSON.stringify(config))
  const out = path.join(dir, 'rows.csv')
  const summaryFile = path.join(dir, 'rows.json')
  const from = fixtures.requests.length
  const child = spawn(process.execPath, [path.join(HERE, 'collect.mjs'), cfg, '--out', out, ...args], {
    stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, PLAYWRIGHT_FROM: REPO, ...env },
    detached,
  })
  let stdout = ''
  let stderr = ''
  child.stdout.on('data', chunk => (stdout += chunk))
  child.stderr.on('data', chunk => (stderr += chunk))
  let done = null
  const exited = new Promise(resolve => child.on('exit', (code, signal) => resolve((done = { code, signal }))))
  if (killWhen) {
    const deadline = Date.now() + 90_000
    while (!done && Date.now() < deadline && !killWhen(readJson(summaryFile))) await pause(50)
    assert.equal(done, null, `the run ended before it could be killed: ${stderr}`)
    if (whileRunning) await whileRunning(dir)
    if (detached) process.kill(-child.pid, signal)
    else child.kill(signal)
  }
  const { code } = await exited
  // Pages still loading when the process went may reach the log a moment later.
  await pause(killWhen ? 300 : 0)
  const csv = fs.existsSync(out) ? fs.readFileSync(out, 'utf8') : null
  return { code, stdout, stderr, summary: readJson(summaryFile), csv, requests: fixtures.requests.slice(from) }
}

/** The CSV of an uninterrupted run of `config` (one per config). */
const references = new Map()
async function reference(config) {
  const key = JSON.stringify(config)
  if (!references.has(key)) references.set(key, collect(tmpDir(), config))
  const run = await references.get(key)
  assert.equal(run.code, 0, run.stderr)
  return run
}

const rowsOf = csv => parseCsv(csv).rows
// The tests run side by side against one server: each run's pages carry a `run` parameter of its own (the
// fixtures ignore it, keep it in their page links, and none of the rows read show it).
/** Pages run `run` asked the server for, as page numbers, for paths like …/<fixture>/<n>. */
const pageNumbers = (requests, fixture, run) =>
  requests
    .filter(r => new URL(r, 'http://x').searchParams.get('run') === run)
    .map(r => r.match(new RegExp(`/${fixture}/(\\d+)`))?.[1])
    .filter(Boolean)
    .map(Number)

// Pages reached by a URL template.
const URL_PAGES = (run = 'ref') => ({
  url: `${base}/wrapper-drop/1?pages=6&perPage=10&list=classed&run=${run}`,
  rows: 'div.video-list:not(aside > *) > div.item',
  fields: { title: '.title', link: { css: 'a', attr: 'href' } },
  next: { type: 'url', url: `${base}/wrapper-drop/{page}?pages=6&perPage=10&list=classed&run=${run}`, start: 2 },
  delayMs: 700,
})
// A next control whose click loads the next page (a URL of its own per page).
const CLICK_PAGES = (run = 'ref') => ({
  url: `${base}/numbered-pager/1?pages=6&perPage=10&run=${run}`,
  rows: '#list > li.item',
  fields: { text: '.' },
  next: { type: 'click', selector: 'div.pager > a.arrow' },
  delayMs: 700,
})
// A list that loads as it scrolls: nothing to go back to but the top.
const SCROLL = (run = 'ref') => ({ url: `${base}/io-scroll?batches=6&batchSize=10&delayMs=700&run=${run}`, rows: '#feed > li.item', fields: { text: '.' }, next: { type: 'scroll' } })

// Grouped rows: a cell only the first row of each group shows (a text: the title of each row whose number ends
// in 5), filled down into the rows below it. So a group runs over each page boundary.
const GROUPED = { grp: { css: '.title', regex: '(\\S+ [0-9]*5)$' } }
const URL_GROUPED = (run = 'ref') => ({ ...URL_PAGES(run), fields: { title: '.title', ...GROUPED }, fillDown: ['grp'] })
const CLICK_GROUPED = (run = 'ref') => ({ ...CLICK_PAGES(run), fields: { title: '.title', ...GROUPED }, fillDown: ['grp'] })
// Cards whose text shows cut off until "read more" opens it; dedupe left at its default (every column).
const EXPANDING = (run = 'ref') => ({
  url: `${base}/excerpt-cards?posts=24&batch=8&run=${run}`,
  rows: '.post-card',
  fields: { title: '.post-title', link: { css: '.post-title a', attr: 'href' }, writer: '.byline .writer', posted: '.post-time', text: '.post-text', upvotes: { css: '.vote', number: true } },
  expand: ['.read-more'],
})

const killedAfter = n => summary => summary?.stopReason === 'running' && summary.rows >= n && summary.rows < 50
/** Killed once `n` pages are read (and saved as read), before the last one. */
const killedAfterPages = n => summary => summary?.stopReason === 'running' && summary.resume?.pages >= n && summary.rows < 50

describe('--resume', { skip, concurrency: true }, () => {
  test('pages by URL: a killed run goes on at the first page it had not finished', async () => {
    const ref = await reference(URL_PAGES())
    const dir = tmpDir()
    const killed = await collect(dir, URL_PAGES('a'), { killWhen: killedAfterPages(2) })
    const done = killed.summary.resume.pages
    assert.ok(done >= 2 && done < 6, `pages done when killed: ${done}`)
    const resumed = await collect(dir, null, { args: ['--resume'] })
    assert.equal(resumed.code, 0, resumed.stderr)
    assert.equal(resumed.csv, ref.csv)
    assert.equal(resumed.summary.rows, 60)
    assert.equal(resumed.summary.stopReason, ref.summary.stopReason)
    assert.equal(resumed.summary.resumed, 'continued')
    assert.equal(resumed.summary.resumedFrom.at(-1).stopReason, 'running')
    // The pages read before are not loaded again.
    const pages = pageNumbers(resumed.requests, 'wrapper-drop', 'a')
    assert.ok(pages.length && pages.every(n => n > done), `pages loaded by the resumed run: ${pages} (done before: ${done})`)
    // One run's summary: its rounds go on from those of the run before.
    assert.equal(resumed.summary.rounds, resumed.summary.roundLog.length)
    assert.deepEqual(resumed.summary.roundLog.slice(0, killed.summary.rounds), killed.summary.roundLog)
    assert.ok(!resumed.summary.roundLog.slice(killed.summary.rounds).some(r => r.label === 'page 1'))
  })

  test('a next control that loads a page of its own: a killed run reopens the last page it finished and clicks on', async () => {
    const ref = await reference(CLICK_PAGES())
    const dir = tmpDir()
    const killed = await collect(dir, CLICK_PAGES('b'), { killWhen: killedAfterPages(2) })
    const done = killed.summary.resume.pages
    assert.ok(done >= 2 && done < 6, `pages done when killed: ${done}`)
    const resumed = await collect(dir, null, { args: ['--resume'] })
    assert.equal(resumed.code, 0, resumed.stderr)
    assert.equal(resumed.csv, ref.csv)
    assert.equal(resumed.summary.stopReason, ref.summary.stopReason)
    assert.equal(resumed.summary.resumed, 'continued')
    const pages = pageNumbers(resumed.requests, 'numbered-pager', 'b')
    assert.ok(pages.length && pages.every(n => n >= done), `pages loaded by the resumed run: ${pages} (done before: ${done})`)
  })

  test('a page that is not the one the run stopped on (moved, redirected): read again from the top, nothing lost', async () => {
    const ref = await reference(CLICK_PAGES())
    const dir = tmpDir()
    await collect(dir, CLICK_PAGES('f'), { killWhen: killedAfterPages(2) })
    // The saved page now opens page 1, as a site that sends old page links to the start does.
    const summaryFile = path.join(dir, 'rows.json')
    const saved = readJson(summaryFile)
    saved.resume.url = CLICK_PAGES('f').url
    fs.writeFileSync(summaryFile, JSON.stringify(saved))
    const resumed = await collect(dir, null, { args: ['--resume'] })
    assert.equal(resumed.code, 0, resumed.stderr)
    assert.equal(resumed.summary.resumed, 'from-start')
    assert.match(resumed.summary.resumedFrom.at(-1).note, /from the top/)
    assert.equal(resumed.csv, ref.csv)
  })

  test('stopped at maxPages, resumed with a higher limit: goes on from the next page', async () => {
    const ref = await reference(URL_PAGES())
    const dir = tmpDir()
    const first = await collect(dir, URL_PAGES('c'), { args: ['--max-pages', '2'] })
    assert.equal(first.summary.stopReason, 'max-pages')
    assert.match(first.summary.warning, /NOT THE END/)
    const resumed = await collect(dir, null, { args: ['--resume', '--max-pages', '50'] })
    assert.equal(resumed.code, 0, resumed.stderr)
    assert.equal(resumed.csv, ref.csv)
    assert.deepEqual(pageNumbers(resumed.requests, 'wrapper-drop', 'c'), [3, 4, 5, 6, 7])
    assert.equal(resumed.summary.roundLog.find(r => r.round === first.summary.rounds + 1).label, 'url page 3')
  })

  test('a scrolling list is read again from the top, the saved rows kept and nothing doubled', async () => {
    const ref = await reference(SCROLL())
    const dir = tmpDir()
    const killed = await collect(dir, SCROLL('d'), { killWhen: killedAfter(20) })
    const before = rowsOf(killed.csv)
    const resumed = await collect(dir, null, { args: ['--resume'] })
    assert.equal(resumed.code, 0, resumed.stderr)
    assert.equal(resumed.summary.resumed, 'from-start')
    assert.match(resumed.summary.resumedFrom.at(-1).note, /from the top/)
    const rows = rowsOf(resumed.csv)
    assert.equal(new Set(rows.map(r => r.text)).size, rows.length, 'duplicate rows')
    const texts = new Set(rows.map(r => r.text))
    assert.ok(before.every(r => texts.has(r.text)), 'rows of the killed run went missing')
    assert.equal(resumed.csv, ref.csv)
    assert.equal(resumed.summary.stopReason, ref.summary.stopReason)
  })

  test('refused when the config changed, when nothing was saved, or when the CSV has other columns', async () => {
    const dir = tmpDir()
    await collect(dir, URL_PAGES('e'), { args: ['--max-pages', '1'] })
    const csv = fs.readFileSync(path.join(dir, 'rows.csv'), 'utf8')
    const summary = fs.readFileSync(path.join(dir, 'rows.json'), 'utf8')
    const changed = await collect(dir, { ...URL_PAGES('e'), rows: 'div.item' }, { args: ['--resume'] })
    assert.notEqual(changed.code, 0)
    assert.match(changed.stderr, /config .*changed/i)
    assert.match(changed.stderr, /new --out/)
    assert.equal(fs.readFileSync(path.join(dir, 'rows.csv'), 'utf8'), csv)
    assert.equal(fs.readFileSync(path.join(dir, 'rows.json'), 'utf8'), summary)
    // The CSV was edited to other columns.
    fs.writeFileSync(path.join(dir, 'rows.csv'), '﻿title\nx\n')
    const columns = await collect(dir, URL_PAGES('e'), { args: ['--resume'] })
    assert.notEqual(columns.code, 0)
    assert.match(columns.stderr, /columns/)
    const empty = await collect(tmpDir(), URL_PAGES('e'), { args: ['--resume'] })
    assert.notEqual(empty.code, 0)
    assert.match(empty.stderr, /no saved run/i)
  })

  test('a run that reached the end of the list is left as it is', async () => {
    const dir = tmpDir()
    const config = { url: `${base}/io-scroll?batches=2&batchSize=10&run=end`, rows: '#feed > li.item', fields: { text: '.' }, next: { type: 'scroll' } }
    const first = await collect(dir, config)
    assert.equal(first.summary.stopReason, 'scroll-end')
    const again = await collect(dir, null, { args: ['--resume'] })
    assert.equal(again.code, 0, again.stderr)
    assert.equal(again.requests.filter(r => r.includes('run=end')).length, 0)
    assert.equal(again.csv, first.csv)
    assert.match(again.stderr, /nothing to resume/)
    assert.equal(JSON.parse(again.stdout).rows, 20)
  })

  test('stopped at maxRows part way through a page (pages by URL): the rest of that page is read on resume', async () => {
    const ref = await reference(URL_PAGES())
    const dir = tmpDir()
    const first = await collect(dir, URL_PAGES('h'), { args: ['--max-rows', '15'] })
    assert.equal(first.summary.stopReason, 'max-rows')
    assert.equal(first.summary.rows, 15)
    const resumed = await collect(dir, null, { args: ['--resume', '--max-rows', '100'] })
    assert.equal(resumed.code, 0, resumed.stderr)
    assert.equal(resumed.csv, ref.csv)
    assert.equal(resumed.summary.resumed, 'continued')
    // The page the limit cut is read again, the ones before it are not.
    assert.deepEqual(pageNumbers(resumed.requests, 'wrapper-drop', 'h'), [2, 3, 4, 5, 6, 7])
  })

  test('stopped at maxRows part way through a page (pages by click): the rest of that page is read on resume', async () => {
    const ref = await reference(CLICK_PAGES())
    const dir = tmpDir()
    const first = await collect(dir, CLICK_PAGES('i'), { args: ['--max-rows', '25'] })
    assert.equal(first.summary.stopReason, 'max-rows')
    const resumed = await collect(dir, null, { args: ['--resume', '--max-rows', '100'] })
    assert.equal(resumed.code, 0, resumed.stderr)
    assert.equal(resumed.csv, ref.csv)
    assert.equal(resumed.summary.resumed, 'continued')
  })

  test('records opened by expand, read again from the top: the saved opened rows are not added again collapsed', async () => {
    const ref = await reference(EXPANDING())
    const dir = tmpDir()
    const killed = await collect(dir, EXPANDING('j'), { killWhen: summary => summary?.stopReason === 'running' && summary.rows >= 10 && summary.rows < 24 })
    assert.ok(killed.summary.rows >= 10)
    const resumed = await collect(dir, null, { args: ['--resume'] })
    assert.equal(resumed.code, 0, resumed.stderr)
    assert.equal(resumed.summary.resumed, 'from-start')
    assert.equal(resumed.csv.replaceAll('run=j', 'run=ref'), ref.csv)
  })

  test('fillDown across the page the run went on at (pages by URL): the first rows are filled as in one run', async () => {
    const ref = await reference(URL_GROUPED())
    const dir = tmpDir()
    await collect(dir, URL_GROUPED('k'), { args: ['--max-pages', '2'] })
    const resumed = await collect(dir, null, { args: ['--resume', '--max-pages', '50'] })
    assert.equal(resumed.code, 0, resumed.stderr)
    assert.equal(resumed.summary.resumed, 'continued')
    assert.equal(resumed.csv, ref.csv)
  })

  test('fillDown with pages by click: the reopened page is recognised, and the next page is filled as in one run', async () => {
    const ref = await reference(CLICK_GROUPED())
    const dir = tmpDir()
    await collect(dir, CLICK_GROUPED('l'), { args: ['--max-pages', '3'] })
    const resumed = await collect(dir, null, { args: ['--resume', '--max-pages', '50'] })
    assert.equal(resumed.code, 0, resumed.stderr)
    assert.equal(resumed.summary.resumed, 'continued')
    assert.equal(resumed.csv, ref.csv)
  })

  test('stopped with Ctrl-C (SIGINT), then resumed: the same CSV as one run', async () => {
    const ref = await reference(URL_PAGES())
    const dir = tmpDir()
    const stopped = await collect(dir, URL_PAGES('m'), { signal: 'SIGINT', killWhen: killedAfterPages(2) })
    assert.equal(stopped.code, 130)
    assert.equal(stopped.summary.stopReason, 'interrupted')
    const resumed = await collect(dir, null, { args: ['--resume'] })
    assert.equal(resumed.code, 0, resumed.stderr)
    assert.equal(resumed.csv, ref.csv)
    assert.equal(resumed.summary.resumedFrom.at(-1).stopReason, 'interrupted')
  })

  test('killed, resumed, killed again and resumed again: one run, each part listed', async () => {
    const ref = await reference(CLICK_PAGES())
    const dir = tmpDir()
    await collect(dir, CLICK_PAGES('n'), { killWhen: killedAfterPages(2) })
    const second = await collect(dir, null, { args: ['--resume'], killWhen: summary => summary?.stopReason === 'running' && summary.resume?.pages >= 4 && summary.rows < 60 })
    assert.equal(second.summary.resumed, 'continued')
    const third = await collect(dir, null, { args: ['--resume'] })
    assert.equal(third.code, 0, third.stderr)
    assert.equal(third.csv, ref.csv)
    assert.equal(third.summary.resumedFrom.length, 2)
    assert.deepEqual(third.summary.resumedFrom.map(part => part.stopReason), ['running', 'running'])
    assert.equal(third.summary.rounds, third.summary.roundLog.length)
  })

  test('pages by click read again from the top: saved rows whose price changed since are recognised on every page', async () => {
    const config = run => ({ ...CLICK_PAGES(run), fields: { title: '.title', price: '.price' } })
    const ref = await reference(config('ref'))
    const dir = tmpDir()
    await collect(dir, config('o'), { killWhen: killedAfterPages(3) })
    // The site changed its prices since, and the saved page no longer opens: read from the top.
    const summaryFile = path.join(dir, 'rows.json')
    const saved = readJson(summaryFile)
    saved.resume.url = config('o').url
    fs.writeFileSync(summaryFile, JSON.stringify(saved))
    const csvFile = path.join(dir, 'rows.csv')
    fs.writeFileSync(csvFile, fs.readFileSync(csvFile, 'utf8').replace(/¥(\d+)/g, (_, n) => `¥${Number(n) - 7}`))
    const resumed = await collect(dir, null, { args: ['--resume'] })
    assert.equal(resumed.code, 0, resumed.stderr)
    assert.equal(resumed.summary.resumed, 'from-start')
    assert.equal(resumed.csv, ref.csv)
  })

  test('setup that works once (a cookie banner) is not a failure when the list is read again from the top', async () => {
    const config = run => ({ ...CLICK_PAGES(run), url: `${CLICK_PAGES(run).url}&consent=1`, setup: [{ click: '.consent button', timeoutMs: 3000 }] })
    const ref = await reference(config('ref'))
    const dir = tmpDir()
    await collect(dir, config('p'), { killWhen: killedAfterPages(2) })
    // The saved page shows other rows now: the resumed run goes back to the start in the browser setup ran in.
    const summaryFile = path.join(dir, 'rows.json')
    const saved = readJson(summaryFile)
    saved.resume.keys = ['x', 'y', 'z']
    fs.writeFileSync(summaryFile, JSON.stringify(saved))
    const resumed = await collect(dir, null, { args: ['--resume'] })
    assert.equal(resumed.code, 0, resumed.stderr)
    assert.equal(resumed.summary.resumed, 'from-start')
    assert.equal(resumed.csv, ref.csv.replaceAll('run=ref', 'run=p'))
  })

  test('rows every page repeats (pinned) do not stand for a page: each page is known by its own rows', async () => {
    const config = run => ({ ...CLICK_PAGES(run), url: `${CLICK_PAGES(run).url}&pin=3` })
    const [two, three] = await Promise.all([2, 3].map(n => collect(tmpDir(), config(`q${n}`), { args: ['--max-pages', String(n)] })))
    assert.equal(two.summary.resume.keys.length, 3)
    assert.equal(three.summary.resume.keys.filter(key => two.summary.resume.keys.includes(key)).length, 0)
  })

  test('nothing to do: a URL list that ended on a missing page, or a limit the saved run already reached', async () => {
    const dir = tmpDir()
    const ended = await collect(dir, URL_PAGES('r'))
    assert.equal(ended.summary.rows, 60)
    const again = await collect(dir, null, { args: ['--resume'] })
    assert.equal(again.code, 0, again.stderr)
    assert.match(again.stderr, /nothing to resume/)
    assert.deepEqual(pageNumbers(again.requests, 'wrapper-drop', 'r'), [])
    assert.equal(again.csv, ended.csv)
    const limited = tmpDir()
    const first = await collect(limited, URL_PAGES('s'), { args: ['--max-pages', '3'] })
    const summary = fs.readFileSync(path.join(limited, 'rows.json'), 'utf8')
    const same = await collect(limited, null, { args: ['--resume', '--max-pages', '3'] })
    assert.equal(same.code, 0, same.stderr)
    assert.match(same.stderr, /Raise --max-pages/)
    assert.deepEqual(pageNumbers(same.requests, 'wrapper-drop', 's'), [])
    assert.equal(same.csv, first.csv)
    assert.equal(fs.readFileSync(path.join(limited, 'rows.json'), 'utf8'), summary)
  })

  test('refused while another run still writes the same --out', async () => {
    const dir = tmpDir()
    let refused = null
    await collect(dir, URL_PAGES('t'), {
      killWhen: summary => summary?.stopReason === 'running' && summary.rows >= 10,
      whileRunning: async () => {
        refused = await collect(dir, null, { args: ['--resume'] })
      },
    })
    assert.equal(refused.code, 2)
    assert.match(refused.stderr, /still writing/)
    // The killed run's lock is taken over.
    const resumed = await collect(dir, null, { args: ['--resume'] })
    assert.equal(resumed.code, 0, resumed.stderr)
  })

  test('in the user\'s Chrome: a killed run reopens the page it stopped at in the same tab and goes on', async () => {
    const ref = await reference(CLICK_PAGES())
    const cli = await standInCli()
    try {
      const dir = tmpDir()
      const env = { PLAYWRIGHT_CLI: cli.command, SCRAPE_CHUNK_STEPS: '1' }
      const killed = await collect(dir, CLICK_PAGES('g'), { args: ['--browser', 'chrome'], env, detached: true, killWhen: killedAfterPages(2) })
      const done = killed.summary.resume.pages
      assert.ok(done >= 2, `pages done when killed: ${done}`)
      const resumed = await collect(dir, null, { args: ['--resume', '--browser', 'chrome'], env })
      assert.equal(resumed.code, 0, resumed.stderr)
      assert.equal(resumed.csv, ref.csv)
      assert.equal(resumed.summary.resumed, 'continued')
      assert.equal(resumed.summary.browser, 'chrome')
      const pages = pageNumbers(resumed.requests, 'numbered-pager', 'g')
      assert.ok(pages.length && pages.every(n => n >= done), `pages loaded by the resumed run: ${pages} (done before: ${done})`)
    } finally {
      await cli.close()
    }
  })
})

describe('resume plan', () => {
  const config = { url: 'https://example.com/list?page=1', rows: 'li', fields: { a: '.a' }, next: { type: 'url', url: 'https://example.com/list?page={page}', start: 2 } }
  const saved = (over = {}) => ({ rows: 2, stopReason: 'running', rounds: 1, roundLog: [{ round: 1, label: 'page 1', added: 2, total: 2 }], resume: { config: configKey(config), pages: 1, turn: 0, url: config.url }, ...over })
  const csv = '﻿a\nx\ny\n'

  test('the key leaves out limits and pacing but not what is read', () => {
    assert.equal(configKey(config), configKey({ ...config, maxPages: 3, maxRows: 9, delayMs: 10 }))
    assert.equal(configKey(config), configKey({ ...config, next: { ...config.next, waitMs: 20_000, quietMs: 3000 } }))
    assert.notEqual(configKey(config), configKey({ ...config, fields: { a: '.b' } }))
    assert.notEqual(configKey(config), configKey({ ...config, next: { ...config.next, start: 3 } }))
  })

  test('pages by URL go on after the last page read; other lists start again with the rows seeded', () => {
    const plan = resumePlan({ config, summary: saved(), csvText: csv })
    assert.equal(plan.how, 'continued')
    assert.equal(plan.resumeAt.pages, 1)
    assert.deepEqual(plan.seedRows, [{ a: 'x' }, { a: 'y' }])
    const scroll = resumePlan({ config: { ...config, next: undefined }, summary: saved({ resume: { ...saved().resume, config: configKey({ ...config, next: undefined }) } }), csvText: csv })
    assert.equal(scroll.how, 'from-start')
  })

  test('refusals and a finished run', () => {
    assert.match(resumePlan({ config, summary: null, csvText: csv }).refuse, /no saved run/i)
    assert.match(resumePlan({ config, summary: saved({ resume: undefined }), csvText: csv }).refuse, /no resume/i)
    assert.match(resumePlan({ config, summary: saved(), csvText: null }).refuse, /CSV/)
    assert.match(resumePlan({ config, summary: saved(), csvText: '﻿b\nx\n' }).refuse, /columns/)
    assert.match(resumePlan({ config: { ...config, rows: 'tr' }, summary: saved(), csvText: csv }).refuse, /changed/)
    assert.equal(resumePlan({ config, summary: saved({ stopReason: 'url-page-empty' }), csvText: csv }).done, true)
    // A list that stalled on a wall can be picked up (in the user's Chrome, after they log in).
    assert.equal(resumePlan({ config, summary: saved({ stopReason: 'no-new-rows', wall: { kind: 'login' } }), csvText: csv }).done, undefined)
  })

  test('rounds the summary skipped are kept as placeholders, so numbering and the shortened log go on', () => {
    const log = [...Array.from({ length: 6 }, (_, i) => ({ round: i + 1 })), { skipped: 8 }, ...Array.from({ length: 6 }, (_, i) => ({ round: i + 15 }))]
    const rounds = priorRounds({ rounds: 20, roundLog: log })
    assert.equal(rounds.length, 20)
    assert.deepEqual(rounds.slice(-6), log.slice(-6))
    assert.equal(rounds[10].round, 11)
  })
})
