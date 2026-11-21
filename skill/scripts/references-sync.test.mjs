// references/index.mjs is generated from references/*.md and SKILL.md (scripts/sync-references.mjs)
// so the backend can serve the same text. Fails when one was edited without regenerating.
//   node --test scripts/
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import test from 'node:test'
import { REFERENCES, SKILL_CONFIG } from '../references/index.mjs'

const root = path.join(path.dirname(new URL(import.meta.url).pathname), '..')
const fix = 'run `node scripts/sync-references.mjs`'

test('every reference note matches its .md file', () => {
  const dir = path.join(root, 'references')
  const files = fs.readdirSync(dir).filter(f => f.endsWith('.md'))
  assert.deepEqual(Object.keys(REFERENCES).sort(), files.map(f => f.replace(/\.md$/, '')).sort(), fix)
  for (const f of files) assert.equal(REFERENCES[f.replace(/\.md$/, '')], fs.readFileSync(path.join(dir, f), 'utf8'), `${f}: ${fix}`)
})

test('SKILL_CONFIG matches the config section of SKILL.md', () => {
  const skill = fs.readFileSync(path.join(root, 'SKILL.md'), 'utf8')
  const section = skill.slice(skill.indexOf('\n## Config\n') + 1, skill.indexOf('\n## Environment\n')).trim()
  assert.equal(SKILL_CONFIG, section, fix)
  assert.match(SKILL_CONFIG, /^## Config/)
  assert.match(SKILL_CONFIG, /## Stop reasons/)
})
