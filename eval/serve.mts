/**
 * Serve the playground mock pages without the Next dev server: map
 * /dev-fixtures/playground/<name>[/<page>] to the route.ts handler and call its GET directly.
 */
import fs from 'node:fs'
import http from 'node:http'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { NextRequest } from './playground/fixtures/_lib/next-shim.ts'

// This file lives in eval/; the mock pages are in eval/playground/fixtures/.
const HERE = path.dirname(fileURLToPath(import.meta.url))
const FIXTURES = path.join(HERE, 'playground/fixtures')
const PORT = Number(process.env.PORT ?? 3031)
const ALIASES = JSON.parse(fs.readFileSync(new URL("./aliases.json", import.meta.url), "utf8")) as Record<string, { url: string }>

type Handler = (req: unknown, ctx?: { params: Promise<Record<string, string>> }) => Promise<Response> | Response

const cache = new Map<string, Handler>()
async function load(file: string): Promise<Handler> {
  let h = cache.get(file)
  if (!h) {
    const mod = (await import(pathToFileURL(file).href)) as { GET: Handler }
    h = mod.GET
    cache.set(file, h)
  }
  return h
}

function resolve(segments: string[]): { file: string; params?: Record<string, string> } | null {
  const [name, ...rest] = segments
  if (!name) return null
  const dir = path.join(FIXTURES, name)
  if (rest.length === 0 && fs.existsSync(path.join(dir, 'route.ts'))) return { file: path.join(dir, 'route.ts') }
  if (rest.length === 1 && fs.existsSync(dir)) {
    const dyn = fs.readdirSync(dir).find(entry => /^\[.+\]$/.test(entry))
    if (dyn) return { file: path.join(dir, dyn, 'route.ts'), params: { [dyn.slice(1, -1)]: rest[0] } }
  }
  return null
}


http
  .createServer(async (req, res) => {
    let url = new URL(req.url ?? "/", `http://localhost:${PORT}`)
    const alias = url.pathname.match(/^\/t\/([0-9a-f]+)$/)
    if (alias && ALIASES[alias[1]]) {
      // A page's own relative links ("?view=library") land on the short link again: its query wins over the alias's.
      const own = url.searchParams
      url = new URL(ALIASES[alias[1]].url, `http://localhost:${PORT}`)
      for (const [key, value] of own) url.searchParams.set(key, value)
    }
    const prefix = '/dev-fixtures/playground/'
    if (!url.pathname.startsWith(prefix)) {
      res.writeHead(404).end('not a playground path')
      return
    }
    const target = resolve(url.pathname.slice(prefix.length).split('/').filter(Boolean))
    if (!target) {
      res.writeHead(404).end('no route')
      return
    }
    try {
      const handler = await load(target.file)
      const response = await handler(new NextRequest(url.href), target.params ? { params: Promise.resolve(target.params) } : undefined)
      const headers: Record<string, string> = {}
      response.headers.forEach((value, key) => {
        headers[key] = value
      })
      res.writeHead(response.status, headers).end(await response.text())
    } catch (error) {
      res.writeHead(500).end(String(error instanceof Error ? error.stack : error))
    }
  })
  .listen(PORT, () => console.log(`fixtures on http://localhost:${PORT}`))
