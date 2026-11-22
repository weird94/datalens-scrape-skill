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
  assert.equal(withoutCliOnlyStopReasons(section.replace(`${SKILL_CONFIG_DETAIL}\n\n`, '')), SKILL_CONFIG, fix)
})

// `running` and `interrupted` are list stop reasons only collect.mjs's own process writes (a summary saved mid-run,
// a signal). A host that runs the collector in-process never gets them, and their wording (Ctrl-C, SIGHUP) would
// mislead its agent, so SKILL_CONFIG leaves them out while SKILL.md keeps them for the CLI.
const CLI_ONLY = /\u00b7 `(?:running|interrupted)`/

function withoutCliOnlyStopReasons(text) {
  return text.replace(/ \u00b7 `running` \([^()]*\)/, '').replace(/ \u00b7 `interrupted` \([^()]*\)/, '')
}

test('SKILL.md lists the CLI-only stop reasons; SKILL_CONFIG does not', () => {
  const skill = fs.readFileSync(path.join(root, 'SKILL.md'), 'utf8')
  const stopReasons = skill.slice(skill.indexOf('\n## Stop reasons\n'), skill.indexOf('\n## Environment\n'))
  assert.match(stopReasons, CLI_ONLY, 'the CLI still documents them')
  assert.doesNotMatch(SKILL_CONFIG, CLI_ONLY)
  assert.doesNotMatch(SKILL_CONFIG, /Ctrl-C|SIGTERM|SIGHUP/)
})

test('SKILL_CONFIG is the text hosts already serve (test-support/skill-config.snapshot.txt)', () => {
  // The extension's sidebar prompt carries SKILL_CONFIG; with detail pages off it must stay the text it had before
  // them (the monorepo's packages/scrape-skill at 6beb8db). A change here changes that prompt: when it is meant,
  // update the snapshot in the same commit so the change is reviewed, and the backend's prompt test with it.
  const snapshot = fs.readFileSync(path.join(root, 'scripts/test-support/skill-config.snapshot.txt'), 'utf8')
  assert.equal(`${SKILL_CONFIG}\n`, snapshot)
})
