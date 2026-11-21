#!/usr/bin/env node
// Generic list collector driven by a JSON config (see SKILL.md for the format).
//
//   node scripts/collect.mjs config.json --out rows.csv [--max-pages N] [--max-rows N]
//                                        [--browser bundled|chrome] [--session NAME]
//
// --browser bundled (default): a fresh headless browser started here.
// --browser chrome: the user's own Chrome through the Playwright extension (references/browser.md);
//   the session is attached on first use and the loop runs inside `playwright-cli run-code`, in calls of
//   SCRAPE_CHUNK_SECONDS (default 30) that each go on where the last one stopped, in the same tab.
//
// Writes rows.csv and rows.json (summary: stop reason, per-round counts, page text tail) as the run goes:
// both are rewritten after each read of the page (or each Chrome call), with stopReason "running" until the run
// ends. Files already at --out stay until the run has a row to write. A save that fails is retried later.
// SIGINT / SIGTERM (also a Ctrl-C that reached playwright-cli) write the rows so far with stopReason
// "interrupted" and exit non-zero.
// SCRAPE_CHUNK_STEPS / SCRAPE_CHUNK_SECONDS also split a bundled run into such calls (to test them).
import fs from 'node:fs'
import path from 'node:path'
import { gotoAndSettle, openBrowser, parseArgs, runSetup, settle, writeFileAtomic } from './lib/browser.mjs'
import { runInChrome } from './lib/chrome.mjs'
import { CHUNK_SOURCES, chunkCall, collectInChunks, runChunkHere } from './lib/chunks.mjs'
import { toCsv } from './lib/csv.mjs'
import { installDlk } from './lib/in-page.mjs'
import { collectOnPage } from './lib/collector.mjs'
import { summarizeCollect } from './lib/report-format.mjs'

const IN_PAGE = `(${installDlk})()`
const { positional, flags } = parseArgs(process.argv.slice(2))
if (!positional[0] || !flags.out) {
  console.error('usage: collect.mjs config.json --out rows.csv [--max-pages N] [--max-rows N] [--browser bundled|chrome] [--session NAME]')
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

/** The CSV and the summary for `result` (the end of the run, or the rows so far). → the summary. */
function writeOutput(result) {
  // Written next to the file, then renamed over it, so a reader never sees half of one.
  writeFileAtomic(out, toCsv(columns, result.rows))
  const summary = summarizeCollect(result, { browser: browserMode, seconds: Math.round((Date.now() - started) / 1000), out: path.resolve(out) })
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
/** Write the rows so far as "interrupted" and exit (Ctrl-C, a kill signal). */
function interrupt(signal) {
  if (stopping) return
  stopping = true
  clearTimeout(pendingSave)
  const result = { ...latest, stopReason: 'interrupted', note: `stopped by ${signal}; the CSV has the rows collected until then` }
  let summary
  try {
    summary = latest.rows.length || wrote
      ? writeOutput(result)
      : { ...summarizeCollect(result, { browser: browserMode, seconds: Math.round((Date.now() - started) / 1000), out: path.resolve(out) }), note: `stopped by ${signal} before any row was collected; nothing was written to ${out}` }
  } catch (error) {
    console.error(`could not write the rows so far to ${out}: ${error.message}`)
  }
  if (summary) console.log(JSON.stringify(summary, null, 2))
  process.exit(signal === 'SIGINT' ? 130 : 143)
}
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => interrupt(signal))
/** Let a signal that came while the event loop was blocked (a playwright-cli call) reach its handler. */
const yieldToSignals = () => new Promise(resolve => setImmediate(resolve))

let result
if (browserMode === 'chrome') {
  result = await runInUserChrome(flags.session ?? process.env.SCRAPE_SESSION ?? 'scrape')
} else {
  const { browser, context, page } = await openBrowser()
  await context.addInitScript({ content: IN_PAGE })
  const progress = now => saveProgress(now.rows, now.rounds, { lastUrl: page.url() })
  const lib = { settle, gotoAndSettle, runSetup, installDlk, onRows: progress, onRound: (_entry, now) => progress(now) }
  result = chunkSteps || chunkSeconds
    ? await collectInChunks(
        state => runChunkHere(page, config, lib, state, { steps: chunkSteps, ms: chunkSeconds * 1000 }),
        state => saveProgress(state.rows, state.rounds, { force: true, lastUrl: state.url })
      )
    : await collectOnPage(page, config, lib)
  await browser.close()
}

/** Ship the loop to the user's Chrome (lib/chrome.mjs) in calls of a bounded length; rows come back as JSON. */
function runInUserChrome(session) {
  const pauseAfter = { steps: chunkSteps, ms: (chunkSeconds || 30) * 1000 }
  return collectInChunks(
    async (state, n) => {
      // Later calls must run in the tab the first one used: never attach again half-way.
      const run = runInChrome(session, CHUNK_SOURCES, chunkCall(config, state, pauseAfter), { attach: n === 1 })
      // A Ctrl-C in the terminal reaches playwright-cli too, which then fails: that is the user stopping the run.
      await yieldToSignals()
      if (run.signal === 'SIGINT' || run.signal === 'SIGTERM') interrupt(run.signal)
      if (run.ok && (run.value?.paused || Array.isArray(run.value?.rows))) return run.value
      const kept = state ? ` (call ${n}; the rows of the calls before are kept)` : ''
      return { rows: state?.rows ?? [], rounds: state?.rounds ?? [], stopReason: 'error', note: `${run.error ?? 'no rows in run-code result'}${kept}`, tail: '', lastUrl: state?.url ?? '' }
    },
    state => saveProgress(state.rows, state.rounds, { force: true, lastUrl: state.url })
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
