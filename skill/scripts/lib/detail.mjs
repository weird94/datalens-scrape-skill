// Detail pages: open each row's own page and read fields there (scripts/detail.mjs drives it).
//
// readDetailPage / readDetailBatch / classifyDetail / nextStreaks only use Playwright's `page` and each
// other, so the same code runs in detail.mjs's own Node process (bundled browser) and, stringified, inside
// `playwright-cli run-code` attached to the user's Chrome. Keep them self-contained: no closures over module
// scope. Everything they need comes in through `lib` ({ settle, gotoAndSettle, runSetup, installDlk }).
// The other exports are plain helpers for the Node side.
import { installDlk } from './in-page.mjs'
import { gotoAndSettle, runSetup, settle } from './page-helpers.mjs'

/** How many blocked pages in a row stop the run, and how many empty ones in a row trigger the canary check. */
export const DETAIL_STREAK_LIMIT = 3
/** The column that says what happened to each row's detail page. */
export const DETAIL_STATUS_COLUMN = 'detail_status'
/** The column that counts each row's child rows (with `children`). */
export const CHILDREN_COUNT_COLUMN = 'children_count'
/** The child table's first columns: the parent row's link and its row number in the main CSV, the child's place on its page. */
export const CHILD_KEY_COLUMNS = ['parent_link', 'parent_row', 'child_index']

/**
 * Open one detail page and read `spec.fields` on it (relative to `spec.root`, or to the whole page).
 * → { status: 'ok' | 'empty' | 'failed' | 'blocked', fields, error?, httpStatus?, notFound?, expandClicks?, recordText? }
 * recordText / recordScope: on an ok page where a field read blank (or, with `children`, no child row was found), the
 * text of `root` ('root'), else of the page's main ('main'), on one line, cut to 400 chars (then it ends with "…");
 * none on a page with neither.
 * With `spec.children` ({ rows, fields, require?, max? }), an ok page also gets `children`: the rows `children.rows`
 * matches inside `root` that the page draws, read after setup and expand (and waited for a little when none is there
 * yet), each with `children.fields` (rows with a `require` field blank left out, the first `max` kept);
 * `childrenMatched` (how many there were, when `max` cut them), `childText` ({ index, text }: the first kept child
 * row with a blank field, 1-based, its text cut to 300 chars), `childPager` ({ text, href }: a link beside the child
 * rows that leads to more of them on another URL), `childMore` ({ control?, claim? }: a control beside them that
 * expand did not click, a count beside them larger than the rows), `childPlaces` ({ places, firsts }: the rows come
 * from several separate places on the page), `childDupes` (rows that hold the next row and read the same),
 * `childrenHidden` (matches the page does not draw). A child read that throws (CSS the page rejects) leaves the
 * page ok with its fields and `childError` instead of `children`.
 * `expandCapped`: the label of an `expand` control still there after the last pass (`expandPasses`).
 * Never throws: a page that could not be loaded or read comes back as 'failed'.
 */
export async function readDetailPage(page, url, spec, lib) {
  const { settle, gotoAndSettle, runSetup, installDlk } = lib
  const fields = spec.fields ?? {}
  const names = Object.keys(fields)
  const required = spec.require ?? []
  const rootSel = spec.root || 'html'
  const timeoutMs = Number(spec.waitTimeoutMs ?? 10_000)
  /** Without `require`: a read that stays the same this long, with something in it, is taken as the page. */
  const STABLE_MS = 3000
  /** With `expand`: fields can be behind the clicks, so a read that shows something and stays the same this long will do. */
  const BEFORE_EXPAND_STABLE_MS = 1000
  /** Rounds of expand clicks; a load-more under a child list may need many. */
  const EXPAND_PASSES = Number(spec.expandPasses ?? (spec.children ? 30 : 10))
  const EXPAND_WAIT_MS = 8000
  /** With `children` and no child row on the page yet: how long to wait for rows that render after the record. */
  const CHILD_WAIT_MS = 3000
  /** Characters of the record's text kept for a page where a field read blank. */
  const RECORD_TEXT_MAX = 400
  /** Characters of a child row's text kept when one of its fields read blank. */
  const CHILD_TEXT_MAX = 300
  const firstLine = error => String(error?.message ?? error).split('\n')[0]

  /** Retry page.evaluate across navigations; inject the page helpers if this document lacks them. */
  async function inPage(fn, arg) {
    for (let attempt = 0; attempt < 6; attempt += 1) {
      try {
        if (!(await page.evaluate(() => !!window.__dlk))) await page.evaluate(installDlk)
        return await page.evaluate(fn, arg)
      } catch (error) {
        if (!/context was destroyed|navigat|__dlk/i.test(String(error.message))) throw error
        await page.waitForLoadState('load', { timeout: 10_000 }).catch(() => undefined)
      }
    }
    throw new Error('page kept navigating')
  }
  /** Empty, or only the field's `default`: the page showed nothing for this field. */
  const blank = (name, rec) => {
    const value = String(rec?.[name] ?? '')
    const spec = fields[name]
    return value === '' || (typeof spec === 'object' && spec?.default !== undefined && value === String(spec.default))
  }
  const read = () =>
    inPage(([root, f]) => {
      const recs = window.__dlk.extract(root, f)
      return recs.length ? recs[0] : null
    }, [rootSel, fields])
  const wallCheck = status => inPage(s => window.__dlk.wall(s), status).catch(() => null)
  /**
   * Parts that open on a click ("read more", a collapsed section, a load-more under a list): click every match
   * (inside `root` when given: related items around the record have the same buttons), pass after pass.
   * → { clicks, capped: the label of a control a next pass would still click, or null }
   */
  async function expandAll() {
    let clicks = 0
    for (let pass = 0; pass < EXPAND_PASSES; pass += 1) {
      const before = await inPage(sel => window.__dlk.contentMark(sel), rootSel).catch(() => '')
      const clicked = await inPage(([expand, sel, within]) => window.__dlk.clickAll(expand, sel, 60, false, within), [spec.expand, rootSel, spec.root || null]).catch(() => 0)
      if (!clicked) return { clicks, capped: null }
      clicks += clicked
      const deadline = Date.now() + EXPAND_WAIT_MS
      while (Date.now() < deadline && (await inPage(sel => window.__dlk.contentMark(sel), rootSel).catch(() => '')) === before) await page.waitForTimeout(250)
      await settle(page, { quietMs: 800, maxMs: 5000 })
    }
    const capped = await inPage(([expand, sel, within]) => window.__dlk.expandPending(expand, sel, within), [spec.expand, rootSel, spec.root || null]).catch(() => null)
    return { clicks, capped }
  }
  /**
   * The item's own list (its reviews, comments, variants): every drawn match of `children.rows` inside root. None
   * yet: wait a little (rows that come with their own request), then expand again for the controls that came with them.
   * → { out (the result's child keys), expanded (that second expand, or null) }. Throws on CSS the page rejects.
   */
  async function readChildren() {
    const kids = spec.children
    const childFields = kids.fields ?? {}
    const childNames = Object.keys(childFields)
    const childBlank = (name, rec) => {
      const value = String(rec?.[name] ?? '')
      const field = childFields[name]
      return value === '' || (typeof field === 'object' && field?.default !== undefined && value === String(field.default))
    }
    const readRows = async () => (await inPage(([root, rows, f]) => window.__dlk.extractIn(root, rows, f), [rootSel, kids.rows, childFields])) ?? { recs: [], hidden: 0, places: 0, dupes: 0 }
    let got = await readRows()
    let expanded = null
    if (!got.recs.length) {
      const until = Date.now() + CHILD_WAIT_MS
      while (!got.recs.length && Date.now() < until) {
        await page.waitForTimeout(400)
        got = await readRows()
      }
      if (got.recs.length) {
        await settle(page, { quietMs: 800, maxMs: 5000 })
        if (spec.expand?.length) expanded = await expandAll()
        got = await readRows()
      }
    }
    const recs = got.recs
    const kept = recs.map((rec, index) => ({ rec, index })).filter(({ rec }) => !(kids.require ?? []).some(name => childBlank(name, rec)))
    const max = Number(kids.max ?? 0)
    const list = max > 0 ? kept.slice(0, max) : kept
    const out = { children: list.map(({ rec }) => Object.fromEntries(childNames.map(name => [name, String(rec[name] ?? '')]))) }
    if (list.length < kept.length) out.childrenMatched = kept.length
    const gap = list.findIndex(({ rec }) => childNames.some(name => childBlank(name, rec)))
    if (gap >= 0) {
      const text = await inPage(([root, rows, i, n]) => window.__dlk.rowTextIn(root, rows, i, n), [rootSel, kids.rows, list[gap].index, CHILD_TEXT_MAX]).catch(() => '')
      if (text) out.childText = { index: gap + 1, text }
    }
    const pager = await inPage(([root, rows, rooted]) => window.__dlk.pagerNear(root, rows, rooted), [rootSel, kids.rows, Boolean(spec.root)]).catch(() => null)
    if (pager) out.childPager = pager
    if (recs.length) {
      const more = await inPage(([root, rows, expand]) => window.__dlk.moreNear(root, rows, expand), [rootSel, kids.rows, spec.expand ?? []]).catch(() => null)
      if (more) out.childMore = more
    }
    if (got.places > 1) out.childPlaces = { places: got.places, firsts: got.firsts ?? [] }
    if (got.dupes) out.childDupes = got.dupes
    if (got.hidden) out.childrenHidden = got.hidden
    return { out, expanded }
  }
  /** A wall worth giving up the wait for: it says so in words (block / login text). A challenge widget alone may be a corner badge. */
  const wallSays = w => Boolean(w?.kind) && Boolean(w.signals?.login || (w.signals?.text && !/^((re|h)?captcha|turnstile|geetest|arkose|funcaptcha)$/i.test(w.signals.text)))

  let httpStatus = null
  try {
    const started = Date.now()
    try {
      httpStatus = await gotoAndSettle(page, url)
    } catch (error) {
      // A failed goto returns before the navigation that ends it (Chrome's error page, or the one that cut in)
      // has landed; the next goto would be cut off by it in turn. Let it land first.
      const cutIn = String(error?.message).match(/interrupted by another navigation to "([^"]+)"/)?.[1]
      await page.waitForURL(u => (cutIn ? u.href === cutIn : u.protocol === 'chrome-error:'), { waitUntil: 'commit', timeout: 3000 }).catch(() => undefined)
      // Cut off by a navigation that was not ours (one the page before left pending): once more.
      if (!cutIn) throw error
      httpStatus = await gotoAndSettle(page, url)
    }
    if (httpStatus === 404 || httpStatus === 410) {
      return { status: 'empty', fields: {}, httpStatus, notFound: true, error: `HTTP ${httpStatus} (dead link)` }
    }
    if (spec.dismiss?.length || spec.autoDismiss !== false) {
      const closed = await inPage(([sel, auto, keep]) => window.__dlk.dismiss(sel, auto, keep), [spec.dismiss ?? [], spec.autoDismiss !== false, spec.root ?? null]).catch(() => 0)
      if (closed) await settle(page, { quietMs: 600, maxMs: 3000 })
    }
    // Late content: wait for what says the page is there (waitFor, else root) before anything is clicked.
    const anchor = spec.waitFor || spec.root
    if (anchor) {
      while (Date.now() - started < timeoutMs) {
        const n = await inPage(sel => window.__dlk.count(sel), anchor).catch(() => 0)
        if (n > 0) break
        await page.waitForTimeout(400)
      }
    }
    let setup = null
    if (spec.setup?.length) {
      await inPage(() => true).catch(() => undefined)
      setup = await runSetup(page, spec.setup)
      if (setup.error) return { status: 'failed', fields: {}, httpStatus, error: setup.error }
    }
    // Then until the fields are there: all of `require` (or all fields); without `require`, a read that
    // shows something and stopped changing will do (with `expand`, sooner: the rest may be behind a click).
    // A page that says it is a wall stops the wait.
    const want = required.length ? required : names
    let rec = null
    let last = ''
    let stableSince = Date.now()
    for (let round = 0; ; round += 1) {
      rec = await read().catch(() => null)
      const mark = JSON.stringify(rec)
      if (mark !== last) {
        last = mark
        stableSince = Date.now()
      }
      if (rec && want.every(name => !blank(name, rec))) break
      const some = rec && names.some(name => !blank(name, rec))
      if (some && !required.length && Date.now() - stableSince >= STABLE_MS) break
      if (some && spec.expand?.length && Date.now() - stableSince >= BEFORE_EXPAND_STABLE_MS) break
      if (Date.now() - started >= timeoutMs) break
      if (round % 5 === 4 && wallSays(await wallCheck(httpStatus))) break
      await page.waitForTimeout(400)
    }
    await settle(page, { quietMs: Number(spec.quietMs ?? 800), maxMs: 5000 })
    let expand = spec.expand?.length ? await expandAll() : { clicks: 0, capped: null }
    rec = await read()
    const wall = await wallCheck(httpStatus)
    const verdict = classifyDetail({ httpStatus, rec, fields, required, root: spec.root ?? null, wall })
    let kids = null
    if (verdict.status === 'ok' && spec.children) {
      // A child spec the page rejects is the spec's fault, not the page's: keep the fields that read.
      try {
        const childRead = await readChildren()
        kids = childRead.out
        if (childRead.expanded) expand = { clicks: expand.clicks + childRead.expanded.clicks, capped: childRead.expanded.capped }
      } catch (error) {
        kids = { childError: firstLine(error) }
      }
    }
    const expandClicks = expand.clicks
    // A field blank (or no child row) on a page that read: keep the record's text, so the summary can show where the value may be instead.
    const excerpt =
      verdict.status === 'ok' && (names.some(name => blank(name, verdict.fields)) || kids?.children?.length === 0)
        ? await inPage(([sel, max]) => window.__dlk.recordText(sel, max), [spec.root || null, RECORD_TEXT_MAX]).catch(() => null)
        : null
    return {
      ...verdict,
      ...(kids ?? {}),
      ...(httpStatus !== null && httpStatus !== 200 ? { httpStatus } : {}),
      ...(expandClicks ? { expandClicks } : {}),
      ...(expand.capped ? { expandCapped: { text: expand.capped, passes: EXPAND_PASSES } } : {}),
      ...(excerpt?.text ? { recordText: excerpt.text, recordScope: excerpt.scope } : {}),
    }
  } catch (error) {
    return { status: 'failed', fields: {}, ...(httpStatus !== null ? { httpStatus } : {}), error: firstLine(error) }
  }
}

/**
 * What a read of a detail page amounts to.
 *   blocked — HTTP 401/403/407/429, a 5xx with block text, a page that read nothing (or lacks `require`) and
 *             says it is a block or login wall, or a read that is the challenge's own wording
 *   failed  — another HTTP error (5xx without block signs, other 4xx): worth another try
 *   empty   — it loaded but `root` is missing, every field is empty, or a `require` field is (also with only a
 *             challenge widget on the page: the empty-page check tells a soft block from empty pages)
 *   ok      — otherwise
 * Signs of a wall on a page that read in full do not make it blocked: an article about rate limits is still
 * an article, and many sites show a captcha badge in a corner of every page. → { status, fields, error? }
 */
export function classifyDetail({ httpStatus, rec, fields, required = [], root = null, wall = null }) {
  const names = Object.keys(fields ?? {})
  const blank = name => {
    const value = String(rec?.[name] ?? '')
    const spec = fields[name]
    return value === '' || (typeof spec === 'object' && spec?.default !== undefined && value === String(spec.default))
  }
  const signals = wall?.signals ?? {}
  const wallText = wall?.evidence ? `${wall.kind === 'login' ? 'login wall' : 'block / bot check'}: ${wall.evidence}` : ''
  /** Block or login wording, not just a widget's name ("reCAPTCHA" in a footer notice). */
  const says = Boolean(signals.login || (signals.text && !/^((re|h)?captcha|turnstile|geetest|arkose|funcaptcha)$/i.test(signals.text)))
  if ([401, 403, 407, 429].includes(httpStatus)) return { status: 'blocked', fields: {}, error: wallText || `HTTP ${httpStatus}` }
  if (httpStatus >= 500) {
    if (signals.text) return { status: 'blocked', fields: {}, error: wallText }
    return { status: 'failed', fields: {}, error: `HTTP ${httpStatus}` }
  }
  if (httpStatus >= 400) return { status: 'failed', fields: {}, error: `HTTP ${httpStatus}` }
  const missing = required.filter(blank)
  const why = !rec
    ? `root "${root}" not found`
    : names.every(blank)
      ? 'no field read anything'
      : missing.length
        ? `required field${missing.length > 1 ? 's' : ''} empty: ${missing.join(', ')}`
        : ''
  if (why) {
    if (wall?.kind && (says || !signals.challenge)) return { status: 'blocked', fields: {}, error: wallText }
    if (signals.challenge) return { status: 'empty', fields: {}, error: `${why} (a challenge widget is on the page: ${wall.evidence})` }
    return { status: 'empty', fields: {}, error: why }
  }
  const text = signals.text ? signals.text.toLowerCase() : ''
  if (signals.challenge && text && names.some(name => String(rec[name] ?? '').toLowerCase().includes(text))) {
    return { status: 'blocked', fields: {}, error: wallText }
  }
  return { status: 'ok', fields: Object.fromEntries(names.map(name => [name, String(rec[name] ?? '')])) }
}

/**
 * Streaks after one more result: `blocked` counts blocked pages in a row (anything else ends it);
 * `empty` counts empty pages since the last ok one (dead links and failures neither add nor end it).
 */
export function nextStreaks(streaks, result) {
  const blocked = result.status === 'blocked' ? streaks.blocked + 1 : 0
  const empty = result.status === 'ok' ? 0 : result.status === 'empty' && !result.notFound ? streaks.empty + 1 : streaks.empty
  return { blocked, empty }
}

/**
 * Read several detail pages one after another in one tab (one `run-code` call in the user's Chrome), with
 * a jittered pause (delayMs .. 2×delayMs) before each one but the first (before the first too with
 * `state.delayFirst`). Stops early when the streaks reach `state.limit`, so the caller can stop or check.
 * After the first page it checks that the browser draws the tab (a minimized or covered window does not,
 * and late content then never comes): if not, even after bringing it to the front, it stops with
 * `notRendering` and no results. → { results: [{ url, ...readDetailPage result }], notRendering? }
 */
export async function readDetailBatch(page, urls, spec, lib, state = {}) {
  const results = []
  const limit = Number(state.limit ?? 3)
  const delayMs = Number(spec.delayMs ?? 1500)
  const drawing = () =>
    page
      .evaluate(() => new Promise(resolve => {
        requestAnimationFrame(() => resolve(true))
        setTimeout(() => resolve(false), 1500)
      }))
      .catch(() => true)
  let streaks = { blocked: Number(state.blocked ?? 0), empty: Number(state.empty ?? 0) }
  for (const [i, url] of urls.entries()) {
    if (i > 0 || state.delayFirst) await page.waitForTimeout(Math.round(delayMs + Math.random() * delayMs))
    const result = await readDetailPage(page, url, spec, lib)
    if (i === 0 && !(await drawing())) {
      await page.bringToFront().catch(() => undefined)
      if (!(await drawing())) return { results: [], notRendering: true }
    }
    results.push({ url, ...result })
    streaks = nextStreaks(streaks, result)
    if (streaks.blocked >= limit || streaks.empty >= limit) break
  }
  return { results }
}

// ---------- Node-side helpers (plain data, no page) ----------

/**
 * What to send to the user's Chrome (lib/chrome.mjs runInChrome) to read `urls` there with readDetailBatch:
 * the functions it needs, as source, and the call. → { sources, call }
 */
export function detailBatchProgram(urls, spec, state = {}) {
  return {
    sources: [installDlk, settle, gotoAndSettle, runSetup, classifyDetail, nextStreaks, readDetailPage, readDetailBatch].map(String),
    call: `readDetailBatch(page, ${JSON.stringify(urls)}, ${JSON.stringify(spec)}, { settle, gotoAndSettle, runSetup, installDlk }, ${JSON.stringify(state)})`,
  }
}

/** The detail URL a list cell holds: an absolute http(s) URL, or null (empty, relative or not a URL). */
export function detailLink(value) {
  const text = String(value ?? '').trim()
  if (!/^https?:\/\//i.test(text)) return null
  try {
    return new URL(text).href
  } catch {
    return null
  }
}

/**
 * The output's status column: `detail_status`, or `detail_status_2`, `_3`… when the list already has it (a
 * second detail pass over a detail output, e.g. for pages its rows link to).
 */
export function detailStatusColumn(listColumns) {
  return freeColumn(DETAIL_STATUS_COLUMN, listColumns)
}

/** The count column with `children`: `children_count`, or `children_count_2`… when the list already has it. */
export function childrenCountColumn(listColumns) {
  return freeColumn(CHILDREN_COUNT_COLUMN, listColumns)
}

/** `name`, or `name_2`, `name_3`… : the first one not among `columns`. */
function freeColumn(name, columns) {
  if (!columns.includes(name)) return name
  let n = 2
  while (columns.includes(`${name}_${n}`)) n += 1
  return `${name}_${n}`
}

/**
 * Problems with a detail spec against the list's columns (empty array when it is fine). Detail columns may
 * not reuse a list column's name, nor the status column's: rename them in the spec.
 */
export function checkDetailSpec(spec, listColumns) {
  const problems = []
  const isObject = value => Boolean(value) && typeof value === 'object' && !Array.isArray(value)
  if (!isObject(spec)) return ['the detail config must be a JSON object']
  if (!spec.link || typeof spec.link !== 'string') problems.push('"link" is required: the list column that holds each row\'s detail URL')
  else if (!listColumns.includes(spec.link)) problems.push(`"link": the list has no column "${spec.link}" (columns: ${listColumns.join(', ')})`)
  if (spec.fields !== undefined && !isObject(spec.fields)) problems.push('"fields" must be an object: { "<column>": "<css>" or { "css": …, "attr": … } }')
  const names = isObject(spec.fields) ? Object.keys(spec.fields) : []
  if (!names.length) problems.push('"fields" needs at least one field')
  for (const name of names) {
    const field = spec.fields[name]
    if (typeof field !== 'string' && !isObject(field)) problems.push(`field "${name}" must be a CSS string or a field object`)
    else problems.push(...fieldCssProblems(`field "${name}"`, field))
  }
  for (const key of ['require', 'setup', 'expand', 'dismiss']) {
    if (spec[key] !== undefined && !Array.isArray(spec[key])) problems.push(`"${key}" must be an array`)
  }
  for (const key of ['root', 'waitFor']) {
    if (spec[key] !== undefined && spec[key] !== null && typeof spec[key] !== 'string') problems.push(`"${key}" must be a CSS string`)
    else if (spec[key]) problems.push(...cssProblems(`"${key}"`, spec[key]))
  }
  if (spec.expandPasses !== undefined && !(Number.isInteger(spec.expandPasses) && spec.expandPasses >= 1 && spec.expandPasses <= 200)) problems.push('"expandPasses" must be a whole number from 1 to 200')
  const statusColumn = detailStatusColumn(listColumns)
  const countColumn = spec.children !== undefined ? childrenCountColumn(listColumns) : null
  const taken = names.filter(name => listColumns.includes(name) || name === statusColumn || name === countColumn)
  if (taken.length) {
    problems.push(
      `detail field${taken.length > 1 ? 's' : ''} ${taken.map(n => `"${n}"`).join(', ')} already ${taken.length > 1 ? 'are columns' : 'is a column'} of the output; rename ${taken.length > 1 ? 'them' : 'it'} in "fields" (e.g. "detail_${taken[0]}")`
    )
  }
  for (const name of Array.isArray(spec.require) ? spec.require : []) if (!names.includes(name)) problems.push(`"require": "${name}" is not one of the fields`)
  if (spec.children !== undefined) problems.push(...checkChildrenSpec(spec.children))
  const concurrency = Number(spec.concurrency ?? 1)
  if (!Number.isInteger(concurrency) || concurrency < 1 || concurrency > 3) problems.push('"concurrency" must be 1, 2 or 3')
  const attempts = Number(spec.maxAttempts ?? 3)
  if (!Number.isInteger(attempts) || attempts < 1) problems.push('"maxAttempts" must be a whole number ≥ 1')
  if (spec.delayMs !== undefined && !(Number(spec.delayMs) >= 0)) problems.push('"delayMs" must be a number ≥ 0')
  return problems
}

/** The keys `children` takes; the others (expand, setup, waitFor, root…) belong at the top level. */
const CHILDREN_KEYS = ['rows', 'fields', 'require', 'max']

/** Problems with a spec's `children` (empty array when it is fine). */
function checkChildrenSpec(kids) {
  const isObject = value => Boolean(value) && typeof value === 'object' && !Array.isArray(value)
  const hint = '{ "rows": "<css of each child row, inside root>", "fields": { … } }'
  if (!isObject(kids)) return [`"children" must be an object: ${hint}`]
  const problems = []
  if (!kids.rows || typeof kids.rows !== 'string' || !kids.rows.trim()) problems.push(`"children.rows" is required: the CSS of each child row, inside root (${hint})`)
  else problems.push(...cssProblems('"children.rows"', kids.rows))
  const unknown = Object.keys(kids).filter(key => !CHILDREN_KEYS.includes(key))
  if (unknown.length) problems.push(`"children" has unknown keys ${unknown.map(k => `"${k}"`).join(', ')}: expand / setup / waitFor / root go at the top level of the detail config; "children" takes ${CHILDREN_KEYS.join(', ')}`)
  const names = isObject(kids.fields) ? Object.keys(kids.fields) : []
  if (!names.length) problems.push('"children.fields" needs at least one field: { "<column>": "<css inside the child row>" or { "css": …, "attr": … } }')
  for (const name of names) {
    const field = kids.fields[name]
    if (typeof field !== 'string' && !isObject(field)) problems.push(`child field "${name}" must be a CSS string or a field object`)
    else problems.push(...fieldCssProblems(`child field "${name}"`, field))
  }
  const reserved = names.filter(name => CHILD_KEY_COLUMNS.includes(name))
  if (reserved.length) problems.push(`child field${reserved.length > 1 ? 's' : ''} ${reserved.map(n => `"${n}"`).join(', ')}: ${CHILD_KEY_COLUMNS.join(', ')} are the child table's own columns; rename ${reserved.length > 1 ? 'them' : 'it'}`)
  if (kids.require !== undefined && !Array.isArray(kids.require)) problems.push('"children.require" must be an array')
  for (const name of Array.isArray(kids.require) ? kids.require : []) if (!names.includes(name)) problems.push(`"children.require": "${name}" is not one of the child fields`)
  if (kids.max !== undefined && !(Number.isInteger(kids.max) && kids.max >= 1)) problems.push('"children.max" must be a whole number ≥ 1')
  return problems
}

/** A field's CSS problems: "", "." and ":scope" (the row itself) are fine. */
function fieldCssProblems(what, field) {
  const css = typeof field === 'string' ? field : field.css
  if (css === undefined || css === '' || css === '.' || css === ':scope') return []
  if (typeof css !== 'string') return [`${what}: "css" must be a string`]
  return cssProblems(what, css)
}

/**
 * Mistakes that make a selector invalid CSS, caught before any page loads: blank, an unclosed bracket, parenthesis
 * or quote, an empty part in a comma list, a trailing combinator. (Other bad CSS still throws in the page.)
 */
function cssProblems(what, css) {
  const bad = cssSyntaxProblem(css)
  return bad ? [`${what} (${JSON.stringify(css)}) is not valid CSS: ${bad}`] : []
}

/** → why `css` cannot be a selector, or null. */
export function cssSyntaxProblem(css) {
  if (!css.trim()) return 'it is blank'
  const open = []
  let quote = null
  for (let i = 0; i < css.length; i += 1) {
    const ch = css[i]
    if (ch === '\\') {
      i += 1
      continue
    }
    if (quote) {
      if (ch === quote) quote = null
      continue
    }
    if (ch === '"' || ch === "'") quote = ch
    else if (ch === '(' || ch === '[') open.push(ch)
    else if (ch === ')' || ch === ']') {
      if (open.pop() !== (ch === ')' ? '(' : '[')) return `it has an unmatched "${ch}"`
    }
  }
  if (quote) return 'it has an unclosed quote'
  if (open.length) return `it has an unclosed "${open[open.length - 1]}"`
  if (/(^|,)\s*(,|$)/.test(css)) return 'it has an empty part in its comma list'
  if (/[>+~]\s*(,|$)/.test(css)) return 'it ends in a combinator'
  return null
}

/** The child table, past this many rows, is rewritten only after it grew by a tenth: each rewrite costs its whole size. */
export const CHILD_CSV_SMALL = 5000

/** Is the child table due for a rewrite while the run goes on? (It is always written at the end.) */
export function childCsvDue({ rows, writtenRows, sinceMs, everyMs = 2000 }) {
  if (sinceMs < everyMs) return false
  return rows < CHILD_CSV_SMALL || rows * 10 >= writtenRows * 11
}

/**
 * A short key for what a detail spec reads (fields, root, require, waitFor, setup, expand, children, expandPasses): checkpoint
 * entries read with another one are read again, so fixing a selector and rerunning updates the rows.
 * Pacing and retry settings are left out: changing them keeps the pages already read.
 */
export function detailSpecKey(spec) {
  const parts = [spec.fields ?? {}, spec.root ?? null, spec.require ?? [], spec.waitFor ?? null, spec.setup ?? [], spec.expand ?? []]
  // Without children (or expandPasses) the key stays what it was before they existed: older checkpoints are kept.
  const withKids = spec.children !== undefined ? [...parts, spec.children] : parts
  const text = JSON.stringify(spec.expandPasses !== undefined ? [...withKids, { expandPasses: spec.expandPasses }] : withKids)
  let hash = 5381
  for (let i = 0; i < text.length; i += 1) hash = ((hash << 5) + hash + text.charCodeAt(i)) | 0
  return (hash >>> 0).toString(36)
}

/**
 * Should this URL be fetched (again), given its last checkpoint entry? ok and dead links are done; failed
 * while it has tries left; blocked always. An empty page is done once confirmed (an ok page came after it,
 * or the run ended normally); one still `unconfirmed` (the run stopped in the middle of a run of empty
 * pages) is read again, and so is any empty page with `retryEmpty` or when it was read by another browser.
 * With `retryEmpty`, an ok page that read no child row (its list may have rendered late) is read again too.
 */
export function needsDetailFetch(entry, maxAttempts, { browser = null, retryEmpty = false } = {}) {
  if (!entry) return true
  if (retryEmpty && entry.status === 'ok' && Array.isArray(entry.children) && !entry.children.length) return true
  if (entry.status === 'blocked') return true
  if (entry.status === 'failed') return Number(entry.attempts ?? 0) < maxAttempts
  if (entry.status === 'empty' && !entry.notFound) return Boolean(entry.unconfirmed || retryEmpty || (browser && entry.browser && entry.browser !== browser))
  return false
}

/**
 * The checkpoint (one JSON object per line, appended as pages finish) as url → latest entry. A line that
 * does not parse (the run was killed while writing it) is skipped. With `specKey`, entries read with
 * another spec are left out (so those pages are read again); `stale` counts those URLs.
 * → { entries: Map, stale }
 */
/** How many checkpoint lines keep a record excerpt for each detail column (the summary quotes one per column). */
export const RECORD_TEXT_KEEP = 3

/**
 * Decides which ok pages keep their record excerpt in the checkpoint: a page keeps it while some column it
 * read blank has fewer than `limit` excerpts kept so far. A wrong selector would otherwise store the text of
 * every page. `entries`: the checkpoint already read (current spec only). → (result) => boolean, which counts
 * the excerpt it keeps.
 */
export function recordTextKeeper(entries, detailNames, limit = RECORD_TEXT_KEEP) {
  // A page with a child list and no child row counts as one more blank column.
  const blankIn = page => [...detailNames.filter(name => String(page.fields?.[name] ?? '') === ''), ...(Array.isArray(page.children) && !page.children.length ? [NO_CHILDREN] : [])]
  return excerptKeeper(entries, limit, 'recordText', blankIn)
}

/** recordTextKeeper's name for "no child row on the page". */
const NO_CHILDREN = '#children'

/**
 * The same for child-row excerpts (`childText`): kept for the first few pages per child column it shows blank.
 * → (result) => boolean
 */
export function childTextKeeper(entries, childNames, limit = RECORD_TEXT_KEEP) {
  const blankIn = page => {
    const row = page.children?.[Number(page.childText?.index) - 1]
    return row ? childNames.filter(name => String(row[name] ?? '') === '') : []
  }
  return excerptKeeper(entries, limit, 'childText', blankIn)
}

/** Keep `page[key]` while one of the columns it shows blank (`blankIn(page)`) has fewer than `limit` kept. */
function excerptKeeper(entries, limit, key, blankIn) {
  const kept = new Map()
  const count = name => kept.get(name) ?? 0
  for (const entry of entries.values()) {
    if (entry.status !== 'ok' || !entry[key]) continue
    for (const name of blankIn(entry)) kept.set(name, count(name) + 1)
  }
  return result => {
    if (result.status !== 'ok' || !result[key]) return false
    const blanks = blankIn(result)
    if (!blanks.some(name => count(name) < limit)) return false
    for (const name of blanks) kept.set(name, count(name) + 1)
    return true
  }
}

export function readDetailCheckpoint(text, specKey = null) {
  const entries = new Map()
  const stale = new Set()
  for (const line of String(text ?? '').split('\n')) {
    if (!line.trim()) continue
    let entry
    try {
      entry = JSON.parse(line)
    } catch {
      continue // a half-written last line
    }
    if (!entry || typeof entry.url !== 'string') continue
    if (specKey && entry.spec !== specKey) {
      entries.delete(entry.url)
      stale.add(entry.url)
      continue
    }
    entries.set(entry.url, entry)
    stale.delete(entry.url)
  }
  return { entries, stale: stale.size }
}

/**
 * The output rows: every list row in order, with the detail columns and the status column added. A row
 * without a usable link is "no-link"; a link not fetched yet is "pending"; detail cells are filled only
 * from ok pages (a row whose page failed keeps its list data).
 */
export function mergeDetailRows(listRows, linkColumn, detailNames, entries, statusColumn = DETAIL_STATUS_COLUMN, countColumn = null) {
  return listRows.map(row => {
    const url = detailLink(row[linkColumn])
    const entry = url ? entries.get(url) : null
    const status = !url ? 'no-link' : entry ? entry.status : 'pending'
    const detail = Object.fromEntries(detailNames.map(name => [name, status === 'ok' ? String(entry.fields?.[name] ?? '') : '']))
    // The child count: "0" on an ok page without child rows, blank on a page not read ok.
    // Blank too where the children could not be read (childError): the count is not known.
    const count = countColumn ? { [countColumn]: status === 'ok' && !entry.childError ? String(entry.children?.length ?? 0) : '' } : {}
    return { ...row, ...detail, ...count, [statusColumn]: status }
  })
}

/**
 * The child table's rows: for each list row (in order) whose page read ok, one row per child, keyed by the row's
 * link cell (`parent_link`), its 1-based row number in the main CSV (`parent_row`) and the child's 1-based place on
 * the page (`child_index`). A link in several rows is read once; its children are listed under each of those rows,
 * so every main row's count equals its child rows here.
 */
export function mergeChildRows(listRows, linkColumn, childNames, entries) {
  const out = []
  for (const [i, row] of listRows.entries()) {
    const url = detailLink(row[linkColumn])
    const entry = url ? entries.get(url) : null
    if (entry?.status !== 'ok') continue
    for (const [k, child] of (entry.children ?? []).entries()) {
      out.push({ parent_link: String(row[linkColumn] ?? ''), parent_row: String(i + 1), child_index: String(k + 1), ...Object.fromEntries(childNames.map(name => [name, String(child[name] ?? '')])) })
    }
  }
  return out
}
