#!/usr/bin/env node
// Generic list collector driven by a JSON config (see SKILL.md for the format).
//
//   node scripts/collect.mjs config.json --out rows.csv [--max-pages N] [--max-rows N]
//                                        [--browser bundled|chrome] [--session NAME] [--resume]
//
// --browser bundled (default): a fresh headless browser started here.
// --browser chrome: the user's own Chrome through the Playwright extension (references/browser.md);
//   the session is attached on first use and the loop runs inside `playwright-cli run-code`, in calls of
//   SCRAPE_CHUNK_SECONDS (default 30) that each go on where the last one stopped, in the same tab.
//
// Writes rows.csv and rows.json (summary: stop reason, per-round counts, page text tail) as the run goes:
// both are rewritten after each read of the page (or each Chrome call), with stopReason "running" until the run
// ends. Files already at --out stay until the run has a row to write. A save that fails is retried later.
// SIGINT / SIGTERM / SIGHUP (also a Ctrl-C that reached playwright-cli) write the rows so far with stopReason
// "interrupted" and exit 130 / 143 / 129. A SIGKILL leaves the last save, at stopReason "running".
// SCRAPE_CHUNK_STEPS / SCRAPE_CHUNK_SECONDS also split a bundled run into such calls (to test them).
//
// --resume goes on with the run saved at --out (cut off, or stopped at maxPages / maxRows) instead of starting
// again: pages by URL at the next page, click-next pages with a URL each on the last page it finished, other
// lists from the top with the saved rows kept (lib/resume.mjs). The summary then reads as one run, with
// `resumed` / `resumedFrom`. Refused (exit 2) when the config changed, nothing is saved, or the CSV has other
// columns, or while another run writes the same --out; a run that reached the end of the list, or the limit it is
// rerun with, is printed and left as it is.
import fs from 'node:fs'
import path from 'node:path'
import { gotoAndSettle, openBrowser, parseArgs, runSetup, settle, writeFileAtomic } from './lib/browser.mjs'
import { runInChrome } from './lib/chrome.mjs'
import { CHUNK_SOURCES, chunkCall, collectInChunks, runChunkHere } from './lib/chunks.mjs'
import { toCsv } from './lib/csv.mjs'
import { installDlk } from './lib/in-page.mjs'
import { collectOnPage } from './lib/collector.mjs'
import { summarizeCollect } from './lib/report-format.mjs'
import { resumeBlock, resumePlan } from './lib/resume.mjs'

const IN_PAGE = `(${installDlk})()`
const { positional, flags } = parseArgs(process.argv.slice(2), ['resume'])
if (!positional[0] || !flags.out) {
  console.error('usage: collect.mjs config.json --out rows.csv [--max-pages N] [--max-rows N] [--browser bundled|chrome] [--session NAME] [--resume]')
  process.exit(2)
}
const config = JSON.parse(fs.readFileSync(positional[0], 'utf8'))
const out = flags.out
if (flags['max-pages'] !== undefined) config.maxPages = Number(flags['max-pages'])
if (flags['max-rows'] !== undefined) config.maxRows = Number(flags['max-rows'])
for (const key of ['url', 'rows']) if (!config[key]) throw new Error(`config.${key} is required`)
if (!Object.keys(config.fields ?? {}).length) throw new Error('config.fields needs at least one field')
const browserMode = flags.browser ?? process.env.SCRAPE_BROWSER ?? 'bundled'
const chunkSteps = Number(process.env.SCRAPE_CHUNK_STEPS ?? 0)
const chunkSeconds = Number(process.env.SCRAPE_CHUNK_SECONDS ?? 0)

const started = Date.now()

// ---------- output ----------
const columns = Object.keys(config.fields)
fs.mkdirSync(path.dirname(path.resolve(out)), { recursive: true })
// Never overwrite the config: `cfg.json --out cfg.csv` would otherwise replace it with the summary.
let summaryPath = out.replace(/\.csv$/i, '') + '.json'
if (path.resolve(summaryPath) === path.resolve(positional[0])) summaryPath = out.replace(/\.csv$/i, '') + '.summary.json'

const readText = file => {
  try {
    return fs.readFileSync(file, 'utf8')
  } catch {
    return null
  }
}

// ---------- one run per --out ----------
// A run keeps `<out>.lock` (its pid) while it goes: a second run on the same --out (a --resume started while the
// first still goes) would write the same two files in turn. A lock whose process is gone (killed) is taken over.
const lockPath = `${out}.lock`
const lockHolder = () => {
  const pid = Number(readText(lockPath))
  if (!Number.isInteger(pid) || pid <= 0 || pid === process.pid) return null
  try {
    process.kill(pid, 0)
    return pid
  } catch (error) {
    return error.code === 'EPERM' ? pid : null
  }
}
const holder = lockHolder()
if (holder) {
  console.error(`another collect.mjs (pid ${holder}) is still writing ${out}: wait for it to end (or stop it), then rerun; or use another --out. (Its pid is in ${lockPath}.)`)
  process.exit(2)
}
fs.writeFileSync(lockPath, String(process.pid))
process.on('exit', () => {
  if (readText(lockPath) === String(process.pid)) fs.rmSync(lockPath, { force: true })
})

// ---------- --resume ----------
/** The saved run this one goes on with: { plan (lib/resume.mjs), saved (its summary) }, or null. */
let resuming = null
if (flags.resume) {
  const text = readText(summaryPath)
  let saved = null
  try {
    saved = text === null ? null : JSON.parse(text)
  } catch (error) {
    console.error(`--resume: the saved summary ${summaryPath} cannot be read (${error.message}). Use a new --out, or rerun without --resume to start over.`)
    process.exit(2)
  }
  const plan = resumePlan({ config, summary: saved, csvText: readText(out) })
  if (plan.refuse) {
    console.error(plan.refuse)
    process.exit(2)
  }
  if (plan.done) {
    console.error(plan.message)
    console.log(JSON.stringify(saved, null, 2))
    process.exit(0)
  }
  resuming = { plan, saved }
  console.error(plan.how === 'continued' ? `--resume: going on at ${plan.resumedFrom.at} with the ${plan.seedRows.length} saved rows` : `--resume: ${plan.resumedFrom.note}`)
}
/** Where the run stands (the collector's `position`), and how it went on from the saved run (`resumed`). */
let latestPosition = null
let latestResumed = null
if (resuming) {
  const { config: _key, paging: _paging, next: _next, ...position } = resuming.saved.resume
  latestPosition = position
}

/** Summary parts that a run going on at a page does not compute again (they come from page 1). */
const CARRIED = ['setup', 'unreadLinks', 'unreadParts', 'expand', 'expandMissed', 'expandNoEffect', 'expandPastStart']

/** The summary of `result`: one run's, also when it went on from a saved one. */
function summaryOf(result) {
  // A resumed run that stopped before it loaded a page (a limit already reached): the page it ended on is the saved run's.
  if (resuming && !/^https?:/i.test(result.lastUrl ?? '')) result = { ...result, lastUrl: resuming.saved.lastUrl ?? result.lastUrl, tail: resuming.saved.pageTextTail ?? result.tail }
  const seconds = Math.round((Date.now() - started) / 1000) + Number(resuming?.saved.seconds ?? 0)
  const extra = { browser: browserMode, seconds, out: path.resolve(out) }
  const resume = resumeBlock(config, result.position ?? latestPosition)
  if (!resuming) return { ...summarizeCollect(result, extra), resume }
  // The saved rows came in as seed rows: they are this run's rows, not a preview's.
  const summary = summarizeCollect({ ...result, seeded: 0 }, extra)
  const went = result.resumed ?? latestResumed ?? { how: resuming.plan.how }
  const entry = { ...resuming.plan.resumedFrom, how: went.how }
  if (went.how === 'from-start') {
    delete entry.at
    entry.note = went.note ?? entry.note
  }
  if (went.how === 'continued') for (const key of CARRIED) if (summary[key] === undefined && resuming.saved[key] !== undefined) summary[key] = resuming.saved[key]
  const { rows, stopReason, ...rest } = summary
  return { rows, stopReason, resumed: went.how, resumedFrom: [...(resuming.saved.resumedFrom ?? []), entry], ...rest, resume }
}

/** The CSV and the summary for `result` (the end of the run, or the rows so far). → the summary. */
function writeOutput(result) {
  // Written next to the file, then renamed over it, so a reader never sees half of one. The two are not renamed as
  // one: a kill between them leaves a CSV one save newer than the summary's `resume` block. --resume copes (rows
  // past that block's `rows` are taken as rows of the page after it, which is read again).
  writeFileAtomic(out, toCsv(columns, result.rows))
  const summary = summaryOf(result)
  writeFileAtomic(summaryPath, JSON.stringify(summary, null, 2))
  return summary
}

// Rows can change after they are written (an opened record is read again), so each save rewrites the file.
// Rows collected so far: saved after every read while they are few; past that at most every SAVE_EVERY_MS,
// with a timer that writes what a skipped save had (no rows wait longer than that to be written).
const SAVE_EVERY_READ_UP_TO = 500
const SAVE_EVERY_MS = 2000
let latest = { rows: [], rounds: [], lastUrl: '' }
let lastSave = 0
/** Whether this run has written the files yet: until it has a row, an earlier result at --out is left alone. */
let wrote = false
let pendingSave = null
function saveNow() {
  clearTimeout(pendingSave)
  pendingSave = null
  lastSave = Date.now()
  try {
    writeOutput({ ...latest, stopReason: 'running' })
    wrote = true
  } catch (error) {
    // Best effort (the file open elsewhere, a full disk): the run goes on, and the next save tries again.
    console.error(`could not save the rows so far to ${out} (${error.message}); trying again with the next rows`)
  }
}
function saveProgress(rows, rounds, { force = false, lastUrl } = {}) {
  latest = { rows, rounds, lastUrl: lastUrl ?? latest.lastUrl }
  if (!rows.length && !wrote) return
  const wait = SAVE_EVERY_MS - (Date.now() - lastSave)
  if (!force && rows.length > SAVE_EVERY_READ_UP_TO && wait > 0) {
    pendingSave ??= setTimeout(saveNow, wait).unref()
    return
  }
  saveNow()
}

let stopping = false
/** Write the rows so far as "interrupted" and exit (Ctrl-C, SIGTERM, SIGHUP: a closed terminal). */
function interrupt(signal) {
  if (stopping) return
  stopping = true
  clearTimeout(pendingSave)
  const result = { ...latest, stopReason: 'interrupted', note: `stopped by ${signal}; the CSV has the rows collected until then (rerun the same command with --resume to go on)` }
  let summary
  try {
    summary = latest.rows.length || wrote
      ? writeOutput(result)
      : { ...summaryOf(result), note: `stopped by ${signal} before any row was collected${resuming ? ' in this run' : ''}; nothing was written to ${out}` }
  } catch (error) {
    console.error(`could not write the rows so far to ${out}: ${error.message}`)
  }
  if (summary) console.log(JSON.stringify(summary, null, 2))
  process.exit(SIGNAL_EXIT[signal])
}
/** Exit code per stop signal (128 + its number). */
const SIGNAL_EXIT = { SIGINT: 130, SIGTERM: 143, SIGHUP: 129 }
for (const signal of Object.keys(SIGNAL_EXIT)) process.on(signal, () => interrupt(signal))
/** Let a signal that came while the event loop was blocked (a playwright-cli call) reach its handler. */
const yieldToSignals = () => new Promise(resolve => setImmediate(resolve))

let result
if (browserMode === 'chrome') {
  result = await runInUserChrome(flags.session ?? process.env.SCRAPE_SESSION ?? 'scrape')
} else {
  const { browser, context, page } = await openBrowser()
  await context.addInitScript({ content: IN_PAGE })
  const progress = now => saveProgress(now.rows, now.rounds, { lastUrl: page.url() })
  // A page boundary is saved at once: a run killed after it goes on after that page.
  const onPage = (position, { resumed }) => {
    latestPosition = position
    latestResumed = resumed ?? latestResumed
    saveProgress(latest.rows, latest.rounds, { lastUrl: page.url() })
  }
  const lib = { settle, gotoAndSettle, runSetup, installDlk, onRows: progress, onRound: (_entry, now) => progress(now), onPage, ...startOptions() }
  result = chunkSteps || chunkSeconds
    ? await collectInChunks(
        state => runChunkHere(page, config, lib, state, { steps: chunkSteps, ms: chunkSeconds * 1000 }),
        savePause
      )
    : await collectOnPage(page, config, lib)
  await browser.close()
}

/** What the first call of the collector gets: the saved run's rows and where to go on (--resume). */
function startOptions() {
  return resuming ? { seedRows: resuming.plan.seedRows, resumeAt: resuming.plan.resumeAt } : {}
}

/** Between two calls of a chunked run: save the rows so far and where the run stands. */
function savePause(state) {
  latestPosition = state.place?.position ?? latestPosition
  latestResumed = state.place?.resumed ?? latestResumed
  saveProgress(state.rows, state.rounds, { force: true, lastUrl: state.url })
}

/** Ship the loop to the user's Chrome (lib/chrome.mjs) in calls of a bounded length; rows come back as JSON. */
function runInUserChrome(session) {
  const pauseAfter = { steps: chunkSteps, ms: (chunkSeconds || 30) * 1000 }
  return collectInChunks(
    async (state, n) => {
      // Later calls must run in the tab the first one used: never attach again half-way.
      const run = runInChrome(session, CHUNK_SOURCES, chunkCall(config, state, pauseAfter, startOptions()), { attach: n === 1 })
      // A Ctrl-C in the terminal reaches playwright-cli too, which then fails: that is the user stopping the run.
      await yieldToSignals()
      if (SIGNAL_EXIT[run.signal]) interrupt(run.signal)
      if (run.ok && (run.value?.paused || Array.isArray(run.value?.rows))) return run.value
      const kept = state ? ` (call ${n}; the rows of the calls before are kept)` : resuming ? ' (the saved rows are kept)' : ''
      // Before the first call returned, the rows are the saved run's (--resume) or none.
      const rows = state?.rows ?? resuming?.plan.seedRows ?? []
      const rounds = state?.rounds ?? resuming?.plan.resumeAt.rounds ?? []
      return { rows, rounds, stopReason: 'error', note: `${run.error ?? 'no rows in run-code result'}${kept}`, tail: '', lastUrl: state?.url ?? '' }
    },
    savePause
  )
}

await yieldToSignals()
clearTimeout(pendingSave)
let summary
try {
  summary = writeOutput(result)
} catch (error) {
  console.error(`could not write ${out} (${error.message}); trying once more`)
  await new Promise(resolve => setTimeout(resolve, 1000))
  summary = writeOutput(result)
}
console.log(JSON.stringify(summary, null, 2))
