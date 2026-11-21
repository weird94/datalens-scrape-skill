#!/usr/bin/env node
// Visit each row's detail page and add the fields read there (see SKILL.md "Detail pages").
//
//   node scripts/detail.mjs list.csv detail.json --out full.csv [--max-rows N]
//                           [--browser bundled|chrome] [--session NAME]
//
// list.csv: a CSV from collect.mjs (or any CSV) with a column of detail URLs (detail.json "link").
// Writes full.csv (every list row, in order, + the detail columns + detail_status), full.json (summary) and
// full.detail.jsonl (checkpoint: one line per URL as it finishes). Rerunning the same command resumes:
// ok / empty pages are kept, failed ones are retried while they have tries left, blocked ones again, and
// empty ones the run could not vouch for (it stopped in the middle of a run of empty pages).
//
// --max-rows N: only the first N distinct links (a preview).
// --browser chrome: the user's own Chrome (references/browser.md), one tab, pages in batches per call.
// --retry-empty: read pages recorded as empty again (e.g. after raising waitTimeoutMs). Pages recorded as
// empty by the other browser are read again on their own.
// SIGINT / SIGTERM / SIGHUP stop the run with stopReason "interrupted" (exit 130 / 143 / 129).
import fs from 'node:fs'
import path from 'node:path'
import { gotoAndSettle, openBrowser, parseArgs, runSetup, settle, writeFileAtomic } from './lib/browser.mjs'
import { runInChromeAsync } from './lib/chrome.mjs'
import { parseCsv, toCsv } from './lib/csv.mjs'
import {
  checkDetailSpec,
  DETAIL_STREAK_LIMIT,
  detailBatchProgram,
  detailLink,
  detailSpecKey,
  detailStatusColumn,
  mergeDetailRows,
  needsDetailFetch,
  nextStreaks,
  readDetailCheckpoint,
  readDetailPage,
  recordTextKeeper,
} from './lib/detail.mjs'
import { installDlk } from './lib/in-page.mjs'
import { summarizeDetail } from './lib/report-format.mjs'

const USAGE = 'usage: detail.mjs list.csv detail.json --out full.csv [--max-rows N] [--browser bundled|chrome] [--session NAME] [--retry-empty]'
const IN_PAGE = `(${installDlk})()`
/** Pages per run-code call in the user's Chrome; the checkpoint is written between calls. */
const CHROME_BATCH = 8
/** How often the CSV is rewritten while the run goes on (the checkpoint is written after every page). */
const CSV_EVERY_MS = 2000
/** Exit code per stop signal (128 + its number). */
const SIGNAL_EXIT = { SIGINT: 130, SIGTERM: 143, SIGHUP: 129 }
const VALUE_FLAGS = ['out', 'max-rows', 'browser', 'session']

const fail = message => {
  console.error(`detail.mjs: ${message}`)
  process.exit(2)
}

const { positional, flags } = parseArgs(process.argv.slice(2), ['retry-empty'])
const [listPath, specPath] = positional
for (const name of VALUE_FLAGS) {
  if (!(name in flags)) continue
  const value = flags[name]
  if (Array.isArray(value)) fail(`--${name} is given more than once`)
  if (value === undefined || value.startsWith('--')) fail(`--${name} needs a value\n${USAGE}`)
}
if (!listPath || !specPath || !flags.out) fail(USAGE)
const out = flags.out
const same = (a, b) => path.resolve(a) === path.resolve(b)
// The inputs are read again on every rerun: never write over them.
if ([listPath, specPath].some(p => same(p, out))) fail('--out must be another file than the list CSV and the detail config (both are read again on every rerun)')
let list
let spec
try {
  list = parseCsv(fs.readFileSync(listPath, 'utf8'))
} catch (error) {
  fail(`cannot read ${listPath}: ${error.message}`)
}
try {
  spec = JSON.parse(fs.readFileSync(specPath, 'utf8'))
} catch (error) {
  fail(`cannot read ${specPath}: ${error.message}`)
}
const problems = checkDetailSpec(spec, list.columns)
if (problems.length) fail(`${specPath}:\n  - ${problems.join('\n  - ')}`)
const browserMode = flags.browser ?? process.env.SCRAPE_BROWSER ?? 'bundled'
if (!['bundled', 'chrome'].includes(browserMode)) fail(`--browser must be bundled or chrome, not "${browserMode}"`)
const maxRows = flags['max-rows'] !== undefined ? Number(flags['max-rows']) : 0
if (flags['max-rows'] !== undefined && !(Number.isInteger(maxRows) && maxRows > 0)) fail('--max-rows needs a whole number > 0')
const maxAttempts = Number(spec.maxAttempts ?? 3)
const delayMs = Number(spec.delayMs ?? 1500)
const concurrency = browserMode === 'chrome' ? 1 : Number(spec.concurrency ?? 1)
const detailNames = Object.keys(spec.fields)
const statusColumn = detailStatusColumn(list.columns)

// ---------- files ----------
const base = out.replace(/\.csv$/i, '')
const checkpointPath = `${base}.detail.jsonl`
if ([listPath, specPath].some(p => same(p, checkpointPath))) fail(`--out ${out} would write its checkpoint over ${checkpointPath}: choose another --out`)
// Never overwrite an input: `detail.json --out detail.csv` would otherwise replace the config with the summary.
let summaryPath = `${base}.json`
if ([listPath, specPath].some(p => same(p, summaryPath))) summaryPath = `${base}.summary.json`
fs.mkdirSync(path.dirname(path.resolve(out)), { recursive: true })
const specKey = detailSpecKey(spec)
const checkpointText = fs.existsSync(checkpointPath) ? fs.readFileSync(checkpointPath, 'utf8') : ''
// A run killed while writing a line left it unfinished: end it, so the next line is not glued to it.
if (checkpointText && !checkpointText.endsWith('\n')) fs.appendFileSync(checkpointPath, '\n')
const { entries, stale } = readDetailCheckpoint(checkpointText, specKey)
/** Record excerpts go into the checkpoint for the first few pages per blank column only (the summary quotes one). */
const keepRecordText = recordTextKeeper(entries, detailNames)

// ---------- plan ----------
const rowUrls = list.rows.map(row => detailLink(row[spec.link]))
const links = [...new Set(rowUrls.filter(Boolean))]
const considered = maxRows ? links.slice(0, maxRows) : links
const fetchOptions = { browser: browserMode, retryEmpty: Boolean(flags['retry-empty']) }
const needsFetch = url => needsDetailFetch(entries.get(url), maxAttempts, fetchOptions)
const todo = considered.filter(needsFetch)
// Empty pages read again go last: a run that stopped on a run of empty pages does not stop on the same ones again.
const wasEmpty = url => entries.get(url)?.status === 'empty'
const queue = [...todo.filter(url => !wasEmpty(url)), ...todo.filter(wasEmpty)]

const started = Date.now()
let stopReason = null
let note = ''
let fetched = 0
let streaks = { blocked: 0, empty: 0 }
/** URLs of the empty pages since the last ok one: unconfirmed until an ok page (or the canary) vouches for the site. */
let emptyStreak = []
const canary = []
let lastCsv = 0
/** The signal that stopped the run, if one did. */
let interrupted = null
/** Ends the work in flight (closes the bundled browser, kills the run-code call). */
let abortRun = null

/** Stop the run (the first reason given wins). */
function stop(reason, text = '') {
  if (stopReason) return
  stopReason = reason
  note = text
}

function writeCsv() {
  const columns = [...list.columns, ...detailNames, statusColumn]
  writeFileAtomic(out, toCsv(columns, mergeDetailRows(list.rows, spec.link, detailNames, entries, statusColumn)))
  lastCsv = Date.now()
}

/** Keep an entry: checkpoint line now, CSV every few seconds. → the entry. */
function append(entry) {
  entries.set(entry.url, entry)
  fs.appendFileSync(checkpointPath, JSON.stringify(entry) + '\n')
  if (Date.now() - lastCsv >= CSV_EVERY_MS) writeCsv()
  return entry
}

/** Record one finished page. An empty one (not a dead link) is `unconfirmed` until the site is vouched for. */
function record(url, result, attemptsDelta = 1) {
  const prev = entries.get(url)
  const { status, fields = {}, error, httpStatus, notFound, recordText, recordScope } = result
  return append({
    url,
    status,
    fields,
    attempts: Number(prev?.attempts ?? 0) + attemptsDelta,
    spec: specKey,
    browser: browserMode,
    ...(status === 'empty' && !notFound ? { unconfirmed: true } : {}),
    ...(error ? { error } : {}),
    ...(httpStatus ? { httpStatus } : {}),
    ...(notFound ? { notFound } : {}),
    ...(keepRecordText(result) ? { recordText, ...(recordScope ? { recordScope } : {}) } : {}),
  })
}

/** The empty pages since the last ok one really are empty: the site served an ok page after (or around) them. */
function confirmEmpty() {
  for (const url of emptyStreak) {
    const entry = entries.get(url)
    if (!entry?.unconfirmed) continue
    const { unconfirmed, ...rest } = entry
    append(rest)
  }
  emptyStreak = []
}

/**
 * Take one result in: record it, requeue a failure with tries left, update the streaks.
 * → 'stop' (too many blocked pages), 'canary' (too many empty ones: check an ok page again) or null.
 */
function take(url, result) {
  fetched += 1
  const entry = record(url, result)
  if (entry.status === 'failed' && entry.attempts < maxAttempts) queue.push(url)
  streaks = nextStreaks(streaks, result)
  if (result.status === 'ok') confirmEmpty()
  else if (result.status === 'empty' && !result.notFound) emptyStreak.push(url)
  if (streaks.blocked >= DETAIL_STREAK_LIMIT) {
    stop('blocked', `${streaks.blocked} pages in a row looked blocked (last: ${url} — ${result.error ?? ''})`)
    return 'stop'
  }
  if (streaks.empty >= DETAIL_STREAK_LIMIT) return 'canary'
  return null
}

/**
 * Too many empty pages in a row: read again a page that read ok before, to tell "these pages are empty"
 * from "the site stopped serving us". `read(url)` → the result, or null when the run is stopping.
 * A server error on the check proves nothing: once more (on another ok page when there is one), and
 * after two errors the run goes on and checks again after the next empty pages. → 'stop' or null.
 */
async function checkCanary(read) {
  const ok = [...entries.values()].filter(e => e.status === 'ok' && !emptyStreak.includes(e.url)).map(e => e.url)
  if (!ok.length) {
    const first = entries.get(emptyStreak[0])
    stop('no-data', `${emptyStreak.length} pages read empty and none has read ok yet (e.g. ${emptyStreak[0]}: ${first?.error ?? 'empty'})`)
    return 'stop'
  }
  for (const target of [ok[0], ok[1] ?? ok[0]]) {
    const result = await read(target)
    if (!result) return 'stop'
    canary.push({ url: target, status: result.status, ...(result.error ? { error: result.error } : {}), afterEmpty: emptyStreak.length })
    if (result.status === 'ok') {
      streaks = { ...streaks, empty: 0 }
      confirmEmpty()
      return null
    }
    if (result.status === 'failed') continue
    // Every empty page the run cannot vouch for (from this run or one before) becomes blocked: a rerun reads them again.
    const suspects = [...entries.values()].filter(e => e.status === 'empty' && e.unconfirmed)
    for (const e of suspects) record(e.url, { status: 'blocked', fields: {}, error: `re-marked: a page that read fine before (${target}) now reads ${result.status}` }, 0)
    stop(
      'blocked',
      `${emptyStreak.length} pages read empty with no ok page between them, and ${target}, which read fine before, now reads ${result.status}${result.error ? ` (${result.error})` : ''}: the site is probably blocking, or its pages changed`
    )
    return 'stop'
  }
  streaks = { ...streaks, empty: 0 }
  return null
}

const jitter = () => Math.round(delayMs + Math.random() * delayMs)
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms))

let signalsSeen = 0
for (const signal of Object.keys(SIGNAL_EXIT)) {
  process.on(signal, () => {
    signalsSeen += 1
    if (signalsSeen > 1) process.exit(SIGNAL_EXIT[signal])
    interrupted ??= signal
    stop('interrupted')
    // Abort the page in flight: it is not recorded, and a rerun fetches it again.
    abortRun?.()
  })
}

async function runBundled() {
  // The signal handlers above close the browser themselves, after marking the run interrupted.
  const { browser, context } = await openBrowser({ handleSignals: false })
  abortRun = () => browser.close().catch(() => undefined)
  await context.addInitScript({ content: IN_PAGE })
  const lib = { settle, gotoAndSettle, runSetup, installDlk }
  let checking = false
  let busy = 0
  /** One read; null when the run is stopping (interrupted, or the browser went away: then nothing is recorded). */
  async function readOne(page, url) {
    const result = await readDetailPage(page, url, spec, lib)
    if (interrupted) return null
    if (!browser.isConnected() || page.isClosed()) {
      stop('error', `the browser closed while reading ${url}${result.error ? ` (${result.error})` : ''}`)
      return null
    }
    return result
  }
  async function worker(index) {
    const page = await context.newPage()
    let first = true
    if (index > 0) await sleep(jitter() * index)
    while (!stopReason) {
      const url = queue.shift()
      if (!url) {
        // Another worker may still requeue a failed page.
        if (!busy) break
        await sleep(200)
        continue
      }
      busy += 1
      try {
        if (!(await visit(page, url, first))) break
      } finally {
        busy -= 1
      }
      first = false
    }
  }
  /** One page (and the canary check it may call for). → false when this worker should stop. */
  async function visit(page, url, first) {
    if (!first) await sleep(jitter())
    if (stopReason) {
      queue.unshift(url)
      return false
    }
    const result = await readOne(page, url)
    if (!result) {
      queue.unshift(url)
      return false
    }
    const next = take(url, result)
    if (next === 'canary' && !checking) {
      checking = true
      await checkCanary(async target => {
        await sleep(jitter())
        return readOne(page, target)
      })
      checking = false
    }
    return !stopReason
  }
  try {
    await Promise.all(Array.from({ length: Math.min(concurrency, Math.max(1, queue.length)) }, (_, i) => worker(i)))
  } finally {
    await browser.close().catch(() => undefined)
  }
}

async function runInUserChrome(session) {
  const controller = new AbortController()
  abortRun = () => controller.abort()
  /** Read `urls` in the user's tab (one run-code call). → the results, or null when the run stops. */
  async function batchIn(urls, state) {
    const { sources, call } = detailBatchProgram(urls, spec, state)
    const run = await runInChromeAsync(session, sources, call, { signal: controller.signal })
    if (!run.ok) {
      // Ctrl-C in a terminal reaches the CLI too, and its exit may be seen before our own handler runs.
      if (!interrupted) await sleep(200)
      if (!interrupted && SIGNAL_EXIT[run.signal]) {
        interrupted = run.signal
        stop('interrupted')
      }
      stop('error', run.error ?? 'no results from run-code')
      return null
    }
    if (interrupted) return null
    if (run.value?.notRendering) {
      stop(
        'tab-not-rendering',
        'the browser is not drawing this tab (window minimized or covered, or tab in the background), so late content never comes. Ask the user to bring that Chrome window to the front and keep it visible during the run.'
      )
      return null
    }
    if (!Array.isArray(run.value?.results)) {
      stop('error', 'run-code returned no results')
      return null
    }
    return run.value.results
  }
  let delayFirst = false
  while (!stopReason && queue.length) {
    const batch = queue.splice(0, CHROME_BATCH)
    const results = await batchIn(batch, { ...streaks, limit: DETAIL_STREAK_LIMIT, delayFirst })
    if (!results) {
      queue.unshift(...batch)
      break
    }
    delayFirst = true
    const done = new Set(results.map(r => r.url))
    queue.unshift(...batch.filter(url => !done.has(url)))
    for (const { url, ...result } of results) {
      const next = take(url, result)
      if (next === 'stop') break
      if (next === 'canary') {
        const verdict = await checkCanary(async target => {
          const check = await batchIn([target], { limit: 99, delayFirst: true })
          if (check && !check.length) stop('error', 'the canary check returned nothing')
          return check?.[0] ?? null
        })
        if (verdict === 'stop') break
      }
    }
  }
}

try {
  if (queue.length) {
    if (browserMode === 'chrome') await runInUserChrome(flags.session ?? process.env.SCRAPE_SESSION ?? 'scrape')
    else await runBundled()
  }
} catch (error) {
  stop('error', String(error.message || error).split('\n')[0])
}
if (!stopReason) {
  // A preview stops at max-rows only while some link past it is still to be read.
  stopReason = considered.length < links.length && links.slice(considered.length).some(needsFetch) ? 'max-rows' : 'done'
}
// The run went through without a stop: the empty pages since the last ok one are what they read.
if (stopReason === 'done' || stopReason === 'max-rows') confirmEmpty()

writeCsv()
const summary = summarizeDetail({
  rowUrls,
  entries,
  detailNames,
  stopReason,
  note,
  maxRows,
  canary,
  extra: {
    fetchedThisRun: fetched,
    ...(stale ? { rereadAfterSpecChange: stale } : {}),
    ...(statusColumn !== 'detail_status' ? { statusColumn } : {}),
    ...(concurrency > 1 ? { concurrency } : {}),
    browser: browserMode,
    seconds: Math.round((Date.now() - started) / 1000),
    out: path.resolve(out),
    checkpoint: path.resolve(checkpointPath),
  },
})
fs.writeFileSync(summaryPath, JSON.stringify(summary, null, 2))
console.log(JSON.stringify(summary, null, 2))
if (interrupted) process.exit(SIGNAL_EXIT[interrupted])
