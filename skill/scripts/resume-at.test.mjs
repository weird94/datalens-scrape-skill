// planResumeAt (lib/resume-at.mjs): where a list run that stopped goes on from, without node: imports, so the
// extension can resume a run from its own checkpoint the way `collect.mjs --resume` does from the saved files.
// Run with `node --test scripts/resume-at.test.mjs`.
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { describe, test } from 'node:test'
import { fileURLToPath } from 'node:url'
import * as engine from './lib/index.mjs'
import { configKey, resumePlan } from './lib/resume.mjs'
import { END_OF_LIST, fromStartNote, planResumeAt, urlPage } from './lib/resume-at.mjs'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const byUrl = { url: 'https://example.com/list?page=1', rows: 'li', fields: { a: '.a' }, next: { type: 'url', url: 'https://example.com/list?page={page}', start: 2 } }
const byClick = { url: 'https://example.com/list', rows: 'li', fields: { a: '.a' }, next: { type: 'click', selector: 'a.next' } }
const byScroll = { url: 'https://example.com/feed', rows: 'li', fields: { a: '.a' } }
const position = (over = {}) => ({ pages: 3, turn: 2, url: 'https://example.com/list?page=3', rows: 30, keys: ['k1', 'k2'], urlPerPage: true, ...over })
const carry = { rounds: [{ round: 1 }, { round: 2 }, { round: 3 }], claimed: [{ text: '120 results', n: 120 }], mergedByLink: 1, mergedSameRecord: 0 }

/** Every module `file` imports, itself included (relative imports only, followed). */
function importClosure(file, seen = new Set()) {
  if (seen.has(file)) return seen
  seen.add(file)
  const text = fs.readFileSync(file, 'utf8')
  for (const [, spec] of text.matchAll(/^\s*(?:import|export)\b[^'"]*?from\s+['"]([^'"]+)['"]/gm)) {
    if (spec.startsWith('.')) importClosure(path.resolve(path.dirname(file), spec), seen)
    else seen.add(spec)
  }
  return seen
}

test('resume-at.mjs imports nothing from node: and the engine index exports planResumeAt', () => {
  const imports = [...importClosure(path.join(HERE, 'lib/resume-at.mjs'))].filter(s => !s.startsWith('/'))
  assert.deepEqual(imports, [])
  assert.equal(engine.planResumeAt, planResumeAt)
})

describe('planResumeAt', () => {
  test('pages by URL: go on at the template page after the last one read, with the position and what the run carried', () => {
    const plan = planResumeAt({ config: byUrl, position: position(), stopReason: 'running', rowCount: 30, carry })
    assert.deepEqual(plan, {
      how: 'continued',
      at: 'https://example.com/list?page=4',
      resumeAt: { how: 'continued', pages: 3, turn: 2, url: 'https://example.com/list?page=3', rows: 30, keys: ['k1', 'k2'], ...carry },
    })
    assert.equal(urlPage(byUrl, 3), plan.at)
  })

  test('a click list whose pages had URLs of their own: on the last page read; without: from the top', () => {
    const click = planResumeAt({ config: byClick, position: position({ url: 'https://example.com/list/3' }), stopReason: 'interrupted', rowCount: 30, carry })
    assert.equal(click.how, 'continued')
    assert.equal(click.at, 'https://example.com/list/3')
    assert.equal(click.resumeAt.url, 'https://example.com/list/3')
    const inPlace = planResumeAt({ config: byClick, position: position({ urlPerPage: false }), stopReason: 'interrupted', rowCount: 30, carry })
    assert.deepEqual(inPlace, { how: 'from-start', note: fromStartNote(byClick, 3), resumeAt: { how: 'from-start', ...carry } })
    assert.match(inPlace.note, /pages have no URL of their own/)
    const firstPage = planResumeAt({ config: byClick, position: position({ pages: 1 }), stopReason: 'interrupted', rowCount: 10, carry })
    assert.equal(firstPage.how, 'from-start')
    assert.match(firstPage.note, /had not turned a page yet/)
  })

  test('scrolling and load-more lists start from the top with the rows kept', () => {
    const scroll = planResumeAt({ config: byScroll, position: position({ url: byScroll.url }), stopReason: 'running', rowCount: 30, carry: {} })
    assert.deepEqual(scroll, { how: 'from-start', note: fromStartNote(byScroll, 3), resumeAt: { how: 'from-start' } })
    assert.match(scroll.note, /a scrolling list cannot be entered half-way/)
    const more = planResumeAt({ config: { ...byScroll, next: { type: 'load-more', selector: 'button' } }, position: position(), stopReason: 'running', rowCount: 30 })
    assert.match(more.note, /a load-more list cannot be entered half-way/)
  })

  test('no position yet (stopped before the first page ended): from the top', () => {
    const plan = planResumeAt({ config: byUrl, position: null, stopReason: 'interrupted', rowCount: 0 })
    assert.equal(plan.how, 'from-start')
  })

  test('a run that reached the end of the list is done, unless it ended on a wall', () => {
    for (const stopReason of END_OF_LIST) {
      const plan = planResumeAt({ config: byUrl, position: position(), stopReason, rowCount: 30 })
      assert.equal(plan.reason, 'end-of-list', stopReason)
      assert.equal(plan.done, `the saved run already reached the end of the list (stopReason ${stopReason})`)
    }
    const wall = { kind: 'login', evidence: 'login form', signals: { challenge: false, text: null, login: 'Sign in' } }
    assert.equal(planResumeAt({ config: byUrl, position: position(), stopReason: 'no-new-rows', wall, rowCount: 30 }).how, 'continued')
  })

  test('a URL page past the last one (HTTP 404, nothing else) is the end even though the collector called it a wall', () => {
    const wall = { kind: 'blocked', evidence: 'HTTP 404', signals: { challenge: false, text: null, login: null } }
    const past = planResumeAt({ config: byUrl, position: position(), stopReason: 'url-page-empty', wall, note: 'url-page-empty: page 4 had no rows', rowCount: 30 })
    assert.equal(past.reason, 'end-of-list')
    const blocked = planResumeAt({ config: byUrl, position: position(), stopReason: 'url-page-empty', wall: { ...wall, signals: { ...wall.signals, challenge: true } }, note: 'url-page-empty: page 4', rowCount: 30 })
    assert.equal(blocked.how, 'continued')
  })

  test('stopped at a limit the next run has too: done; a higher limit goes on', () => {
    const pages = planResumeAt({ config: { ...byUrl, maxPages: 3 }, position: position(), stopReason: 'max-pages', rowCount: 30 })
    assert.deepEqual(pages, { done: 'the saved run already read 3 pages, and maxPages is 3', reason: 'max-pages' })
    assert.equal(planResumeAt({ config: { ...byUrl, maxPages: 5 }, position: position(), stopReason: 'max-pages', rowCount: 30 }).how, 'continued')
    const rows = planResumeAt({ config: { ...byUrl, maxRows: 30 }, position: position(), stopReason: 'max-rows', rowCount: 30 })
    assert.deepEqual(rows, { done: 'the saved run already has 30 rows, and maxRows is 30', reason: 'max-rows' })
    assert.equal(planResumeAt({ config: { ...byUrl, maxRows: 60 }, position: position(), stopReason: 'max-rows', rowCount: 30 }).how, 'continued')
  })
})

describe('resumePlan (collect.mjs --resume) says what it said before planResumeAt', () => {
  const saved = (over = {}) => ({ rows: 2, stopReason: 'running', roundLog: [{ round: 1 }], claimedTotals: [], resume: { config: configKey(byUrl), pages: 1, turn: 0, url: byUrl.url, keys: ['k'] }, ...over })
  const csv = '﻿a\nx\ny\n'

  test('the done messages', () => {
    assert.deepEqual(resumePlan({ config: byUrl, summary: saved({ stopReason: 'scroll-end' }), csvText: csv }), {
      done: true,
      message: '--resume: the saved run already reached the end of the list (stopReason scroll-end); nothing to resume, the files are left as they are. To collect the list again, run without --resume.',
    })
    assert.deepEqual(resumePlan({ config: { ...byUrl, maxPages: 1 }, summary: saved({ stopReason: 'max-pages' }), csvText: csv }), {
      done: true,
      message: '--resume: the saved run already read 1 pages, and maxPages is 1: nothing more to read, the files are left as they are. Raise --max-pages to go on.',
    })
    assert.deepEqual(resumePlan({ config: { ...byUrl, maxRows: 2 }, summary: saved({ stopReason: 'max-rows' }), csvText: csv }), {
      done: true,
      message: '--resume: the saved run already has 2 rows, and maxRows is 2: nothing more to read, the files are left as they are. Raise --max-rows to go on.',
    })
  })

  test('a plan to go on: seed rows, resumeAt and what the summary says about the saved run', () => {
    assert.deepEqual(resumePlan({ config: byUrl, summary: saved(), csvText: csv }), {
      how: 'continued',
      seedRows: [{ a: 'x' }, { a: 'y' }],
      resumeAt: { how: 'continued', pages: 1, turn: 0, url: byUrl.url, rows: 2, keys: ['k'], rounds: [{ round: 1 }], claimed: [], mergedByLink: 0, mergedSameRecord: 0 },
      resumedFrom: { rows: 2, stopReason: 'running', pages: 1, how: 'continued', at: 'https://example.com/list?page=2' },
    })
    const scrollConfig = { ...byScroll }
    const scroll = resumePlan({ config: scrollConfig, summary: saved({ resume: { config: configKey(scrollConfig), pages: 2, turn: 0, url: byScroll.url, rows: 2, keys: [] } }), csvText: csv })
    assert.deepEqual(scroll.resumeAt, { how: 'from-start', rounds: [{ round: 1 }], claimed: [], mergedByLink: 0, mergedSameRecord: 0 })
    assert.deepEqual(scroll.resumedFrom, { rows: 2, stopReason: 'running', pages: 2, how: 'from-start', note: fromStartNote(scrollConfig, 2) })
  })
})
