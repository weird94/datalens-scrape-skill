#!/usr/bin/env node
// Generic list collector driven by a JSON config (see SKILL.md for the format).
//
//   node scripts/collect.mjs config.json --out rows.csv [--max-pages N] [--max-rows N]
//                                        [--browser bundled|chrome] [--session NAME]
//
// --browser bundled (default): a fresh headless browser started here.
// --browser chrome: the user's own Chrome through the Playwright extension (references/browser.md);
//   the session is attached on first use and the loop runs inside `playwright-cli run-code`.
//
// Writes rows.csv and rows.json (summary: stop reason, per-round counts, page text tail).
import fs from 'node:fs'
import path from 'node:path'
import { gotoAndSettle, openBrowser, parseArgs, runSetup, settle } from './lib/browser.mjs'
import { runInChrome } from './lib/chrome.mjs'
import { installDlk } from './lib/in-page.mjs'
import { collectOnPage } from './lib/collector.mjs'
import { rowIdentity } from './lib/row-identity.mjs'
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

const started = Date.now()
let result

if (browserMode === 'chrome') {
  result = runInUserChrome(flags.session ?? process.env.SCRAPE_SESSION ?? 'scrape')
} else {
  const { browser, context, page } = await openBrowser()
  await context.addInitScript({ content: IN_PAGE })
  result = await collectOnPage(page, config, { settle, gotoAndSettle, runSetup, installDlk })
  await browser.close()
}

/** Ship the loop to the user's Chrome (lib/chrome.mjs); rows come back as JSON. */
function runInUserChrome(session) {
  const run = runInChrome(
    session,
    [installDlk, settle, gotoAndSettle, runSetup, rowIdentity, collectOnPage].map(String),
    `collectOnPage(page, ${JSON.stringify(config)}, { settle, gotoAndSettle, runSetup, installDlk })`
  )
  if (run.ok && Array.isArray(run.value?.rows)) return run.value
  return { rows: [], rounds: [], stopReason: 'error', note: run.error ?? 'no rows in run-code result', tail: '', lastUrl: '' }
}

// ---------- output ----------
const { rows } = result
const columns = Object.keys(config.fields)
const esc = v => {
  const s = String(v ?? '')
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}
fs.mkdirSync(path.dirname(path.resolve(out)), { recursive: true })
fs.writeFileSync(out, '﻿' + [columns.join(','), ...rows.map(r => columns.map(c => esc(r[c])).join(','))].join('\n') + '\n')
const summary = summarizeCollect(result, { browser: browserMode, seconds: Math.round((Date.now() - started) / 1000), out: path.resolve(out) })
// Never overwrite the config: `cfg.json --out cfg.csv` would otherwise replace it with the summary.
let summaryPath = out.replace(/\.csv$/i, '') + '.json'
if (path.resolve(summaryPath) === path.resolve(positional[0])) summaryPath = out.replace(/\.csv$/i, '') + '.summary.json'
fs.writeFileSync(summaryPath, JSON.stringify(summary, null, 2))
console.log(JSON.stringify(summary, null, 2))
