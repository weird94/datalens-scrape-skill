// The browser-safety check (test-support/browser-safe.mjs) that detail-run.test.mjs and resume-at.test.mjs run on
// the modules the extension bundles: planted Node-only code in each form it can take must be caught.
// Run with `node --test scripts/browser-safe.test.mjs`.
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { after, test } from 'node:test'
import { browserSafetyProblems } from './test-support/browser-safe.mjs'

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'browser-safe-'))
after(() => fs.rmSync(dir, { recursive: true, force: true }))

/** An entry module that imports `dep.mjs` (relative), whose body is `body`: problems found from the entry. */
function problemsWith(body) {
  const sub = fs.mkdtempSync(path.join(dir, 'case-'))
  fs.writeFileSync(path.join(sub, 'entry.mjs'), "import { x } from './dep.mjs'\nexport const y = x\n")
  fs.writeFileSync(path.join(sub, 'dep.mjs'), `${body}\nexport const x = 1\n`)
  return browserSafetyProblems(path.join(sub, 'entry.mjs'))
}

test('clean relative modules pass, comments and prose that say "process" included', () => {
  assert.deepEqual(problemsWith('// runs in the host process. Another process may resume it\nconst note = "its process died"'), [])
})

for (const [what, body] of [
  ['a node: import', "import fs from 'node:fs'"],
  ['a bare built-in import', "import { join } from 'path'"],
  ['a side-effect import', "import 'node:fs'"],
  ['a side-effect import of a package', "import 'playwright'"],
  ['a third-party package', "import { chromium } from 'playwright'"],
  ['a re-export from a package', "export { chromium } from 'playwright'"],
  ['a dynamic import', "const load = () => import('node:fs')"],
  ['require()', "const fs = require('fs')"],
  ['the process global', 'const home = process.env.HOME'],
  ['process indexed', "const v = process['env']"],
  ['process with optional chaining', 'const argv = process?.argv'],
  ['the Buffer global', "const b = Buffer.from('x')"],
  ['__dirname', 'const here = __dirname'],
]) {
  test(`catches ${what}`, () => {
    const problems = problemsWith(body)
    assert.equal(problems.length, 1, `${body} → ${JSON.stringify(problems)}`)
    assert.match(problems[0], /dep\.mjs/, 'names the file')
  })
}
