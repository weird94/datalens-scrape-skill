#!/usr/bin/env node
// A stand-in for `playwright-cli` in tests of `--browser chrome` (set PLAYWRIGHT_CLI="node <this file>").
// `list` reports every session as open; `run-code --filename=F` evaluates F's function against a page of a
// bundled Chromium and prints the result as `--raw` does. FAKE_CLI_HIDDEN=1 makes the tab never draw a
// frame (requestAnimationFrame never fires), like a minimized Chrome window.
import fs from 'node:fs'
import { chromium } from 'playwright'

const args = process.argv.slice(2)
if (args.includes('list')) {
  const session = (args.find(a => a.startsWith('-s=')) ?? '-s=scrape').slice(3)
  console.log(`### Browsers\n- ${session}:\n  - status: open`)
  process.exit(0)
}
const file = args.find(a => a.startsWith('--filename='))?.slice('--filename='.length)
if (!args.includes('run-code') || !file) {
  console.error(`fake-playwright-cli: unsupported call: ${args.join(' ')}`)
  process.exit(1)
}
const fn = new Function(`return (${fs.readFileSync(file, 'utf8')})`)()
const browser = await chromium.launch()
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } })
  if (process.env.FAKE_CLI_HIDDEN === '1') await page.addInitScript(() => (window.requestAnimationFrame = () => 0))
  const result = await fn(page)
  console.log(JSON.stringify(result))
} catch (error) {
  console.log(`### Error\n${error.message}`)
} finally {
  await browser.close()
}
