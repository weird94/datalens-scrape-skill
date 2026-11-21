// Run page code in the user's own Chrome through the Playwright extension + playwright-cli.
// See references/browser.md for what the user installs. The CLI's run-code has no require/fs,
// so callers pass self-contained functions (as source) and get the JSON result back on stdout.
import { spawn, spawnSync } from 'node:child_process'
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

const cliParts = () => (process.env.PLAYWRIGHT_CLI ?? DEFAULT_CLI).split(' ').filter(Boolean)
const cleanStderr = text => (text ?? '').split('\n').filter(l => l && !/npm warn/i.test(l)).join('\n')

function cli(args, { timeout } = {}) {
  const parts = cliParts()
  const run = spawnSync(parts[0], [...parts.slice(1), ...args], { encoding: 'utf8', env: cliEnv(), maxBuffer: 512 * 1024 * 1024, timeout })
  return { status: run.status, signal: run.signal, stdout: (run.stdout ?? '').trim(), stderr: cleanStderr(run.stderr), error: run.error, command: `${parts.join(' ')} ${args.join(' ')}` }
}

/**
 * cli() without blocking the event loop, so the caller's signal handlers run while it waits. `signal` (an
 * AbortSignal) kills the call. → the same shape as cli(), `signal` naming what ended the process, if anything.
 */
function cliAsync(args, { timeout, signal } = {}) {
  const parts = cliParts()
  const command = `${parts.join(' ')} ${args.join(' ')}`
  return new Promise(resolve => {
    if (signal?.aborted) return resolve({ status: null, signal: 'SIGTERM', stdout: '', stderr: '', error: new Error('aborted'), command })
    const child = spawn(parts[0], [...parts.slice(1), ...args], { env: cliEnv(), stdio: ['ignore', 'pipe', 'pipe'] })
    let stdout = ''
    let stderr = ''
    let error
    child.stdout.on('data', d => (stdout += d))
    child.stderr.on('data', d => (stderr += d))
    child.on('error', e => (error = e))
    const kill = () => child.kill('SIGTERM')
    signal?.addEventListener('abort', kill, { once: true })
    const timer = timeout ? setTimeout(kill, timeout) : null
    child.on('close', (status, killedBy) => {
      if (timer) clearTimeout(timer)
      signal?.removeEventListener('abort', kill)
      resolve({ status, signal: killedBy, stdout: stdout.trim(), stderr: cleanStderr(stderr), error, command })
    })
  })
}

const short = text => text.split('\n').filter(Boolean).slice(0, 4).join(' ').slice(0, 500)
const isOpen = (session, list) => new RegExp(`- ${session}:\\s*\\n\\s*- status: open`).test(list.stdout)
// No token: the user has to approve the connection in Chrome, so give them time.
const attachArgs = session => [`-s=${session}`, 'attach', '--extension=chrome']
const ATTACH_TIMEOUT_MS = 180_000
function attachOutcome(attach) {
  if (attach.status === 0 && /attached|created/i.test(attach.stdout)) return { ok: true, attached: true }
  const detail = short(attach.stderr || attach.stdout || String(attach.error ?? ''))
  return { ok: false, error: `could not attach to the user's Chrome (${attach.command}): ${detail} — see references/browser.md`, ...(attach.signal ? { signal: attach.signal } : {}) }
}

/** Attach the named session to the user's Chrome unless it is already open. */
export function ensureSession(session) {
  if (isOpen(session, cli(['list'], { timeout: 60_000 }))) return { ok: true }
  return attachOutcome(cli(attachArgs(session), { timeout: ATTACH_TIMEOUT_MS }))
}

/** ensureSession without blocking the event loop; `signal` aborts it. */
export async function ensureSessionAsync(session, { signal } = {}) {
  if (isOpen(session, await cliAsync(['list'], { timeout: 60_000, signal }))) return { ok: true }
  return attachOutcome(await cliAsync(attachArgs(session), { timeout: ATTACH_TIMEOUT_MS, signal }))
}

/** The function `run-code` gets: `sources` in scope, `call` awaited, its result as JSON. */
export function runCodeSource(sources, call) {
  return `async page => {\n${sources.join('\n')}\nreturn JSON.stringify(await (${call}))\n}`
}

function writeProgram(sources, call) {
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'scrape-')), 'run.js')
  fs.writeFileSync(file, runCodeSource(sources, call))
  return file
}
const runArgs = (session, file) => [`-s=${session}`, '--raw', 'run-code', `--filename=${file}`]
function runOutcome(run) {
  try {
    let value = JSON.parse(run.stdout)
    if (typeof value === 'string') value = JSON.parse(value)
    return { ok: true, value }
  } catch {
    return { ok: false, error: `run-code failed: ${short(run.stdout || run.stderr || String(run.error ?? ''))}`, ...(run.signal ? { signal: run.signal } : {}) }
  }
}

/**
 * Run `call` (an expression using `page`) in the session's tab, with `sources` (function
 * declarations as strings) in scope. Returns { ok, value } or { ok: false, error, signal } (`signal`: the one that
 * ended the CLI, e.g. SIGINT when a Ctrl-C reached it).
 * `attach: false` skips attaching the session (a later call of a run: it must stay in the same tab).
 */
export function runInChrome(session, sources, call, { attach = true } = {}) {
  if (attach) {
    const ready = ensureSession(session)
    if (!ready.ok) return ready
  }
  const file = writeProgram(sources, call)
  try {
    return runOutcome(cli(runArgs(session, file)))
  } finally {
    fs.rmSync(path.dirname(file), { recursive: true, force: true })
  }
}

/**
 * runInChrome without blocking the event loop (the caller's SIGINT handler runs during the call); `signal`
 * (an AbortSignal) kills the call. A failure says which signal ended the CLI, if one did ({ signal }).
 */
export async function runInChromeAsync(session, sources, call, { signal } = {}) {
  const ready = await ensureSessionAsync(session, { signal })
  if (!ready.ok) return ready
  const file = writeProgram(sources, call)
  try {
    return runOutcome(await cliAsync(runArgs(session, file), { signal }))
  } finally {
    fs.rmSync(path.dirname(file), { recursive: true, force: true })
  }
}
