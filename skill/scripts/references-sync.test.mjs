// references/index.mjs is generated from references/*.md and SKILL.md (scripts/sync-references.mjs)
// so the backend can serve the same text. Fails when one was edited without regenerating.
//   node --test scripts/
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import test from 'node:test'
import { REFERENCES, REFERENCES_HOST, SKILL_CONFIG, SKILL_CONFIG_DETAIL, SKILL_CONFIG_DETAIL_HOST } from '../references/index.mjs'

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

// A host that runs the collector in-process (the extension's side panel) has no `--resume` command: going on after a
// stop is the CLI's. REFERENCES_HOST is the notes such a host serves, with that part of stop-signals left out.
const RESUME_CELL = ', or go on: `--resume` with a higher limit'
const RESUME_SECTION = '## Going on after a stop: `--resume`\n'

test('REFERENCES_HOST is REFERENCES without the CLI-only --resume part of stop-signals', () => {
  assert.deepEqual(Object.keys(REFERENCES_HOST).sort(), Object.keys(REFERENCES).sort(), fix)
  // detail-pages has a host wording of its own (below); every other note but stop-signals is served as written.
  for (const name of Object.keys(REFERENCES)) if (name !== 'stop-signals' && name !== 'detail-pages') assert.equal(REFERENCES_HOST[name], REFERENCES[name], `${name}: ${fix}`)
  const cli = REFERENCES['stop-signals']
  const host = REFERENCES_HOST['stop-signals']
  // The CLI's note still tells it how to go on.
  assert.ok(cli.includes(RESUME_CELL), 'stop-signals.md: the max-pages / max-rows row offers --resume')
  assert.ok(cli.includes(RESUME_SECTION), 'stop-signals.md has the --resume section')
  assert.doesNotMatch(host, /--resume|resumedFrom|--out\b|same command/)
  assert.match(host, /\| `max-pages` \/ `max-rows` \| your limit, and the next control was still there \| tell the user there's more \|/)
  // Only that: the section is cut up to the next one, the rest of the note is as written.
  const section = cli.slice(cli.indexOf(RESUME_SECTION), cli.indexOf('\n## ', cli.indexOf(RESUME_SECTION)) + 1)
  assert.equal(host, cli.replace(RESUME_CELL, '').replace(section, ''), fix)
  assert.match(host, /\n## `aiStop`: when a second look decided\n/)
})

// A host that runs the detail pass in-process (the extension's side panel) has no detail.mjs, no --out file, no
// signals and no --browser switch, and keeps its results as tables of one saved result, not CSV files. Its agent reads
// REFERENCES_HOST['detail-pages'] and SKILL_CONFIG_DETAIL_HOST: the same rules about what to read and how, with the
// command-line parts left out or said without them. The CLI keeps SKILL.md and the .md files as written.
const CLI_WORDS = ['.mjs', 'Ctrl-C', 'SIGTERM', 'SIGHUP', 'same command', 'CSV', '.csv', '.jsonl', 'detail.json', 'full.json', '<out>', 'browser.md', 'references/', 'bundled', 'delayMs', 'concurrency']
// The rules a host's agent needs as much as the CLI's: each one must survive the rewording.
const KEPT_RULES = ['root', 'fields', 'require', 'expand', 'setup', 'children', 'matches', 'child_index', 'See all', 'select', 'iframe', 'waitFor', 'expandPasses', 'maxAttempts', 'deadLinks', 'fillRate', 'no-data', 'detail_status_2', 'children_count', 'scrollTo']
// A command-line flag (--out, --html …); a Markdown table's |---| is not one.
const FLAG = /--[a-z]/

test('REFERENCES_HOST["detail-pages"] keeps the rules and drops the command line', () => {
  const cli = REFERENCES['detail-pages']
  const host = REFERENCES_HOST['detail-pages']
  assert.ok(host, fix)
  for (const word of CLI_WORDS) assert.ok(!host.includes(word), `host detail-pages note contains ${JSON.stringify(word)}`)
  assert.doesNotMatch(host, FLAG)
  for (const rule of KEPT_RULES) assert.ok(host.includes(rule), `host detail-pages note lost ${JSON.stringify(rule)}`)
  // The CLI's note is the .md as written.
  assert.match(cli, /detail\.mjs/)
  assert.match(cli, /--browser chrome/)
  // Same sections, in the same order.
  const headings = text => text.split('\n').filter(line => line.startsWith('#'))
  assert.deepEqual(headings(host).length, headings(cli).length)
  assert.match(host, /^# Detail pages\n/)
  assert.match(host, /\n## Child lists\n/)
  assert.match(host, /\n## Things to report\n/)
})

test('SKILL_CONFIG_DETAIL_HOST is the detail grammar without the command line', () => {
  assert.ok(SKILL_CONFIG_DETAIL_HOST, fix)
  assert.match(SKILL_CONFIG_DETAIL_HOST, /^### Detail pages\n/)
  for (const word of CLI_WORDS) assert.ok(!SKILL_CONFIG_DETAIL_HOST.includes(word), `SKILL_CONFIG_DETAIL_HOST contains ${JSON.stringify(word)}`)
  assert.doesNotMatch(SKILL_CONFIG_DETAIL_HOST, FLAG)
  assert.doesNotMatch(SKILL_CONFIG_DETAIL_HOST, /interrupted/)
  for (const key of ['`link`', '`fields`', '`root`', '`require`', '`waitFor` / `waitTimeoutMs`', '`setup` / `expand` / `dismiss`', '`children`', '`maxAttempts`', 'detail_status', 'children_count', 'child_index', '`tab-not-rendering`', '`no-data`', '`blocked`', '`max-rows`'])
    assert.ok(SKILL_CONFIG_DETAIL_HOST.includes(key), `SKILL_CONFIG_DETAIL_HOST lost ${key}`)
  // The CLI grammar keeps its command line.
  assert.match(SKILL_CONFIG_DETAIL, /scripts\/detail\.mjs/)
  assert.match(SKILL_CONFIG_DETAIL, /`interrupted` \(Ctrl-C/)
})
