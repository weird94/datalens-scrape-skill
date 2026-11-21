// Node-side helpers for the CLI scripts: load Playwright, open a browser, parse arguments.
// Page-only helpers (settle, gotoAndSettle, runSetup) live in page-helpers.mjs and are re-exported here.
export { gotoAndSettle, runSetup, settle } from './page-helpers.mjs'
import fs from 'node:fs'
import { createRequire } from 'node:module'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

export function loadPlaywright() {
  const bases = [import.meta.url]
  if (process.env.PLAYWRIGHT_FROM) bases.push(pathToFileURL(path.join(process.env.PLAYWRIGHT_FROM, 'package.json')).href)
  for (const base of bases) {
    try {
      return createRequire(base)('playwright')
    } catch {
      // try the next location
    }
  }
  throw new Error(
    'Playwright is not installed. Run `npm install` in the skill folder (or set PLAYWRIGHT_FROM to a folder whose node_modules has playwright).'
  )
}

export async function openBrowser({ headless = process.env.HEADFUL ? false : true } = {}) {
  const { chromium } = loadPlaywright()
  const browser = await chromium.launch({ headless })
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 }, ...(process.env.SCRAPE_LOCALE ? { locale: process.env.SCRAPE_LOCALE } : {}) })
  const page = await context.newPage()
  return { browser, context, page }
}

/** Setup steps from a CLI value: inline JSON array/object, or a path to a JSON file. */
export function readSteps(value) {
  if (!value) return []
  const text = /^\s*[[{]/.test(value) ? value : fs.readFileSync(value, 'utf8')
  const parsed = JSON.parse(text)
  return Array.isArray(parsed) ? parsed : parsed.setup ?? [parsed]
}

/** Tiny argv parser: positional args + --flag value (repeatable) + --switch. */
export function parseArgs(argv, switches = []) {
  const positional = []
  const flags = {}
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]
    if (!arg.startsWith('--')) {
      positional.push(arg)
      continue
    }
    const name = arg.slice(2)
    if (switches.includes(name)) {
      flags[name] = true
      continue
    }
    const value = argv[i + 1]
    i += 1
    if (flags[name] === undefined) flags[name] = value
    else flags[name] = [].concat(flags[name], value)
  }
  return { positional, flags }
}

export const asList = value => (value === undefined ? [] : [].concat(value))
