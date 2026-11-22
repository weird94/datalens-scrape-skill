// references/index.mjs is generated from references/*.md and SKILL.md (scripts/sync-references.mjs)
// so the backend can serve the same text. Fails when one was edited without regenerating.
//   node --test scripts/
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import test from 'node:test'
import { REFERENCES, SKILL_CONFIG, SKILL_CONFIG_DETAIL } from '../references/index.mjs'

const root = path.join(path.dirname(new URL(import.meta.url).pathname), '..')
const fix = 'run `node scripts/sync-references.mjs`'

test('every reference note matches its .md file', () => {
  const dir = path.join(root, 'references')
  const files = fs.readdirSync(dir).filter(f => f.endsWith('.md'))
  assert.deepEqual(Object.keys(REFERENCES).sort(), files.map(f => f.replace(/\.md$/, '')).sort(), fix)
  for (const f of files) assert.equal(REFERENCES[f.replace(/\.md$/, '')], fs.readFileSync(path.join(dir, f), 'utf8'), `${f}: ${fix}`)
})

test('SKILL_CONFIG and SKILL_CONFIG_DETAIL are the config section of SKILL.md, its "### Detail pages" part apart', () => {
  const skill = fs.readFileSync(path.join(root, 'SKILL.md'), 'utf8')
  const section = skill.slice(skill.indexOf('\n## Config\n') + 1, skill.indexOf('\n## Environment\n')).trim()
  assert.match(SKILL_CONFIG, /^## Config/)
  assert.match(SKILL_CONFIG, /## Stop reasons/)
  // A host without detail pages gets the config grammar without them; one with them adds SKILL_CONFIG_DETAIL.
  assert.doesNotMatch(SKILL_CONFIG, /### Detail pages/)
  assert.doesNotMatch(SKILL_CONFIG, /detail\.mjs/)
  assert.match(SKILL_CONFIG_DETAIL, /^### Detail pages\n/)
  assert.doesNotMatch(SKILL_CONFIG_DETAIL, /\n## /, 'only the detail subsection')
  assert.ok(section.includes(`\n\n${SKILL_CONFIG_DETAIL}\n\n`), fix)
  assert.equal(section.replace(`${SKILL_CONFIG_DETAIL}\n\n`, ''), SKILL_CONFIG, fix)
})
