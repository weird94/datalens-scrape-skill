// createDetailRun (lib/detail-run.mjs): the detail-page scheduler detail.mjs drives, without any I/O, so a
// host without a file system (the extension) runs the same queue, retries, streaks and canary check.
// Run with `node --test scripts/detail-run.test.mjs`.
import assert from 'node:assert/strict'
import path from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'
import { detailSpecKey } from './lib/detail.mjs'
import { createDetailRun } from './lib/detail-run.mjs'
import * as engine from './lib/index.mjs'
import { browserSafetyProblems } from './test-support/browser-safe.mjs'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const spec = { link: 'link', fields: { name: 'h1' } }
const url = n => `https://shop.test/p/${n}`
const rows = (...ns) => ns.map(n => ({ title: `P${n}`, link: n === null ? '' : url(n) }))
const ok = (name = 'x') => ({ status: 'ok', fields: { name } })
const empty = () => ({ status: 'empty', fields: {}, error: 'required field empty: name' })
const dead = () => ({ status: 'empty', fields: {}, error: 'HTTP 404 (dead link)', httpStatus: 404, notFound: true })
const failed = () => ({ status: 'failed', fields: {}, error: 'HTTP 503' })
const blocked = () => ({ status: 'blocked', fields: {}, error: 'captcha' })

test('detail-run.mjs, and the engine index that exports it, use nothing Node-only (they run in a browser)', () => {
  for (const entry of ['lib/detail-run.mjs', 'lib/index.mjs']) assert.deepEqual(browserSafetyProblems(path.join(HERE, entry)), [], entry)
  assert.equal(engine.createDetailRun, createDetailRun)
})

test('the queue: distinct links in list order, rows without a link left out, maxLinks keeps the first N', () => {
  const run = createDetailRun({ spec, listRows: rows(1, 2, null, 1, 3, 4) })
  assert.deepEqual(run.rowUrls, [url(1), url(2), null, url(1), url(3), url(4)])
  assert.deepEqual(run.links, [url(1), url(2), url(3), url(4)])
  assert.deepEqual(run.queue, [url(1), url(2), url(3), url(4)])
  assert.deepEqual(createDetailRun({ spec, listRows: rows(1, 2, 3, 4), maxLinks: 2 }).queue, [url(1), url(2)])
})

test('the queue skips pages done before; empty pages read again go last, failed ones while they have tries left', () => {
  const key = detailSpecKey(spec)
  const entries = new Map([
    [url(1), { url: url(1), status: 'ok', fields: { name: 'a' }, attempts: 1, spec: key }],
    [url(2), { url: url(2), status: 'empty', fields: {}, attempts: 1, spec: key, unconfirmed: true }],
    [url(3), { url: url(3), status: 'empty', fields: {}, attempts: 1, spec: key }],
    [url(4), { url: url(4), status: 'failed', fields: {}, attempts: 1, spec: key }],
    [url(5), { url: url(5), status: 'failed', fields: {}, attempts: 3, spec: key }],
    [url(6), { url: url(6), status: 'blocked', fields: {}, attempts: 7, spec: key }],
  ])
  const run = createDetailRun({ spec, listRows: rows(1, 2, 3, 4, 5, 6, 7), entries })
  assert.deepEqual(run.queue, [url(4), url(6), url(7), url(2)])
  // retryEmpty reads the confirmed empty page again too, after the others.
  const again = createDetailRun({ spec, listRows: rows(1, 2, 3, 4, 5, 6, 7), entries: new Map(entries), retryEmpty: true })
  assert.deepEqual(again.queue, [url(4), url(6), url(7), url(2), url(3)])
  // An empty page read by the other browser is read again.
  const other = new Map([[url(3), { ...entries.get(url(3)), browser: 'bundled' }]])
  assert.deepEqual(createDetailRun({ spec, listRows: rows(3), entries: other, browser: 'chrome' }).queue, [url(3)])
})

test('take: a failed page goes back to the end of the queue while it has tries left; attempts add up over runs', () => {
  const entries = new Map([[url(1), { url: url(1), status: 'failed', fields: {}, attempts: 1, spec: detailSpecKey(spec) }]])
  const run = createDetailRun({ spec: { ...spec, maxAttempts: 3 }, listRows: rows(1, 2), entries })
  assert.deepEqual(run.queue, [url(1), url(2)])
  run.queue.shift()
  assert.equal(run.take(url(1), failed()), null)
  assert.equal(run.entries.get(url(1)).attempts, 2)
  assert.deepEqual(run.queue, [url(2), url(1)])
  run.queue.shift()
  run.take(url(2), ok())
  run.queue.shift()
  run.take(url(1), failed())
  assert.equal(run.entries.get(url(1)).attempts, 3)
  assert.deepEqual(run.queue, [], 'no tries left: not queued again')
  assert.equal(run.fetched, 3)
  assert.equal(run.finish().stopReason, 'done')
})

test('take: three blocked pages in a row stop the run as blocked; the first stop reason wins', () => {
  const run = createDetailRun({ spec, listRows: rows(1, 2, 3, 4) })
  assert.equal(run.take(url(1), blocked()), null)
  assert.equal(run.take(url(2), blocked()), null)
  assert.equal(run.take(url(3), blocked()), 'stop')
  assert.equal(run.stopReason, 'blocked')
  assert.match(run.note, /3 pages in a row looked blocked \(last: https:\/\/shop\.test\/p\/3 — captcha\)/)
  run.stop('error', 'later')
  const end = run.finish()
  assert.equal(end.stopReason, 'blocked')
  assert.equal(end.fetched, 3)
})

test('take: an ok page between blocked ones ends the streak; dead links and failures do not count as empty', () => {
  const run = createDetailRun({ spec, listRows: rows(1, 2, 3, 4, 5, 6) })
  assert.equal(run.take(url(1), blocked()), null)
  assert.equal(run.take(url(2), blocked()), null)
  assert.equal(run.take(url(3), ok()), null)
  assert.equal(run.take(url(4), blocked()), null)
  assert.equal(run.take(url(5), dead()), null)
  assert.equal(run.take(url(6), failed()), null)
  assert.equal(run.stopReason, null)
  assert.equal(run.entries.get(url(5)).unconfirmed, undefined, 'a dead link is what it reads')
})

test('three empty pages in a row call for the canary; an ok canary vouches for them and the run goes on', async () => {
  const run = createDetailRun({ spec, listRows: rows(1, 2, 3, 4, 5) })
  run.take(url(1), ok('one'))
  assert.equal(run.take(url(2), empty()), null)
  assert.equal(run.entries.get(url(2)).unconfirmed, true)
  run.take(url(3), empty())
  assert.equal(run.take(url(4), empty()), 'canary')
  const asked = []
  const verdict = await run.checkCanary(async target => {
    asked.push(target)
    return ok('one')
  })
  assert.equal(verdict, null)
  assert.deepEqual(asked, [url(1)], 'the page that read ok before is read again')
  assert.deepEqual(run.canary, [{ url: url(1), status: 'ok', afterEmpty: 3 }])
  for (const n of [2, 3, 4]) assert.equal(run.entries.get(url(n)).unconfirmed, undefined, `page ${n} confirmed`)
  // The streak starts over: two more empty pages do not call for it again.
  assert.equal(run.take(url(5), empty()), null)
  assert.equal(run.stopReason, null)
})

test('a canary that reads empty too stops the run as blocked and marks the unconfirmed empty pages blocked (read again next run)', async () => {
  const persisted = []
  const run = createDetailRun({ spec, listRows: rows(1, 2, 3, 4), persist: entry => persisted.push(entry) })
  run.take(url(1), ok())
  run.take(url(2), empty())
  run.take(url(3), empty())
  assert.equal(run.take(url(4), empty()), 'canary')
  const verdict = await run.checkCanary(async () => empty())
  assert.equal(verdict, 'stop')
  assert.equal(run.stopReason, 'blocked')
  assert.match(run.note, /3 pages read empty with no ok page between them, and https:\/\/shop\.test\/p\/1, which read fine before, now reads empty \(required field empty: name\)/)
  for (const n of [2, 3, 4]) {
    const entry = run.entries.get(url(n))
    assert.equal(entry.status, 'blocked')
    assert.equal(entry.attempts, 1, 're-marking is not another try')
    assert.match(entry.error, /re-marked: a page that read fine before \(https:\/\/shop\.test\/p\/1\) now reads empty/)
  }
  assert.equal(run.entries.get(url(1)).status, 'ok', 'the canary page itself keeps what it read')
  assert.deepEqual(persisted.map(e => [e.url, e.status]).slice(-3), [[url(2), 'blocked'], [url(3), 'blocked'], [url(4), 'blocked']])
  assert.equal(run.finish().stopReason, 'blocked')
})

test('the canary: no ok page yet stops with no-data; two failed checks let the run go on', async () => {
  const none = createDetailRun({ spec, listRows: rows(1, 2, 3) })
  none.take(url(1), empty())
  none.take(url(2), empty())
  assert.equal(none.take(url(3), empty()), 'canary')
  assert.equal(await none.checkCanary(async () => assert.fail('nothing to read')), 'stop')
  assert.equal(none.stopReason, 'no-data')
  assert.match(none.note, /^3 pages read empty and none has read ok yet \(e\.g\. https:\/\/shop\.test\/p\/1: required field empty: name\)/)

  const flaky = createDetailRun({ spec, listRows: rows(1, 2, 3, 4, 5, 6) })
  flaky.take(url(1), ok())
  flaky.take(url(2), ok())
  flaky.take(url(3), empty())
  flaky.take(url(4), empty())
  flaky.take(url(5), empty())
  const asked = []
  assert.equal(await flaky.checkCanary(async target => (asked.push(target), failed())), null)
  assert.deepEqual(asked, [url(1), url(2)], 'once more on another ok page')
  assert.equal(flaky.stopReason, null)
  assert.equal(flaky.canary.length, 2)
  assert.equal(flaky.take(url(6), empty()), null, 'the empty streak starts over')
})

test('a read aborted mid-way records nothing: the canary returns stop, an interrupted run keeps its empty pages unconfirmed', async () => {
  const persisted = []
  const run = createDetailRun({ spec, listRows: rows(1, 2, 3, 4, 5), persist: entry => persisted.push(entry) })
  run.take(url(1), ok())
  run.take(url(2), empty())
  run.take(url(3), empty())
  assert.equal(run.take(url(4), empty()), 'canary')
  const before = persisted.length
  run.stop('interrupted')
  assert.equal(await run.checkCanary(async () => null), 'stop')
  assert.equal(persisted.length, before, 'nothing recorded for the aborted read')
  assert.deepEqual(run.canary, [])
  const end = run.finish()
  assert.equal(end.stopReason, 'interrupted')
  assert.equal(run.entries.get(url(2)).unconfirmed, true, 'read again on the next run')
  assert.equal(run.entries.has(url(5)), false)
})

test('finish: done confirms the empty pages; max-rows only while a link past maxLinks still needs reading', () => {
  const run = createDetailRun({ spec, listRows: rows(1, 2) })
  run.take(url(1), empty())
  run.take(url(2), empty())
  assert.deepEqual(run.finish(), { stopReason: 'done', note: '', canary: [], fetched: 2 })
  assert.equal(run.entries.get(url(1)).unconfirmed, undefined)

  const preview = createDetailRun({ spec, listRows: rows(1, 2, 3), maxLinks: 2 })
  preview.take(url(1), ok())
  preview.take(url(2), empty())
  assert.equal(preview.finish().stopReason, 'max-rows')
  assert.equal(preview.entries.get(url(2)).unconfirmed, undefined, 'a preview that went through confirms too')

  const key = detailSpecKey(spec)
  const doneBefore = new Map([[url(3), { url: url(3), status: 'ok', fields: { name: 'c' }, attempts: 1, spec: key }]])
  const rest = createDetailRun({ spec, listRows: rows(1, 2, 3), maxLinks: 2, entries: doneBefore })
  rest.take(url(1), ok())
  rest.take(url(2), ok())
  assert.equal(rest.finish().stopReason, 'done', 'the links past maxLinks were all read before')
})

test('each entry is persisted as it is kept, with the spec key, the browser, and children only on ok pages', () => {
  const persisted = []
  const kids = { ...spec, children: { rows: 'li', fields: { a: '.a' } } }
  const run = createDetailRun({ spec: kids, listRows: rows(1, 2), browser: 'chrome', persist: entry => persisted.push(entry) })
  run.take(url(1), { status: 'ok', fields: { name: 'n' }, children: [{ a: '1' }], childrenMatched: 3, recordText: 'r', recordScope: 'root' })
  run.take(url(2), { status: 'failed', fields: {}, error: 'timeout', children: [{ a: 'x' }] })
  assert.deepEqual(persisted[0], { url: url(1), status: 'ok', fields: { name: 'n' }, attempts: 1, spec: detailSpecKey(kids), browser: 'chrome', children: [{ a: '1' }], childrenMatched: 3 })
  assert.deepEqual(persisted[1], { url: url(2), status: 'failed', fields: {}, attempts: 1, spec: detailSpecKey(kids), browser: 'chrome', error: 'timeout' })
  assert.equal(run.entries.get(url(1)), persisted[0])
})

test('flush waits for a persist that returns a promise, and reports one that failed', async () => {
  const stored = []
  const slow = createDetailRun({
    spec,
    listRows: rows(1, 2),
    persist: entry => new Promise(resolve => setTimeout(() => resolve(stored.push(entry.url)), 10)),
  })
  slow.take(url(1), ok())
  slow.take(url(2), ok())
  assert.deepEqual(stored, [])
  await slow.flush()
  assert.deepEqual(stored, [url(1), url(2)])

  const broken = createDetailRun({ spec, listRows: rows(1), persist: () => Promise.reject(new Error('disk full')) })
  broken.take(url(1), ok())
  await assert.rejects(broken.flush(), /disk full/)
})
