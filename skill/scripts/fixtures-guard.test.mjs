// The end-to-end tests find the fixture server through SCRAPE_SKILL_REPO / SCRAPE_SKILL_SERVE (a copy of this
// skill inside another repo keeps the server elsewhere), and REQUIRE_FIXTURES=1 turns "not found, skipped" into a
// failure, so a wrong path cannot pass a test run silently. Run with `node --test scripts/fixtures-guard.test.mjs`.
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { after, describe, test } from 'node:test'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const SKILL = path.join(HERE, '..')
const E2E = ['collect-chunks.test.mjs', 'collect-resume.test.mjs', 'detail-pages.test.mjs']
const empty = fs.mkdtempSync(path.join(os.tmpdir(), 'no-fixtures-'))
after(() => fs.rmSync(empty, { recursive: true, force: true }))

/** `node --test <file>` with `env` added; → { code, out }. Killed after a minute (it would be running the real tests). */
function runTests(file, env) {
  const childEnv = { ...process.env, ...env }
  // Not a subtest of this run: its own reporter, its own exit code.
  delete childEnv.NODE_TEST_CONTEXT
  if (!('REQUIRE_FIXTURES' in env)) delete childEnv.REQUIRE_FIXTURES
  return new Promise(resolve => {
    // Its own process group, so a run that did find a server goes with everything it started.
    const child = spawn(process.execPath, ['--test', '--test-reporter=tap', path.join(HERE, file)], { cwd: SKILL, env: childEnv, detached: true })
    let out = ''
    child.stdout.on('data', d => (out += d))
    child.stderr.on('data', d => (out += d))
    const timer = setTimeout(() => {
      try {
        process.kill(-child.pid, 'SIGKILL')
      } catch {
        // already gone
      }
    }, 60_000)
    child.on('close', code => {
      clearTimeout(timer)
      resolve({ code, out })
    })
  })
}

describe('end-to-end tests without their fixture server', { concurrency: true }, () => {
  for (const file of E2E) {
    test(`${file}: skipped when it is not found (SCRAPE_SKILL_SERVE)`, async () => {
      const { code, out } = await runTests(file, { SCRAPE_SKILL_SERVE: 'eval/no-such-server.mts' })
      assert.equal(code, 0, out.slice(-2000))
      assert.match(out, /# SKIP fixture server not found/)
      assert.match(out, /no-such-server\.mts/)
    })
    test(`${file}: fails when it is required (REQUIRE_FIXTURES=1) and not found (SCRAPE_SKILL_REPO)`, async () => {
      const { code, out } = await runTests(file, { SCRAPE_SKILL_REPO: empty, REQUIRE_FIXTURES: '1' })
      assert.notEqual(code, 0, out.slice(-2000))
      assert.match(out, /REQUIRE_FIXTURES=1: fixture server not found/)
      assert.ok(out.includes(empty), 'names where it looked')
    })
  }
})
