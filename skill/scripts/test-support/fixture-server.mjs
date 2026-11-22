// The playground's mock pages (eval/serve.mts) on a free port, for tests that run collect.mjs end to end.
// `requests` lists every path (with its query) the server was asked for, in order.
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import net from 'node:net'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright'

const HERE = path.dirname(fileURLToPath(import.meta.url))
export const REPO = path.resolve(HERE, '../../..')
const SERVE = path.join(REPO, 'eval/serve.mts')
const TSX = path.join(REPO, 'node_modules/.bin/tsx')
export const haveFixtures = fs.existsSync(SERVE) && fs.existsSync(TSX)

/** → { base (…/dev-fixtures/playground), requests, stop() } */
export async function startFixtureServer() {
  // Its own process group, so the whole tree (tsx starts a second node) goes when the tests end.
  const server = spawn(TSX, [SERVE], { cwd: REPO, env: { ...process.env, PORT: '0', LOG_REQUESTS: '1' }, detached: true, stdio: ['ignore', 'pipe', 'inherit'] })
  const requests = []
  let text = ''
  const base = await new Promise((resolve, reject) => {
    server.stdout.on('data', chunk => {
      text += chunk
      const lines = text.split('\n')
      text = lines.pop()
      for (const line of lines) {
        const found = line.match(/fixtures on (http:\/\/localhost:\d+)/)
        if (found) resolve(`${found[1]}/dev-fixtures/playground`)
        const request = line.match(/^request (\S+)/)
        if (request) requests.push(request[1])
      }
    })
    server.on('exit', code => reject(new Error(`fixture server exited (${code})`)))
  })
  const stop = () => {
    try {
      process.kill(-server.pid)
    } catch {
      // already gone
    }
  }
  return { base, requests, stop }
}

const freePort = () =>
  new Promise(resolve => {
    const srv = net.createServer().listen(0, () => {
      const { port } = srv.address()
      srv.close(() => resolve(port))
    })
  })

/**
 * A stand-in for playwright-cli that runs each run-code file against the first tab of a Chromium it reaches
 * over CDP, so the tab and what the page keeps last from one call to the next (and from one collect.mjs
 * process to the next), as in the user's Chrome. → { command (for PLAYWRIGHT_CLI), close() }
 */
export async function standInCli() {
  const port = await freePort()
  const chrome = await chromium.launch({ args: [`--remote-debugging-port=${port}`] })
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'scrape-cli-'))
  const file = path.join(dir, 'playwright-cli.mjs')
  fs.writeFileSync(
    file,
    `import fs from 'node:fs'
import { chromium } from ${JSON.stringify(import.meta.resolve('playwright'))}
const args = process.argv.slice(2)
if (args.includes('list')) {
  console.log('- scrape:\\n  - status: open')
  process.exit(0)
}
const code = fs.readFileSync(args.find(a => a.startsWith('--filename=')).slice('--filename='.length), 'utf8')
const browser = await chromium.connectOverCDP('http://127.0.0.1:${port}')
const context = browser.contexts()[0]
const page = context.pages()[0] ?? (await context.newPage())
console.log(await (0, eval)(code)(page))
process.exit(0)
`
  )
  return {
    command: `${process.execPath} ${file}`,
    close: async () => {
      await chrome.close()
      fs.rmSync(dir, { recursive: true, force: true })
    },
  }
}
