// The parts of detail.mjs that need no browser: reading the list CSV back, judging a detail page read,
// the checkpoint, the output rows and the summary. Run with `node --test scripts/detail-plan.test.mjs`.
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { parseCsv, toCsv } from './lib/csv.mjs'
import {
  checkDetailSpec,
  childCsvDue,
  childrenCountColumn,
  childTextKeeper,
  detailStatusColumn,
  classifyDetail,
  detailLink,
  detailSpecKey,
  mergeChildRows,
  mergeDetailRows,
  needsDetailFetch,
  nextStreaks,
  readDetailCheckpoint,
  recordTextKeeper,
} from './lib/detail.mjs'
import { summarizeDetail } from './lib/report-format.mjs'

test('parseCsv reads what toCsv writes: BOM, commas, quotes and line breaks inside cells', () => {
  const columns = ['title', 'link', 'note']
  const rows = [
    { title: 'Plain', link: 'https://example.com/a', note: '' },
    { title: 'Comma, inside', link: 'https://example.com/b?x=1,2', note: 'say "hi"' },
    { title: 'Two\nlines', link: 'https://example.com/c', note: 'cr\r\nlf' },
    { title: '"quoted start', link: '', note: 'ends with quote"' },
  ]
  const text = toCsv(columns, rows)
  assert.ok(text.startsWith('﻿'))
  const back = parseCsv(text)
  assert.deepEqual(back.columns, columns)
  assert.deepEqual(back.rows, rows)
})

test('parseCsv: CRLF and CR line ends, blank lines, short and long rows, header spaces', () => {
  const { columns, rows } = parseCsv('a, b ,c\r\n1,2,3\r\n\r\n4,5\r6,7,8,9\n')
  assert.deepEqual(columns, ['a', 'b', 'c'])
  assert.deepEqual(rows, [
    { a: '1', b: '2', c: '3' },
    { a: '4', b: '5', c: '' },
    { a: '6', b: '7', c: '8' },
  ])
  // No trailing newline, and an empty quoted cell.
  assert.deepEqual(parseCsv('x,y\n"",z').rows, [{ x: '', y: 'z' }])
})

test('parseCsv refuses an unterminated quote and duplicate or empty column names', () => {
  assert.throws(() => parseCsv('a,b\n"open,1\n'), /never closed/)
  assert.throws(() => parseCsv('a,a\n1,2\n'), /twice/)
  assert.throws(() => parseCsv('a,,c\n1,2,3\n'), /empty column/)
})

test('detailLink keeps absolute http(s) URLs only', () => {
  assert.equal(detailLink(' https://example.com/p/1 '), 'https://example.com/p/1')
  assert.equal(detailLink('http://example.com'), 'http://example.com/')
  assert.equal(detailLink(''), null)
  assert.equal(detailLink('/p/1'), null)
  assert.equal(detailLink('javascript:void(0)'), null)
  assert.equal(detailLink('https://'), null)
})

const FIELDS = { name: 'h1', brand: '.brand', stock: { css: '.stock', default: 'n/a' } }
const noWall = { kind: null, evidence: '0 chars', signals: { challenge: false, text: null, login: null } }

test('classifyDetail: ok, empty (required missing / nothing / root missing), dead link handled by caller', () => {
  assert.deepEqual(classifyDetail({ httpStatus: 200, rec: { name: 'A', brand: '', stock: 'n/a' }, fields: FIELDS, required: ['name'], wall: noWall }), {
    status: 'ok',
    fields: { name: 'A', brand: '', stock: 'n/a' },
  })
  const missing = classifyDetail({ httpStatus: 200, rec: { name: '', brand: 'B', stock: 'n/a' }, fields: FIELDS, required: ['name'], wall: noWall })
  assert.equal(missing.status, 'empty')
  assert.match(missing.error, /required field empty: name/)
  // A field's default does not count as read.
  assert.equal(classifyDetail({ httpStatus: 200, rec: { name: '', brand: '', stock: 'n/a' }, fields: FIELDS, wall: noWall }).status, 'empty')
  const noRoot = classifyDetail({ httpStatus: 200, rec: null, fields: FIELDS, root: 'article.product', wall: noWall })
  assert.equal(noRoot.status, 'empty')
  assert.match(noRoot.error, /root "article.product" not found/)
})

test("classifyDetail: block statuses are blocked even when fields read, and so is a read of the challenge's own wording; block text alone is not", () => {
  const rec = { name: 'Verify you are human', brand: '', stock: '' }
  const challenge = { kind: 'blocked', evidence: 'challenge element div.captcha', signals: { challenge: true, text: 'Verify you are human', login: null } }
  assert.equal(classifyDetail({ httpStatus: 200, rec, fields: FIELDS, wall: challenge }).status, 'blocked')
  assert.equal(classifyDetail({ httpStatus: 429, rec, fields: FIELDS, wall: noWall }).status, 'blocked')
  assert.equal(classifyDetail({ httpStatus: 403, rec: null, fields: FIELDS, wall: noWall }).status, 'blocked')
  // An article that mentions rate limits is still an article.
  const textOnly = { kind: 'blocked', evidence: 'text "rate limit"', signals: { challenge: false, text: 'rate limit', login: null } }
  assert.equal(classifyDetail({ httpStatus: 200, rec: { name: 'About rate limits', brand: 'X', stock: '' }, fields: FIELDS, wall: textOnly }).status, 'ok')
  // …but a page that read nothing and says so is a wall.
  assert.equal(classifyDetail({ httpStatus: 200, rec: { name: '', brand: '', stock: '' }, fields: FIELDS, wall: textOnly }).status, 'blocked')
  const login = { kind: 'login', evidence: 'text "please log in"', signals: { challenge: false, text: null, login: 'please log in' } }
  assert.match(classifyDetail({ httpStatus: 200, rec: { name: '', brand: '', stock: '' }, fields: FIELDS, wall: login }).error, /login wall/)
})

test('classifyDetail: 5xx is a failure worth retrying unless the page carries block text', () => {
  assert.deepEqual(classifyDetail({ httpStatus: 503, rec: null, fields: FIELDS, wall: noWall }), { status: 'failed', fields: {}, error: 'HTTP 503' })
  const cloudflare = { kind: 'blocked', evidence: 'text "just a moment..."', signals: { challenge: false, text: 'Just a moment...', login: null } }
  assert.equal(classifyDetail({ httpStatus: 503, rec: null, fields: FIELDS, wall: cloudflare }).status, 'blocked')
  assert.equal(classifyDetail({ httpStatus: 400, rec: null, fields: FIELDS, wall: noWall }).status, 'failed')
})

test('nextStreaks: blocked in a row; empty since the last ok, not ended by dead links or failures', () => {
  let s = { blocked: 0, empty: 0 }
  s = nextStreaks(s, { status: 'empty' })
  s = nextStreaks(s, { status: 'empty', notFound: true })
  s = nextStreaks(s, { status: 'failed' })
  s = nextStreaks(s, { status: 'empty' })
  assert.deepEqual(s, { blocked: 0, empty: 2 })
  s = nextStreaks(s, { status: 'blocked' })
  s = nextStreaks(s, { status: 'blocked' })
  assert.deepEqual(s, { blocked: 2, empty: 2 })
  s = nextStreaks(s, { status: 'ok' })
  assert.deepEqual(s, { blocked: 0, empty: 0 })
})

test('needsDetailFetch: ok and empty are done, failed while tries are left, blocked always', () => {
  assert.equal(needsDetailFetch(undefined, 3), true)
  assert.equal(needsDetailFetch({ status: 'ok', attempts: 1 }, 3), false)
  assert.equal(needsDetailFetch({ status: 'empty', attempts: 1 }, 3), false)
  assert.equal(needsDetailFetch({ status: 'failed', attempts: 2 }, 3), true)
  assert.equal(needsDetailFetch({ status: 'failed', attempts: 3 }, 3), false)
  assert.equal(needsDetailFetch({ status: 'blocked', attempts: 9 }, 3), true)
})

test('readDetailCheckpoint: last line per URL wins, a half-written line is skipped, another spec is read again', () => {
  const key = detailSpecKey({ fields: { a: '.a' } })
  const other = detailSpecKey({ fields: { a: '.b' } })
  assert.notEqual(key, other)
  // Pacing does not change the key.
  assert.equal(detailSpecKey({ fields: { a: '.a' }, delayMs: 10, maxAttempts: 9, concurrency: 2 }), key)
  const lines = [
    { url: 'u1', status: 'failed', attempts: 1, spec: key },
    { url: 'u1', status: 'ok', attempts: 2, spec: key, fields: { a: 'x' } },
    { url: 'u2', status: 'ok', attempts: 1, spec: other },
    { url: 'u3', status: 'empty', attempts: 1, spec: key },
  ].map(e => JSON.stringify(e))
  const { entries, stale } = readDetailCheckpoint(`${lines.join('\n')}\n{"url":"u4","sta`, key)
  assert.deepEqual([...entries.keys()], ['u1', 'u3'])
  assert.equal(entries.get('u1').attempts, 2)
  assert.equal(stale, 1)
})

test('mergeDetailRows: every list row in order, no-link / pending / status, detail cells from ok pages only', () => {
  const entries = new Map([
    ['https://e.com/1', { status: 'ok', fields: { brand: 'A' } }],
    ['https://e.com/2', { status: 'failed', fields: {} }],
  ])
  const rows = mergeDetailRows(
    [
      { title: 'one', link: 'https://e.com/1' },
      { title: 'two', link: 'https://e.com/2' },
      { title: 'three', link: '' },
      { title: 'four', link: 'https://e.com/4' },
      { title: 'one again', link: 'https://e.com/1' },
    ],
    'link',
    ['brand'],
    entries
  )
  assert.deepEqual(
    rows.map(r => [r.title, r.brand, r.detail_status]),
    [
      ['one', 'A', 'ok'],
      ['two', '', 'failed'],
      ['three', '', 'no-link'],
      ['four', '', 'pending'],
      ['one again', 'A', 'ok'],
    ]
  )
})

test('checkDetailSpec: link column must exist; detail names must not collide with list columns or detail_status', () => {
  assert.deepEqual(checkDetailSpec({ link: 'link', fields: { brand: '.b' } }, ['title', 'link']), [])
  const problems = checkDetailSpec({ link: 'url', fields: { title: 'h1', detail_status: '.s' }, require: ['nope'], concurrency: 5 }, ['title', 'link'])
  assert.equal(problems.length, 4)
  assert.match(problems[0], /no column "url"/)
  assert.match(problems[1], /"title", "detail_status" already are columns/)
  assert.match(problems[2], /"nope" is not one of the fields/)
  assert.match(problems[3], /concurrency/)
})

test('summarizeDetail: counts, fill rates and the warnings an agent acts on', () => {
  const ok = (n, brand) => [`https://e.com/${n}`, { status: 'ok', fields: { name: `P${n}`, brand, notes: '' } }]
  const entries = new Map([
    ok(1, 'A'),
    ok(2, 'B'),
    ok(3, ''),
    ok(4, 'C'),
    ok(5, ''),
    ['https://e.com/6', { status: 'empty', notFound: true, error: 'HTTP 404 (dead link)' }],
    ['https://e.com/7', { status: 'empty', error: 'required field empty: name' }],
    ['https://e.com/8', { status: 'empty', error: 'required field empty: name' }],
    ['https://e.com/9', { status: 'failed', error: 'HTTP 503' }],
  ])
  const rowUrls = [...entries.keys(), 'https://e.com/10', null]
  const summary = summarizeDetail({ rowUrls, entries, detailNames: ['name', 'brand', 'notes'], stopReason: 'max-rows', maxRows: 9 })
  assert.deepEqual(summary.status, { ok: 5, empty: 3, failed: 1, blocked: 0, pending: 1, 'no-link': 1 })
  assert.deepEqual(summary.fillRate, { name: '5/5 (100%)', brand: '3/5 (60%)', notes: '0/5 (0%)' })
  assert.deepEqual(summary.deadLinks, { count: 1, sample: ['https://e.com/6'] })
  const text = summary.warnings.join('\n')
  assert.match(text, /"brand" is filled on 3\/5 ok pages while "name" is on 5.*https:\/\/e\.com\/3 , https:\/\/e\.com\/5/)
  assert.match(text, /"notes" is empty on every ok page/)
  assert.match(text, /2 of 7 pages read as empty/)
  assert.match(text, /1 page failed \(https:\/\/e\.com\/9: HTTP 503\)/)
  assert.match(text, /NOT THE END: preview of the first 9 links/)

  const blocked = summarizeDetail({ rowUrls: [], entries: new Map(), detailNames: ['name'], stopReason: 'blocked', note: '3 pages in a row looked blocked' })
  assert.match(blocked.note, /^3 pages in a row looked blocked — .*--browser chrome/)
  assert.equal(blocked.warnings, undefined)
})

test('classifyDetail: a challenge widget next to content that read in full (a corner reCAPTCHA badge) is ok; it blocks a read that is missing fields or read the wall itself', () => {
  const badge = { kind: 'blocked', evidence: 'challenge element div.grecaptcha-badge, 15 chars of text', signals: { challenge: true, text: null, login: null } }
  assert.deepEqual(classifyDetail({ httpStatus: 200, rec: { name: 'Blue widget', brand: 'Acme', stock: 'n/a' }, fields: FIELDS, required: ['name'], wall: badge }), {
    status: 'ok',
    fields: { name: 'Blue widget', brand: 'Acme', stock: 'n/a' },
  })
  // A footer notice ("protected by reCAPTCHA") next to the badge is still not a wall.
  const notice = { ...badge, signals: { challenge: true, text: 'reCAPTCHA', login: null } }
  assert.equal(classifyDetail({ httpStatus: 200, rec: { name: 'Blue widget', brand: '', stock: '' }, fields: FIELDS, required: ['name'], wall: notice }).status, 'ok')
  // Missing a required field with only a widget on the page: empty (the empty-page check with an ok page
  // read again tells a soft block from pages without the field), and the error names the widget.
  const missing = classifyDetail({ httpStatus: 200, rec: { name: '', brand: 'Acme', stock: '' }, fields: FIELDS, required: ['name'], wall: badge })
  assert.equal(missing.status, 'empty')
  assert.match(missing.error, /required field empty: name \(a challenge widget is on the page: challenge element div.grecaptcha-badge/)
  // With block wording too, it is blocked.
  const wording = { kind: 'blocked', evidence: 'challenge element div.captcha-box', signals: { challenge: true, text: 'Verify you are human', login: null } }
  assert.equal(classifyDetail({ httpStatus: 200, rec: { name: '', brand: '', stock: '' }, fields: FIELDS, required: ['name'], wall: wording }).status, 'blocked')
  // A loose selector that read the challenge's own wording: blocked.
  const check = { kind: 'blocked', evidence: 'challenge element div.captcha', signals: { challenge: true, text: 'Verify you are human', login: null } }
  assert.equal(classifyDetail({ httpStatus: 200, rec: { name: 'Verify you are human', brand: '', stock: '' }, fields: FIELDS, wall: check }).status, 'blocked')
})

test('parseCsv keeps every row of a one-column list: blank lines inside are rows with an empty cell, a quoted "" is a row; trailing blank lines are not', () => {
  assert.deepEqual(parseCsv('link\nhttps://a/1\n\nhttps://a/3\n').rows, [{ link: 'https://a/1' }, { link: '' }, { link: 'https://a/3' }])
  assert.deepEqual(parseCsv('link\n""\nhttp://a/1\n').rows, [{ link: '' }, { link: 'http://a/1' }])
  assert.deepEqual(parseCsv('link\nhttp://a/1\n\n\n').rows, [{ link: 'http://a/1' }])
  // toCsv writes a one-column row with an empty cell as "" so it survives the round trip, also at the end.
  const rows = [{ link: 'u1' }, { link: '' }, { link: '' }, { link: 'u2' }, { link: '' }]
  assert.equal(toCsv(['link'], rows), '﻿link\nu1\n""\n""\nu2\n""\n')
  assert.deepEqual(parseCsv(toCsv(['link'], rows)).rows, rows)
  // With more columns a blank line is still no row.
  assert.deepEqual(parseCsv('a,b\n1,2\n\n3,4\n').rows, [{ a: '1', b: '2' }, { a: '3', b: '4' }])
})

test('needsDetailFetch: an empty page not confirmed yet, or recorded by another browser, or with retryEmpty, is read again; dead links never', () => {
  assert.equal(needsDetailFetch({ status: 'empty', attempts: 1, unconfirmed: true }, 3), true)
  assert.equal(needsDetailFetch({ status: 'empty', attempts: 1, browser: 'bundled' }, 3, { browser: 'chrome' }), true)
  assert.equal(needsDetailFetch({ status: 'empty', attempts: 1, browser: 'bundled' }, 3, { browser: 'bundled' }), false)
  assert.equal(needsDetailFetch({ status: 'empty', attempts: 1 }, 3, { retryEmpty: true }), true)
  assert.equal(needsDetailFetch({ status: 'empty', attempts: 1, notFound: true, unconfirmed: true }, 3, { browser: 'chrome', retryEmpty: true }), false)
  assert.equal(needsDetailFetch({ status: 'ok', attempts: 1, browser: 'bundled' }, 3, { browser: 'chrome', retryEmpty: true }), false)
})

test('checkDetailSpec checks types: fields an object of specs, require / setup / expand / dismiss arrays, root / waitFor strings', () => {
  const cols = ['title', 'link']
  assert.match(checkDetailSpec({ link: 'link', fields: 'h1.name' }, cols).join('\n'), /"fields" must be an object/)
  assert.match(checkDetailSpec({ link: 'link', fields: ['h1.name'] }, cols).join('\n'), /"fields" must be an object/)
  assert.match(checkDetailSpec({ link: 'link', fields: { a: '.a' }, require: 'a' }, cols).join('\n'), /"require" must be an array/)
  assert.match(checkDetailSpec({ link: 'link', fields: { a: '.a' }, setup: { click: '.x' } }, cols).join('\n'), /"setup" must be an array/)
  assert.match(checkDetailSpec({ link: 'link', fields: { a: '.a' }, expand: '.more' }, cols).join('\n'), /"expand" must be an array/)
  assert.match(checkDetailSpec({ link: 'link', fields: { a: '.a' }, root: ['main'] }, cols).join('\n'), /"root" must be a CSS string/)
  assert.match(checkDetailSpec({ link: 'link', fields: { a: '.a' }, waitFor: 3 }, cols).join('\n'), /"waitFor" must be a CSS string/)
  assert.match(checkDetailSpec({ link: 'link', fields: { a: 3 } }, cols).join('\n'), /field "a"/)
  assert.deepEqual(checkDetailSpec({ link: 'link', fields: { a: '.a', b: { css: '.b', attr: 'href' } }, require: ['a'], expand: ['.more'], root: 'main' }, cols), [])
})

test('a list that is already a detail.mjs output (it has detail_status) gets the next status column, so its output reads back', () => {
  assert.equal(detailStatusColumn(['title', 'link']), 'detail_status')
  assert.equal(detailStatusColumn(['title', 'link', 'detail_status']), 'detail_status_2')
  assert.equal(detailStatusColumn(['detail_status', 'detail_status_2']), 'detail_status_3')
  const cols = ['title', 'link', 'name', 'detail_status']
  assert.deepEqual(checkDetailSpec({ link: 'link', fields: { seller: '.seller' } }, cols), [])
  assert.match(checkDetailSpec({ link: 'link', fields: { detail_status_2: '.x' } }, cols).join('\n'), /"detail_status_2" already is a column/)
  const rows = mergeDetailRows([{ title: 't', link: 'https://e.com/1', name: 'N', detail_status: 'ok' }], 'link', ['seller'], new Map([['https://e.com/1', { status: 'ok', fields: { seller: 'S' } }]]), 'detail_status_2')
  const text = toCsv([...cols, 'seller', 'detail_status_2'], rows)
  assert.deepEqual(parseCsv(text).rows, [{ title: 't', link: 'https://e.com/1', name: 'N', detail_status: 'ok', seller: 'S', detail_status_2: 'ok' }])
})

test('summarizeDetail counts rows, like the detail_status column: a link in two rows counts twice', () => {
  const entries = new Map([
    ['https://e.com/1', { status: 'ok', fields: { name: 'A' } }],
    ['https://e.com/2', { status: 'failed', error: 'HTTP 503' }],
  ])
  const rowUrls = ['https://e.com/1', 'https://e.com/1', null, 'https://e.com/2', 'https://e.com/3', 'https://e.com/1']
  const summary = summarizeDetail({ rowUrls, entries, detailNames: ['name'], stopReason: 'done' })
  assert.equal(summary.rows, 6)
  assert.equal(summary.links, 3)
  assert.deepEqual(summary.status, { ok: 3, empty: 0, failed: 1, blocked: 0, pending: 1, 'no-link': 1 })
  assert.deepEqual(summary.fillRate, { name: '1/1 (100%)' })
  const merged = mergeDetailRows(rowUrls.map(link => ({ link: link ?? '' })), 'link', ['name'], entries)
  const fromCsv = {}
  for (const row of merged) fromCsv[row.detail_status] = (fromCsv[row.detail_status] ?? 0) + 1
  for (const [status, n] of Object.entries(summary.status)) assert.equal(fromCsv[status] ?? 0, n, status)
})

test('summarizeDetail: a low-fill or all-empty warning quotes the record text of a page where the column is empty, so the value can be looked for in the whole record', () => {
  const ok = (n, brand, recordText, recordScope = 'root') => [
    `https://e.com/${n}`,
    { status: 'ok', fields: { name: `P${n}`, brand, notes: '' }, ...(recordText ? { recordText, recordScope } : {}) },
  ]
  const entries = new Map([
    ok(1, 'A', 'P1 Notes: none'),
    ok(2, 'B', 'P2 Notes: none'),
    // The first page where brand is empty has no record text (an older checkpoint line): the next one is quoted.
    ok(3, ''),
    ok(4, 'C', 'P4 Notes: none'),
    ok(5, '', 'P5 by "Initech" $22.00'),
  ])
  const summary = summarizeDetail({ rowUrls: [...entries.keys()], entries, detailNames: ['name', 'brand', 'notes'], stopReason: 'done' })
  const [brand, notes] = [summary.warnings.find(w => w.includes('"brand"')), summary.warnings.find(w => w.includes('"notes"'))]
  assert.ok(!brand.includes('\n'), 'one paragraph')
  assert.match(brand, /"brand" is filled on 3\/5 ok pages while "name" is on 5.*https:\/\/e\.com\/3 , https:\/\/e\.com\/5/)
  assert.ok(brand.includes('On https://e.com/5 the record reads: "P5 by \\"Initech\\" $22.00". Look for the value there before deciding the item lacks it'), brand)
  assert.ok(notes.includes('On https://e.com/1 the record reads: "P1 Notes: none"'), notes)
  // Without any record text the warning still says to look at the whole record, not one block of it.
  const bare = summarizeDetail({ rowUrls: ['https://e.com/1', 'https://e.com/2', 'https://e.com/3'], entries: new Map([ok(1, 'A'), ok(2, 'B'), ok(3, '')]), detailNames: ['name', 'brand'], stopReason: 'done' })
  assert.match(bare.warnings[0], /whole record/)
  assert.doesNotMatch(bare.warnings[0], /the record reads/)
})

test('summarizeDetail: a cut-off record excerpt is quoted as the start of the record, and the whole record is still to be inspected', () => {
  const ok = (n, brand, extra = {}) => [`https://e.com/${n}`, { status: 'ok', fields: { name: `P${n}`, brand }, ...extra }]
  const head = `P3 Home › Shoes › P3 $10.00 Size: 40 41 42 ${'x'.repeat(340)}…`
  const entries = new Map([ok(1, 'A'), ok(2, 'B'), ok(3, '', { recordText: head, recordScope: 'root' })])
  const [warning] = summarizeDetail({ rowUrls: [...entries.keys()], entries, detailNames: ['name', 'brand'], stopReason: 'done' }).warnings
  assert.ok(warning.includes(`On https://e.com/3 the record starts: ${JSON.stringify(head)} (cut off).`), warning)
  assert.match(warning, /if it is not in this part, inspect the whole record \(--html "<root>"\) before deciding the item lacks it/)
  assert.doesNotMatch(warning, /the record reads/)
  // The verdict "keep the selector" stays, but only after the whole record was looked at.
  assert.ok(warning.indexOf('inspect the whole record') < warning.indexOf('keep the selector'), warning)
})

test('summarizeDetail: an excerpt not taken from root is not called the record', () => {
  const ok = (n, brand, extra = {}) => [`https://e.com/${n}`, { status: 'ok', fields: { name: `P${n}`, brand }, ...extra }]
  const run = extra => summarizeDetail({ rowUrls: ['https://e.com/1', 'https://e.com/2', 'https://e.com/3'], entries: new Map([ok(1, 'A'), ok(2, 'B'), ok(3, '', extra)]), detailNames: ['name', 'brand'], stopReason: 'done' }).warnings[0]
  const main = run({ recordText: 'P3 by Initech', recordScope: 'main' })
  assert.ok(main.includes(`On https://e.com/3 the page's main content (no "root" set) reads: "P3 by Initech".`), main)
  assert.doesNotMatch(main, /the record reads/)
  // A checkpoint line without a scope says no more than "the page".
  const unknown = run({ recordText: 'P3 by Initech' })
  assert.ok(unknown.includes('On https://e.com/3 the page reads: "P3 by Initech".'), unknown)
})

test('recordTextKeeper: excerpts are kept for the first few pages per blank column, counting the checkpoint already read', () => {
  const page = (blank, recordText = 'text') => ({ status: 'ok', fields: Object.fromEntries(['name', 'brand', 'sku'].map(f => [f, blank.includes(f) ? '' : 'v'])), recordText })
  const keep = recordTextKeeper(new Map([['https://e.com/0', page(['brand'])]]), ['name', 'brand', 'sku'], 2)
  assert.equal(keep(page(['brand'])), true, 'second brand excerpt')
  assert.equal(keep(page(['brand'])), false, 'brand has two already')
  assert.equal(keep(page(['brand', 'sku'])), true, 'sku has none yet')
  assert.equal(keep(page(['sku'])), true)
  assert.equal(keep(page(['sku'])), false)
  assert.equal(keep({ status: 'ok', fields: { name: '', brand: 'B', sku: 'S' } }), false, 'no excerpt read')
  assert.equal(keep({ ...page(['name']), status: 'empty' }), false, 'only ok pages')
  assert.equal(keep(page(['name'])), true)
})

test('detailSpecKey: a spec without children keeps the key it had before child lists; children (and their max) change it', () => {
  // Keys written by checkpoints before "children" existed.
  assert.equal(detailSpecKey({ fields: { a: '.a' } }), '1ajo36p')
  assert.equal(detailSpecKey({ fields: { name: 'h1' }, root: 'main', expand: ['.more'] }), '1whwxq6')
  const kids = { rows: '.review', fields: { author: '.author' } }
  const key = detailSpecKey({ fields: { a: '.a' }, children: kids })
  assert.notEqual(key, '1ajo36p')
  assert.notEqual(detailSpecKey({ fields: { a: '.a' }, children: { ...kids, fields: { author: '.by' } } }), key)
  assert.notEqual(detailSpecKey({ fields: { a: '.a' }, children: { ...kids, max: 5 } }), key)
  assert.equal(detailSpecKey({ fields: { a: '.a' }, children: kids, delayMs: 9 }), key)
})

test('checkDetailSpec: children needs rows and fields; its columns may not be the child table key columns; the count column may not be a detail field', () => {
  const cols = ['title', 'link']
  const base = { link: 'link', fields: { name: 'h1' } }
  assert.deepEqual(checkDetailSpec({ ...base, children: { rows: '.review', fields: { author: '.a', stars: { css: '.s', attr: 'title' } }, require: ['author'], max: 50 } }, cols), [])
  assert.match(checkDetailSpec({ ...base, children: '.review' }, cols).join('\n'), /"children" must be an object/)
  const text = checkDetailSpec({ ...base, children: { fields: { parent_row: '.x', author: 3 }, require: ['nope'], max: 0 } }, cols).join('\n')
  assert.match(text, /"children.rows" is required/)
  assert.match(text, /child field "author" must be a CSS string/)
  assert.match(text, /"parent_row": parent_link, parent_row, child_index are the child table's own columns/)
  assert.match(text, /"children.require": "nope" is not one of the child fields/)
  assert.match(text, /"children.max" must be a whole number/)
  assert.match(checkDetailSpec({ ...base, children: { rows: '.r' } }, cols).join('\n'), /"children.fields" needs at least one field/)
  assert.match(checkDetailSpec({ link: 'link', fields: { children_count: 'h1' }, children: { rows: '.r', fields: { a: '.a' } } }, cols).join('\n'), /"children_count" already is a column/)
  // Without children, a field may be called children_count.
  assert.deepEqual(checkDetailSpec({ link: 'link', fields: { children_count: 'h1' } }, cols), [])
  // A second pass over an output with a child count gets the next count column.
  assert.equal(childrenCountColumn(['title', 'children_count']), 'children_count_2')
})

test('mergeDetailRows / mergeChildRows: the count is 0 on an ok page without children and blank elsewhere; child rows are keyed by link cell and main-CSV row number, under every row of a link read once', () => {
  const entries = new Map([
    ['https://e.com/1', { status: 'ok', fields: { name: 'A' }, children: [{ author: 'x', stars: '5' }, { author: 'y', stars: '' }] }],
    ['https://e.com/2', { status: 'ok', fields: { name: 'B' }, children: [] }],
    ['https://e.com/3', { status: 'failed', fields: {} }],
  ])
  const list = [
    { title: 'one', link: 'https://e.com/1' },
    { title: 'two', link: 'https://e.com/2' },
    { title: 'three', link: 'https://e.com/3' },
    { title: 'none', link: '' },
    { title: 'four', link: 'https://e.com/4' },
    { title: 'one again', link: 'https://e.com/1' },
  ]
  const rows = mergeDetailRows(list, 'link', ['name'], entries, 'detail_status', 'children_count')
  assert.deepEqual(rows.map(r => [r.title, r.children_count, r.detail_status]), [
    ['one', '2', 'ok'],
    ['two', '0', 'ok'],
    ['three', '', 'failed'],
    ['none', '', 'no-link'],
    ['four', '', 'pending'],
    ['one again', '2', 'ok'],
  ])
  // Without a count column nothing changes.
  assert.deepEqual(Object.keys(mergeDetailRows(list, 'link', ['name'], entries)[0]), ['title', 'link', 'name', 'detail_status'])
  assert.deepEqual(mergeChildRows(list, 'link', ['author', 'stars'], entries), [
    { parent_link: 'https://e.com/1', parent_row: '1', child_index: '1', author: 'x', stars: '5' },
    { parent_link: 'https://e.com/1', parent_row: '1', child_index: '2', author: 'y', stars: '' },
    { parent_link: 'https://e.com/1', parent_row: '6', child_index: '1', author: 'x', stars: '5' },
    { parent_link: 'https://e.com/1', parent_row: '6', child_index: '2', author: 'y', stars: '' },
  ])
})

test('summarizeDetail with children: child rows per main row, pages without any, child fill rates, capped pages; warnings for a child selector that matches nothing, a thin child column and a link to more children elsewhere', () => {
  const page = (n, children, extra = {}) => [`https://e.com/${n}`, { status: 'ok', fields: { name: `P${n}` }, children, ...extra }]
  const kid = (author, stars, date = '2026-01-01') => ({ author, stars, date })
  const entries = new Map([
    page(1, [kid('a', '5'), kid('b', ''), kid('c', '')], { childText: { index: 2, text: 'b ★★★★☆ 1 Jan 2026 Great' }, childrenMatched: 7 }),
    page(2, [], { recordText: 'P2 No reviews yet.', recordScope: 'root' }),
    page(3, [kid('d', '4'), kid('e', '3')], { childPager: { text: 'Next ›', href: 'https://e.com/3?page=2' } }),
    ['https://e.com/4', { status: 'blocked', error: 'captcha' }],
  ])
  const rowUrls = ['https://e.com/1', 'https://e.com/2', 'https://e.com/3', 'https://e.com/4', 'https://e.com/1']
  const children = { selector: '.review', names: ['author', 'stars', 'date'], out: '/tmp/x.children.csv', countColumn: 'children_count' }
  const summary = summarizeDetail({ rowUrls, entries, detailNames: ['name'], stopReason: 'done', children })
  assert.deepEqual(summary.children, {
    out: '/tmp/x.children.csv',
    countColumn: 'children_count',
    // Rows of the child CSV: #1 is in two rows, so its 3 children are listed twice.
    rows: 8,
    okPages: 3,
    pagesWithNone: { count: 1, sample: ['https://e.com/2'], check: 'open one: if it shows child rows, they rendered late; rerun with --retry-empty to read these pages again' },
    fillRate: { author: '5/5 (100%)', stars: '3/5 (60%)', date: '5/5 (100%)' },
    capped: { count: 1, sample: ['https://e.com/1'] },
  })
  const text = summary.warnings.join('\n')
  assert.match(text, /child column "stars" is filled in 3\/5 child rows while "author" is in 5: either those rows lack it, or show it in another place\. On https:\/\/e\.com\/1 child row 2 reads: "b ★★★★☆ 1 Jan 2026 Great"\./)
  assert.match(text, /on 1 of 3 ok pages the child list has a link to more of it on another URL \(e\.g\. "Next ›" → https:\/\/e\.com\/3\?page=2 on https:\/\/e\.com\/3\)/)
  assert.doesNotMatch(text, /matched no child row/)

  // No child row on any ok page: one warning, quoting the record of a page without children.
  const empty = new Map([page(1, []), page(2, [], { recordText: 'P2 Reviews (3) Mia ★★★★★', recordScope: 'root' })])
  const none = summarizeDetail({ rowUrls: [...empty.keys()], entries: empty, detailNames: ['name'], stopReason: 'done', children })
  assert.equal(none.children.rows, 0)
  assert.deepEqual(none.children.fillRate, { author: '0/0 (0%)', stars: '0/0 (0%)', date: '0/0 (0%)' })
  assert.equal(none.warnings.length, 1)
  assert.match(none.warnings[0], /^"children.rows" \("\.review"\) matched no child row on any of the 2 ok pages: .* On https:\/\/e\.com\/2 the record reads: "P2 Reviews \(3\) Mia ★★★★★"\. Check with inspect --probe/)
  // Without children the summary has no children part.
  assert.equal(summarizeDetail({ rowUrls: [...empty.keys()], entries: empty, detailNames: ['name'], stopReason: 'done' }).children, undefined)
})

test('recordTextKeeper counts a page without child rows as a blank column; childTextKeeper keeps child excerpts per blank child column', () => {
  const keep = recordTextKeeper(new Map(), ['name'], 1)
  assert.equal(keep({ status: 'ok', fields: { name: 'A' }, children: [], recordText: 'r' }), true, 'no child row')
  assert.equal(keep({ status: 'ok', fields: { name: 'A' }, children: [], recordText: 'r' }), false, 'one is enough')
  assert.equal(keep({ status: 'ok', fields: { name: 'A' }, children: [{ a: '1' }], recordText: 'r' }), false, 'has children, no blank field')
  assert.equal(keep({ status: 'ok', fields: { name: 'A' }, recordText: 'r' }), false, 'no child list at all')

  const page = (row, childText = { index: 1, text: 't' }) => ({ status: 'ok', fields: {}, children: [row], childText })
  const kept = new Map([['u0', page({ a: '', b: '1' })]])
  const keepChild = childTextKeeper(kept, ['a', 'b'], 2)
  assert.equal(keepChild(page({ a: '', b: '1' })), true, 'second excerpt for a')
  assert.equal(keepChild(page({ a: '', b: '1' })), false, 'a has two')
  assert.equal(keepChild(page({ a: '', b: '' })), true, 'b has none yet')
  assert.equal(keepChild({ status: 'ok', fields: {}, children: [{ a: '' }] }), false, 'no excerpt read')
})

test('checkDetailSpec: selectors that cannot be CSS (blank, an unclosed bracket or quote, a trailing combinator) are refused before any page loads, in fields, root, waitFor and children', () => {
  const cols = ['title', 'link']
  const base = { link: 'link', fields: { name: 'h1' } }
  const kids = (rows, fields = { a: '.a' }) => ({ ...base, children: { rows, fields } })
  assert.match(checkDetailSpec(kids('li['), cols).join('\n'), /"children.rows" \("li\["\) is not valid CSS: it has an unclosed "\["/)
  assert.match(checkDetailSpec(kids(' '), cols).join('\n'), /"children.rows" is required/)
  assert.match(checkDetailSpec(kids('li', { a: '.a', text: 'p[' }), cols).join('\n'), /child field "text" \("p\["\) is not valid CSS/)
  assert.match(checkDetailSpec(kids('li', { a: { css: 'span >', attr: 'title' } }), cols).join('\n'), /child field "a" \("span >"\) is not valid CSS: it ends in a combinator/)
  assert.match(checkDetailSpec({ ...base, fields: { name: 'h1, ' } }, cols).join('\n'), /field "name" \("h1, "\) is not valid CSS: it has an empty part/)
  assert.match(checkDetailSpec({ ...base, root: 'a[href="x]' }, cols).join('\n'), /"root" \("a\[href=\\"x\]"\) is not valid CSS: it has an unclosed quote/)
  assert.match(checkDetailSpec({ ...base, waitFor: 'div:not(.x' }, cols).join('\n'), /"waitFor" \("div:not\(\.x"\) is not valid CSS: it has an unclosed "\("/)
  // Fine: the row itself ("" / "." / ":scope" in a field), attribute values with brackets in quotes, escapes.
  assert.deepEqual(checkDetailSpec(kids('li.c', { self: { css: '.', attr: 'id' }, all: '', q: 'a[title="x[1]"]', esc: '.w-1\\/2' }), cols), [])
})

test('checkDetailSpec: keys inside children that belong at the top level are named; expandPasses is a whole number', () => {
  const cols = ['title', 'link']
  const text = checkDetailSpec({ link: 'link', fields: { name: 'h1' }, children: { rows: 'li', fields: { a: '.a' }, expand: ['.more'], root: '.x' } }, cols).join('\n')
  assert.match(text, /"children" has unknown keys "expand", "root": expand \/ setup \/ waitFor \/ root go at the top level of the detail config/)
  assert.match(checkDetailSpec({ link: 'link', fields: { name: 'h1' }, expandPasses: 0 }, cols).join('\n'), /"expandPasses" must be a whole number from 1 to 200/)
  assert.deepEqual(checkDetailSpec({ link: 'link', fields: { name: 'h1' }, expandPasses: 40 }, cols), [])
})

test('detailSpecKey: expandPasses reads pages again when given, and leaves older keys alone when not', () => {
  assert.equal(detailSpecKey({ fields: { a: '.a' } }), '1ajo36p')
  assert.notEqual(detailSpecKey({ fields: { a: '.a' }, expandPasses: 40 }), '1ajo36p')
})

test('needsDetailFetch: with retryEmpty, an ok page that read no child row is read again too', () => {
  const opts = { retryEmpty: true }
  assert.equal(needsDetailFetch({ status: 'ok', children: [] }, 3, opts), true)
  assert.equal(needsDetailFetch({ status: 'ok', children: [] }, 3, {}), false)
  assert.equal(needsDetailFetch({ status: 'ok', children: [{ a: 'x' }] }, 3, opts), false)
  assert.equal(needsDetailFetch({ status: 'ok' }, 3, opts), false)
})

test('childCsvDue: the child table is rewritten every few seconds while small, and once it is big only after it grew by a tenth', () => {
  assert.equal(childCsvDue({ rows: 10, writtenRows: 5, sinceMs: 2500 }), true)
  assert.equal(childCsvDue({ rows: 10, writtenRows: 5, sinceMs: 500 }), false)
  assert.equal(childCsvDue({ rows: 4999, writtenRows: 4900, sinceMs: 2500 }), true)
  assert.equal(childCsvDue({ rows: 105_000, writtenRows: 100_000, sinceMs: 60_000 }), false)
  assert.equal(childCsvDue({ rows: 110_000, writtenRows: 100_000, sinceMs: 2500 }), true)
  assert.equal(childCsvDue({ rows: 110_000, writtenRows: 100_000, sinceMs: 500 }), false)
})

test('mergeDetailRows: the child count is blank on an ok page whose children could not be read', () => {
  const entries = new Map([['https://e.com/1', { status: 'ok', fields: { name: 'A' }, childError: "'li:bogus' is not a valid selector." }]])
  const rows = mergeDetailRows([{ link: 'https://e.com/1' }], 'link', ['name'], entries, 'detail_status', 'children_count')
  assert.deepEqual(rows, [{ link: 'https://e.com/1', name: 'A', children_count: '', detail_status: 'ok' }])
})

test('summarizeDetail with children: blank child rows, separate places, container matches, unclicked controls, counts beside the list, hidden rows and child errors each get a warning', () => {
  const ok = (url, extra) => [url, { url, status: 'ok', fields: { name: 'x' }, ...extra }]
  const kid = a => ({ author: a, text: a ? `${a} says` : '' })
  const entries = new Map([
    ok('https://e.com/1', { children: [kid('a'), kid(''), kid(''), kid('')] }),
    ok('https://e.com/2', { children: [kid('b'), kid('c')], childPlaces: { places: 2, firsts: ['Top review: x', 'b says'] }, childDupes: 1 }),
    ok('https://e.com/3', { children: [kid('d')], childMore: { control: 'Show all 9 comments', claim: { text: 'Comments (9)', n: 9 } } }),
    ok('https://e.com/4', { children: [kid('e')], childMore: { claim: { text: 'Comments (4)', n: 4 } } }),
    ok('https://e.com/5', { children: [], childrenHidden: 3 }),
    ok('https://e.com/6', { childError: "'li:bogus' is not a valid selector." }),
  ])
  const rowUrls = [...entries.keys()]
  const summary = summarizeDetail({ rowUrls, entries, detailNames: ['name'], stopReason: 'done', children: { selector: 'li', names: ['author', 'text'], out: '/x.children.csv', countColumn: 'children_count' } })
  const w = summary.warnings.join('\n')
  assert.match(w, /3 of 8 child rows read nothing in any child column/)
  assert.match(w, /on 1 of 6 ok pages the child rows come from 2 separate places on the page \(e\.g\. on https:\/\/e\.com\/2: "Top review: x", "b says"\)/)
  assert.match(w, /on 1 of 6 ok pages "children\.rows" matches a container together with the child rows in it/)
  assert.match(w, /on 1 of 6 ok pages a control beside the child rows was not clicked \(e\.g\. "Show all 9 comments" on https:\/\/e\.com\/3, 1 child row read\): it is not in "expand"/)
  assert.match(w, /on 1 of 6 ok pages a heading beside the child rows counts more than were read \(e\.g\. "Comments \(4\)" on https:\/\/e\.com\/4, 1 read\)/)
  assert.match(w, /on 1 of 6 ok pages no child row was read, but "children\.rows" matches 3 elements the page does not show/)
  assert.match(w, /children could not be read on 1 of 6 ok pages: 'li:bogus' is not a valid selector\./)
  assert.deepEqual(summary.children.childErrors, { count: 1, sample: ['https://e.com/6'] })
})
