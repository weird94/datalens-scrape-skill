// Run page code in the user's own Chrome through the Playwright extension + playwright-cli.
// See references/browser.md for what the user installs. The CLI's run-code has no require/fs,
// so callers pass self-contained functions (as source) and get the JSON result back on stdout.
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const DEFAULT_CLI = 'npx -y @playwright/cli@latest'
const CHROME_PATHS = {
  darwin: ['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'],
  linux: ['/usr/bin/google-chrome', '/usr/bin/google-chrome-stable', '/opt/google/chrome/chrome'],
  win32: [process.env.PROGRAMFILES, process.env['PROGRAMFILES(X86)'], process.env.LOCALAPPDATA]
    .filter(Boolean)
    .map(base => path.join(base, 'Google', 'Chrome', 'Application', 'chrome.exe')),
}

function cliEnv() {
  const env = { ...process.env }
  // Without it the CLI scans Chrome's profile folder for the extension, which macOS privacy
  // protection can block ("Playwright Extension not found" although it is installed).
  if (!env.PLAYWRIGHT_MCP_EXECUTABLE_PATH) {
    const found = (CHROME_PATHS[process.platform] ?? []).find(p => fs.existsSync(p))
    if (found) env.PLAYWRIGHT_MCP_EXECUTABLE_PATH = found
  }
  return env
}

function cli(args, { timeout } = {}) {
  const parts = (process.env.PLAYWRIGHT_CLI ?? DEFAULT_CLI).split(' ').filter(Boolean)
  const run = spawnSync(parts[0], [...parts.slice(1), ...args], { encoding: 'utf8', env: cliEnv(), maxBuffer: 512 * 1024 * 1024, timeout })
  const stderr = (run.stderr ?? '').split('\n').filter(l => l && !/npm warn/i.test(l)).join('\n')
  return { status: run.status, stdout: (run.stdout ?? '').trim(), stderr, error: run.error, command: `${parts.join(' ')} ${args.join(' ')}` }
}

const short = text => text.split('\n').filter(Boolean).slice(0, 4).join(' ').slice(0, 500)

/** Attach the named session to the user's Chrome unless it is already open. */
export function ensureSession(session) {
  const list = cli(['list'], { timeout: 60_000 })
  if (new RegExp(`- ${session}:\\s*\\n\\s*- status: open`).test(list.stdout)) return { ok: true }
  // No token: the user has to approve the connection in Chrome, so give them time.
  const attach = cli([`-s=${session}`, 'attach', '--extension=chrome'], { timeout: 180_000 })
  if (attach.status === 0 && /attached|created/i.test(attach.stdout)) return { ok: true, attached: true }
  const detail = short(attach.stderr || attach.stdout || String(attach.error ?? ''))
  return { ok: false, error: `could not attach to the user's Chrome (${attach.command}): ${detail} — see references/browser.md` }
}

/**
 * Run `call` (an expression using `page`) in the session's tab, with `sources` (function
 * declarations as strings) in scope. Returns { ok, value } or { ok: false, error }.
 */
export function runInChrome(session, sources, call) {
  const ready = ensureSession(session)
  if (!ready.ok) return ready
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'scrape-')), 'run.js')
  fs.writeFileSync(file, `async page => {\n${sources.join('\n')}\nreturn JSON.stringify(await (${call}))\n}`)
  const run = cli([`-s=${session}`, '--raw', 'run-code', `--filename=${file}`])
  try {
    let value = JSON.parse(run.stdout)
    if (typeof value === 'string') value = JSON.parse(value)
    return { ok: true, value }
  } catch {
    return { ok: false, error: `run-code failed: ${short(run.stdout || run.stderr || String(run.error ?? ''))}` }
  } finally {
    fs.rmSync(path.dirname(file), { recursive: true, force: true })
  }
}
