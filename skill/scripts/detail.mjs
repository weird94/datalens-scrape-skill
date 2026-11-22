#!/usr/bin/env node
// Visit each row's detail page and add the fields read there (see SKILL.md "Detail pages").
//
//   node scripts/detail.mjs list.csv detail.json --out full.csv [--max-rows N]
//                           [--browser bundled|chrome] [--session NAME]
//
// list.csv: a CSV from collect.mjs (or any CSV) with a column of detail URLs (detail.json "link").
// Writes full.csv (every list row, in order, + the detail columns + detail_status), full.json (summary) and
// full.detail.jsonl (checkpoint: one line per URL as it finishes). With "children" (a list inside each detail
// page) full.csv also gets children_count, and full.children.csv holds the child rows (parent_link, parent_row,
// child_index + the child columns). Rerunning the same command resumes:
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
  CHILD_KEY_COLUMNS,
  childCsvDue,
  childrenCountColumn,
  DETAIL_STREAK_LIMIT,
  detailBatchProgram,
  detailSpecKey,
  detailStatusColumn,
  mergeChildRows,
  mergeDetailRows,
  readDetailCheckpoint,
  readDetailPage,
} from './lib/detail.mjs'
import { createDetailRun } from './lib/detail-run.mjs'
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
const delayMs = Number(spec.delayMs ?? 1500)
const concurrency = browserMode === 'chrome' ? 1 : Number(spec.concurrency ?? 1)
const detailNames = Object.keys(spec.fields)
const statusColumn = detailStatusColumn(list.columns)
const childNames = spec.children ? Object.keys(spec.children.fields) : []
const countColumn = spec.children ? childrenCountColumn(list.columns) : null

// ---------- files ----------
const base = out.replace(/\.csv$/i, '')
const checkpointPath = `${base}.detail.jsonl`
if ([listPath, specPath].some(p => same(p, checkpointPath))) fail(`--out ${out} would write its checkpoint over ${checkpointPath}: choose another --out`)
// Never overwrite an input: `detail.json --out detail.csv` would otherwise replace the config with the summary.
let summaryPath = `${base}.json`
if ([listPath, specPath].some(p => same(p, summaryPath))) summaryPath = `${base}.summary.json`
const childrenPath = spec.children ? `${base}.children.csv` : null
if (childrenPath && [listPath, specPath].some(p => same(p, childrenPath))) fail(`--out ${out} would write its child table over ${childrenPath}: choose another --out`)
/** Warnings the run raises itself (they go first in the summary). */
const runWarnings = []
// A child table left by an earlier run with "children": this spec has none, so it would sit beside a CSV it no longer matches.
const oldChildren = `${base}.children.csv`
if (!spec.children && fs.existsSync(oldChildren) && ![listPath, specPath].some(p => same(p, oldChildren))) {
  const stalePath = `${base}.children.stale.csv`
  fs.renameSync(oldChildren, stalePath)
  runWarnings.push(`this config has no "children", so the child table an earlier run wrote to this --out was moved to ${path.resolve(stalePath)}: it does not match ${path.resolve(out)} any more; do not report it as current.`)
}
fs.mkdirSync(path.dirname(path.resolve(out)), { recursive: true })
const specKey = detailSpecKey(spec)
const checkpointText = fs.existsSync(checkpointPath) ? fs.readFileSync(checkpointPath, 'utf8') : ''
// A run killed while writing a line left it unfinished: end it, so the next line is not glued to it.
if (checkpointText && !checkpointText.endsWith('\n')) fs.appendFileSync(checkpointPath, '\n')
const { entries, stale } = readDetailCheckpoint(checkpointText, specKey)

// ---------- plan ----------
/** CSV rewrites while the run goes on (the checkpoint is written after every page). */
let lastCsv = 0
/** Child rows the child table had when it was last written, and when. */
let childCsv = { rows: 0, at: 0 }
const run = createDetailRun({
  spec,
  listRows: list.rows,
  entries,
  maxLinks: maxRows,
  retryEmpty: Boolean(flags['retry-empty']),
  browser: browserMode,
  persist: keep,
})
const { queue, rowUrls, take, checkCanary, stop } = run

const started = Date.now()
/** The signal that stopped the run, if one did. */
let interrupted = null
/** Ends the work in flight (closes the bundled browser, kills the run-code call). */
let abortRun = null

/** Rewrite the CSV, and the child table too (`children`: always at the end; while running, see childCsvDue). */
function writeCsv({ children = true } = {}) {
  const columns = [...list.columns, ...detailNames, ...(countColumn ? [countColumn] : []), statusColumn]
  writeFileAtomic(out, toCsv(columns, mergeDetailRows(list.rows, spec.link, detailNames, entries, statusColumn, countColumn)))
  lastCsv = Date.now()
  if (childrenPath && children) {
    const rows = mergeChildRows(list.rows, spec.link, childNames, entries)
    writeFileAtomic(childrenPath, toCsv([...CHILD_KEY_COLUMNS, ...childNames], rows))
    childCsv = { rows: rows.length, at: Date.now() }
  }
}

/** Keep an entry the run recorded: checkpoint line now, CSV every few seconds (the child table less often once it is big). */
function keep(entry) {
  fs.appendFileSync(checkpointPath, JSON.stringify(entry) + '\n')
  if (Date.now() - lastCsv >= CSV_EVERY_MS) {
    const rows = childrenPath ? childRowCount() : 0
    writeCsv({ children: Boolean(childrenPath) && childCsvDue({ rows, writtenRows: childCsv.rows, sinceMs: Date.now() - childCsv.at, everyMs: CSV_EVERY_MS }) })
  }
}

/** The child table's row count now (rows per list row, like mergeChildRows), without building it. */
function childRowCount() {
  let n = 0
  for (const url of rowUrls) {
    const entry = url ? entries.get(url) : null
    if (entry?.status === 'ok') n += entry.children?.length ?? 0
  }
  return n
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
    while (!run.stopReason) {
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
    if (run.stopReason) {
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
    return !run.stopReason
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
    const ran = await runInChromeAsync(session, sources, call, { signal: controller.signal })
    if (!ran.ok) {
      // Ctrl-C in a terminal reaches the CLI too, and its exit may be seen before our own handler runs.
      if (!interrupted) await sleep(200)
      if (!interrupted && SIGNAL_EXIT[ran.signal]) {
        interrupted = ran.signal
        stop('interrupted')
      }
      stop('error', ran.error ?? 'no results from run-code')
      return null
    }
    if (interrupted) return null
    if (ran.value?.notRendering) {
      stop(
        'tab-not-rendering',
        'the browser is not drawing this tab (window minimized or covered, or tab in the background), so late content never comes. Ask the user to bring that Chrome window to the front and keep it visible during the run.'
      )
      return null
    }
    if (!Array.isArray(ran.value?.results)) {
      stop('error', 'run-code returned no results')
      return null
    }
    return ran.value.results
  }
  let delayFirst = false
  while (!run.stopReason && queue.length) {
    const batch = queue.splice(0, CHROME_BATCH)
    const results = await batchIn(batch, { ...run.streaks, limit: DETAIL_STREAK_LIMIT, delayFirst })
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
// Without a stop the run is 'done' (or 'max-rows' while some link past it is still to be read), and the empty pages
// since the last ok one are what they read.
const { stopReason, note, canary, fetched } = run.finish()

writeCsv()
const summary = summarizeDetail({
  rowUrls,
  entries,
  detailNames,
  stopReason,
  note,
  maxRows,
  canary,
  extraWarnings: runWarnings,
  children: spec.children ? { selector: spec.children.rows, names: childNames, out: path.resolve(childrenPath), countColumn, rooted: Boolean(spec.root) } : null,
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
