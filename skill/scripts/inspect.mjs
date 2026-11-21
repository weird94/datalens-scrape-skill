#!/usr/bin/env node
// Look at a page without reading its whole HTML.
//
//   node scripts/inspect.mjs <url> [--wait ms] [--setup steps.json|'[...]'] [--click css]...
//                                  [--scroll] [--probe css]... [--html css] [--find text]... [--tree css]... [--text]
//                                  [--browser bundled|chrome] [--session NAME]
//
// Prints: whether the page is a block / login wall, candidate lists (repeated structures),
// pagination-like controls, scroll containers, overlays, and the result of each --probe (count +
// first/last texts). --html prints one element's markup so you can write field selectors. --find lists
// the elements showing a text. The overview includes TREE, the page as an indented tree with closed parts;
// --tree prints one element (a selector or a ref from TREE) as a tree. With --probe / --html / --find /
// --tree only those answers and the top lists print.
// --setup runs the same steps as the collector's `setup` (a JSON file, a config with a `setup`
// key, or inline JSON). --click runs in order before reporting, so `--click "a.next" --probe
// "<rows>"` shows page 2. --browser chrome looks through the user's own Chrome (references/browser.md).
import fs from 'node:fs'
import path from 'node:path'
import { asList, gotoAndSettle, openBrowser, parseArgs, readSteps, runSetup, settle } from './lib/browser.mjs'
import { runInChrome } from './lib/chrome.mjs'
import { installDlk } from './lib/in-page.mjs'
import { inspectOnPage } from './lib/inspector.mjs'
import { formatInspectReport } from './lib/report-format.mjs'

const IN_PAGE = `(${installDlk})()`
const { positional, flags } = parseArgs(process.argv.slice(2), ['scroll', 'text', 'json'])
const url = positional[0]
if (!url) {
  console.error("usage: inspect.mjs <url> [--wait ms] [--setup steps.json|'[...]'] [--click css]... [--scroll] [--probe css]... [--html css] [--find text]... [--tree css]... [--text] [--browser bundled|chrome] [--session NAME]")
  process.exit(2)
}
const opts = {
  url,
  wait: Number(flags.wait ?? 0),
  setup: flags.setup ? readSteps(flags.setup) : [],
  clicks: asList(flags.click),
  scroll: !!flags.scroll,
  probes: asList(flags.probe),
  html: asList(flags.html),
  find: asList(flags.find),
  tree: asList(flags.tree),
  text: !!flags.text,
}
const browserMode = flags.browser ?? process.env.SCRAPE_BROWSER ?? 'bundled'

let report
if (browserMode === 'chrome') {
  const run = runInChrome(
    flags.session ?? process.env.SCRAPE_SESSION ?? 'scrape',
    [installDlk, settle, gotoAndSettle, runSetup, inspectOnPage].map(String),
    `inspectOnPage(page, ${JSON.stringify(opts)}, { settle, gotoAndSettle, runSetup, installDlk })`
  )
  report = run.ok ? run.value : { url, error: run.error }
} else {
  const { browser, context, page } = await openBrowser()
  await context.addInitScript({ content: IN_PAGE })
  report = await inspectOnPage(page, opts, { settle, gotoAndSettle, runSetup, installDlk })
  await browser.close()
}
report.browser = browserMode

if (flags.json) {
  console.log(JSON.stringify(report, null, 2))
  process.exit(0)
}

console.log(formatInspectReport(report))
