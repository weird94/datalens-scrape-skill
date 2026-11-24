// The collection loop, written against Playwright's `page` only, so the same code runs
//   - in collect.mjs's own Node process (bundled headless browser), or
//   - inside `playwright-cli run-code` attached to the user's Chrome (stringified, see collect.mjs).
// Keep it self-contained: no closures over module scope. Everything it needs comes in through `lib`
// ({ settle, gotoAndSettle, runSetup, installDlk }), except rowIdentity, which collect.mjs ships next to it.
import { rowIdentity } from './row-identity.mjs'

export async function collectOnPage(page, config, lib) {
  const { settle, gotoAndSettle, runSetup, installDlk } = lib
  // Optional host hooks: progress after each round (the round, and the rows and rounds so far), progress after
  // each read of the page (the rows and rounds so far, also half-way through a round), and an external stop
  // (user, points budget).
  const onRound = lib.onRound ?? (() => undefined)
  const onRows = lib.onRows ?? (() => undefined)
  const shouldStop = lib.shouldStop ?? (() => null)
  // Optional: asked whether the list really ended when the rules want to stop (see confirmEnd below).
  const confirmStop = lib.confirmStop ?? null
  // Optional: run in chunks. `pauseAfter` ({ steps, ms }) returns { paused: true, state } once that many turns
  // of the paging loop (or that much time) have passed; `resume` is such a state (as JSON, from another
  // process too): the next call goes on in the same tab, without loading the page or running setup again, and
  // ends as one uninterrupted run would have.
  const pauseAfter = lib.pauseAfter ?? null
  const resume = lib.resume ?? null
  // Optional: go on with a run an earlier process saved (collect.mjs --resume, lib/resume.mjs). `seedRows` are its
  // rows; `resumeAt` says how: { how: 'continued', pages, turn, url, rows, keys } opens the page after the last one
  // it finished (next.type url) or that page itself, checked to show the same rows, then clicks on (next.type
  // click); { how: 'from-start' } reads the list from the top. Both carry the earlier run's `rounds`, `claimed`,
  // `mergedByLink` and `mergedSameRecord`, so the result reads as one run. Ignored when `resume` is given.
  const resumeAt = resume ? null : lib.resumeAt ?? null
  // Optional: called at each page boundary with where the run stands (`position`, also in the result) and
  // { resumed }, for a host that saves it so a later process can go on from there.
  const onPage = lib.onPage ?? (() => undefined)
  const chunkStarted = Date.now()
  const maxPages = Number(config.maxPages ?? 50)
  const maxRows = Number(config.maxRows ?? 0)
  const next = config.next ?? null
  const fields = config.fields ?? {}
  const required = config.require ?? []
  const dedupeKeys = [].concat(config.dedupe ?? Object.keys(fields)) // "dedupe": "link" works too
  const waitSel = config.waitFor ?? config.rows
  const STAGNANT_LIMIT = Number(config.stagnantRounds ?? 3)
  const QUIET_MS = Number(config.quietMs ?? next?.quietMs ?? 1500)
  const DELAY_MS = Number(config.delayMs ?? 500)

  const rows = []
  const seen = new Set()
  const rounds = [...(resumeAt?.rounds ?? [])]
  let stopReason = null
  let note = ''
  let setupLog = null
  let lastStatus = null
  let claimed = [...(resumeAt?.claimed ?? [])]
  /** Rows link to pages of their own but no field reads a link (checked once, on page 1). */
  let unreadLinks = null
  /** Texts and images the first rows show that no field reads (checked once, on page 1). */
  let unreadParts = null
  let lastScroll = null
  // Where the run stands, for a later process to go on from (see `onPage`): set at each page boundary once a
  // page of this run is loaded. `urlPerPage`: every next click so far went to another URL (null before the first).
  let position = null
  let pageLoaded = false
  let urlPerPage = null
  /** The page the first rows were noted for, and their hashes. */
  let keysPage = 0
  let pageKeys = []
  /** How this run went on from an earlier one (lib.resumeAt): { how, at?, note? }. */
  let resumed = resumeAt ? { how: resumeAt.how } : null

  /** Retry page.evaluate across navigations; inject the page helpers if this document lacks them. */
  async function inPage(fn, arg) {
    for (let attempt = 0; attempt < 6; attempt += 1) {
      try {
        if (!(await page.evaluate(() => !!window.__dlk))) await page.evaluate(installDlk)
        return await page.evaluate(fn, arg)
      } catch (error) {
        if (!/context was destroyed|navigat|Target closed|__dlk/i.test(String(error.message))) throw error
        await page.waitForLoadState('load', { timeout: 10_000 }).catch(() => undefined)
      }
    }
    throw new Error('page kept navigating')
  }

  /** False when the browser is not drawing the tab (minimized / covered window, background tab). */
  const isRendering = () =>
    page
      .evaluate(() => new Promise(resolve => {
        requestAnimationFrame(() => resolve(true))
        setTimeout(() => resolve(false), 1500)
      }))
      .catch(() => true)

  const rowCount = () => inPage(sel => window.__dlk.count(sel), config.rows)

  async function waitForRows(timeoutMs = Number(config.waitTimeoutMs ?? 15_000)) {
    const deadline = Date.now() + timeoutMs
    while (Date.now() < deadline) {
      const n = await inPage(sel => window.__dlk.count(sel), waitSel).catch(() => 0)
      if (n > 0) {
        await settle(page, { quietMs: 800, maxMs: 6000 })
        return n
      }
      await page.waitForTimeout(400)
    }
    return 0
  }

  async function dismiss() {
    if (!config.dismiss?.length && config.autoDismiss === false) return 0
    const n = await inPage(([sel, auto, rowsSel]) => window.__dlk.dismiss(sel, auto, rowsSel), [config.dismiss ?? [], config.autoDismiss !== false, config.rows]).catch(() => 0)
    if (n > 0) await settle(page, { quietMs: 600, maxMs: 3000 })
    return n
  }

  // Links that differ only in tracking parameters (&pp=, utm_*, &si=, …) or the #fragment are the
  // same item: compare them without those. The CSV keeps the link as read.
  const TRACKING = /^(utm_.*|pp|si|feature|fbclid|gclid|dclid|msclkid|yclid|igsh.*|ref|ref_.*|refsrc|spm|scm|share.*|trk|tracking.*|_ga.*|_gl|mc_.*|sr|qid|sprefix|crid|ved|ei|sxsrf|t|time_continue|ab_channel|vd_source|from|source|src)$/i
  const normLink = v => {
    if (!/^https?:\/\//i.test(v)) return v
    try {
      const u = new URL(v)
      u.hash = ''
      for (const name of [...u.searchParams.keys()]) if (TRACKING.test(name)) u.searchParams.delete(name)
      u.searchParams.sort()
      return u.href
    } catch {
      return v
    }
  }
  let mergedByLink = Number(resumeAt?.mergedByLink ?? 0)
  const keyOf = rec => JSON.stringify(dedupeKeys.map(k => normLink(String(rec[k] ?? ''))))
  const rawKeyOf = rec => JSON.stringify(dedupeKeys.map(k => rec[k] ?? ''))
  const rawSeen = new Set()
  const fillDown = config.fillDown ?? []
  let previous = null

  /** Empty, or only the field's `default`: the page showed nothing for this cell. */
  const blank = (key, value) => value === '' || (typeof fields[key] === 'object' && fields[key]?.default !== undefined && value === String(fields[key].default))
  // Which record a row is: what it says, not its pictures or the numbers that tick (likes, prices, "3 hours
  // ago") — an avatar that loads once the row is on screen, or a count that went up, leaves the record as it
  // was. Those cells, and empty ones, are left out when a row read again is recognised.
  const { isLiveNumber, isMediaUrl } = rowIdentity()
  const MEDIA_ATTRS = new Set(['src', 'srcset', 'currentSrc', 'data-src', 'data-srcset', 'data-original', 'data-lazy-src', 'data-url', 'poster'])
  const mediaColumns = new Set(Object.keys(fields).filter(key => typeof fields[key] === 'object' && MEDIA_ATTRS.has(String(fields[key]?.attr ?? ''))))
  const loose = (key, value) => mediaColumns.has(key) || isMediaUrl(value) || isLiveNumber(value)
  const ANY = '\u0000~'
  /** The row's identity without its loose cells; null when nothing but loose cells is left (no name to go by). */
  const stableKeyOf = rec => {
    let named = false
    const parts = dedupeKeys.map(k => {
      const value = String(rec[k] ?? '')
      if (blank(k, value) || loose(k, value)) return ANY
      named = true
      return normLink(value)
    })
    return named ? JSON.stringify(parts) : null
  }
  /** Rows by their identity without loose cells. */
  const rowsByStable = new Map()
  const indexRow = row => {
    const key = stableKeyOf(row)
    if (!key) return
    if (!rowsByStable.has(key)) rowsByStable.set(key, new Set())
    rowsByStable.get(key).add(row)
  }
  const unindexRow = row => {
    const key = stableKeyOf(row)
    if (key) rowsByStable.get(key)?.delete(row)
  }
  /** The row each element was read as, for the whole run (element ids carry their document). */
  const rowById = new Map()
  /** The element a row was last read from, and the page turn it was last read in. */
  const elementOf = new Map()
  const turnOf = new Map()
  /** Page turns so far (a next click that changed the list, a URL page): look-alikes on two pages are two records. */
  let turn = 0
  /** Rows recognised as a record read before, from another element or the preview, apart from their loose cells. */
  let mergedSameRecord = Number(resumeAt?.mergedSameRecord ?? 0)
  /** A short hash of a row's identity (without its loose cells when it has a name): which rows a page showed. */
  const rowHash = rec => {
    const text = stableKeyOf(rec) ?? keyOf(rec)
    let hash = 5381
    for (let i = 0; i < text.length; i += 1) hash = ((hash << 5) + hash + text.charCodeAt(i)) | 0
    return (hash >>> 0).toString(36)
  }

  // Rows the host already collected from this page (its preview run): they start the result.
  const rowByKey = new Map()
  for (const rec of resume ? [] : lib.seedRows ?? []) {
    const key = keyOf(rec)
    if (seen.has(key)) continue
    seen.add(key)
    rawSeen.add(rawKeyOf(rec))
    rowByKey.set(key, rec)
    rows.push(rec)
    indexRow(rec)
    turnOf.set(rec, 0)
  }
  let seeded = rows.length
  /** Seeded rows not read again yet in this run: reading one is progress (a page saved before is not an empty page). */
  const seedLeft = new Set(rows)
  // Read again from the top (--resume, resumed.how 'from-start'), the saved rows carry no page turn: one not read
  // again yet may be on any page, so it is recognised there too (a count or price changed since it was saved).
  const savedAnyTurn = row => resumed?.how === 'from-start' && seedLeft.has(row)

  // Expanding: a pass clicks every expander not clicked yet, waits for what it brings, and the rows are
  // read again after each pass — a per-record "next page" replaces the replies it showed, so they are
  // kept as they come. Passes stop when nothing is left to click, or after two passes that brought nothing.
  const EXPAND_PASSES = 40
  const EXPAND_WAIT_MS = 8000
  const EXPAND_LATE_MS = 1500
  /** How long to wait for more rows to show after a scroll before reading what is there. */
  const SCROLL_WAIT_MS = 4000
  // Rows on the page went down after an expand pass that brought no new rows: an expand selector also
  // matched something that hides content (a "收起" / "Hide" button sharing the expand button's class).
  // First occurrence only.
  let expandShrank = null
  /** Controls among the rows that say "more" / "next" and that expand did not click (first page). */
  let expandMissed = []
  /** "Previous" controls among the rows before the first expand click: records paged past their first page. */
  let expandPastStart = []
  /** Expand clicks so far. */
  let expandClicks = 0
  /** Expand clicks on the first page that did nothing: { clicked, stale, left }. */
  let expandNoEffect = null
  /** selector → label shape → { label, clicks }: the controls expand clicked, kept across pages (the page's own count resets on navigation). */
  const expandClicked = new Map()
  const noteExpandClicks = taken => {
    for (const { selector, labels } of taken) {
      let shapes = expandClicked.get(selector)
      if (!shapes) expandClicked.set(selector, (shapes = new Map()))
      for (const { shape, label, clicks } of labels) {
        const seen = shapes.get(shape)
        if (seen) seen.clicks += clicks
        else shapes.set(shape, { label, clicks })
      }
    }
  }
  let harvests = 0
  const contentMark = () => inPage(sel => window.__dlk.contentMark(sel), config.rows).catch(() => '')

  /**
   * The host's stop (the user, the points budget), asked between pages and between expand passes: a record's
   * own pager (hundreds of pages of replies) keeps one round going for a long time. → whether to stop now;
   * the reason is the run's stop reason, and whoever called harvest() ends the run without asking anything more.
   */
  async function hostStops() {
    const external = await shouldStop(rows.length)
    if (external) stopReason = external
    return Boolean(external)
  }

  /** After a click: wait until the page shows something new (or `maxMs`), then until it is quiet. */
  async function waitForChange(before, maxMs = EXPAND_WAIT_MS) {
    const deadline = Date.now() + maxMs
    while (Date.now() < deadline && (await contentMark()) === before) await page.waitForTimeout(250)
    await settle(page, { quietMs: 800, maxMs: 5000 })
  }

  /**
   * Keep the new rows of a batch read from the page. `rowById` maps the element a row was read from to
   * the row kept for it: read again, in this round or a later one, that row is updated in place. With
   * `ordered`, new rows go in page order — before the next row already kept — so replies stay under the
   * comment they answer.
   */
  const CUT = /\s*(…|\.{3})?\s*(展开全文|展开|全文|read more|see more|show more|more)?\s*$/i
  /** How much a cut-off text may put before the text it shortens: a label such as "<writer>: ". */
  const CUT_LABEL_MAX = 40
  /** Characters at the cut that may differ from the whole text (an entity or a character cut in half). */
  const CUT_RAGGED = 4
  /** Shortest stretch of a cut-off text the whole one must start with to be the same text: a one-line answer
   *  is cut-marked too ("<writer>: <the whole line>…"). The record's other cells must still match. */
  const CUT_MIN_MATCH = 8
  /** A label in front of a cut-off text ends at a space or a punctuation mark ("<writer>: ", "<writer>："). */
  const LABEL_END = /[\s\p{P}]/u
  /** A text the page shortened: it ends with an ellipsis, maybe followed by its "read more" label. */
  const ELLIPSIS_CUT = /(…|\.{3})\s*(展开全文|展开|全文|read more|see more|show more|more)?\s*$/i
  const squash = text => text.replace(/\s+/g, '')
  /** Did a cell's text grow (a cut-off text now whole), rather than change into something else? */
  function grew(was, now) {
    const stem = was.replace(CUT, '').replace(/(…|\.{3})$/, '').trim()
    if (!stem) return false
    const cut = stem.length < was.trim().length
    // "用户 8-1" → "用户 8-11" is another record: without a cut mark, only a clearly longer text grew.
    if (now.startsWith(stem)) return cut || now.length >= stem.length + 10
    // A collapsed record often puts a label before its text ("<writer>: <the text>", cut off or whole when
    // short): the opened text starts with what follows the label. Spacing may differ (a teaser puts spaces
    // around inline links and code that the opened text runs together), so it is compared without spaces.
    const whole = squash(now)
    for (let skip = 0; skip <= CUT_LABEL_MAX && stem.length - skip >= CUT_MIN_MATCH; skip += 1) {
      if (skip > 0 && !LABEL_END.test(stem[skip - 1])) continue
      const body = squash(stem.slice(skip))
      const same = commonPrefixLength(body, whole)
      if (same < CUT_MIN_MATCH) continue
      if (skip > 0 && same === body.length) return true
      // A cut-off text whose last few characters differ at the cut (an entity or a character cut in half):
      // only when the whole text is clearly longer — "Episode 12…" → "Episode 13…" is another record.
      if (cut && same >= body.length - CUT_RAGGED && whole.length >= body.length + 10) return true
    }
    return false
  }
  function commonPrefixLength(a, b) {
    let i = 0
    while (i < a.length && i < b.length && a[i] === b[i]) i += 1
    return i
  }
  /**
   * The same element read again. The same record when every cell stayed, grew, got filled, went empty (a
   * "12 replies" label gone once the replies are open), or is a loose cell that changed (likes went up, the
   * avatar loaded) while a cell that names the record stayed: its cells are merged, keeping what the page no
   * longer shows and the latest counts. Null when a named cell turned into another value — the page reused
   * the element for another record.
   */
  function mergeRead(kept, rec) {
    const merged = {}
    let named = false
    let moved = false
    for (const key of Object.keys(rec)) {
      const was = String(kept[key] ?? '')
      const now = String(rec[key] ?? '')
      if (was === now || blank(key, was)) {
        merged[key] = now
        if (was === now && !blank(key, now) && !loose(key, now)) named = true
      } else if (blank(key, now)) merged[key] = was
      else if (grew(was, now)) {
        merged[key] = now
        named = true
      } else if (typeof fields[key] === 'object' && fields[key]?.all) merged[key] = unionJoined(was, now, fields[key].join ?? ' | ')
      else if (loose(key, was) && loose(key, now)) {
        merged[key] = now
        moved = true
      } else return null
    }
    // Only counts or pictures changed and nothing names the record: as likely another record in this element.
    return moved && !named ? null : merged
  }
  /** A record read before from another element (or by the preview), apart from its loose cells: newer counts and pictures win. */
  function mergeLoose(kept, rec) {
    const merged = { ...kept }
    for (const key of Object.keys(rec)) {
      const was = String(kept[key] ?? '')
      const now = String(rec[key] ?? '')
      if (!blank(key, now) && (blank(key, was) || loose(key, now))) merged[key] = now
    }
    return merged
  }
  /** A kept row with its empty cells taken from a newer read of the same record, and which cells those are. */
  function fillBlanks(kept, rec) {
    const merged = { ...kept }
    const keys = []
    for (const key of Object.keys(rec)) {
      const now = String(rec[key] ?? '')
      if (blank(key, String(kept[key] ?? '')) && !blank(key, now)) {
        merged[key] = now
        keys.push(key)
      }
    }
    return { merged, keys }
  }
  /** Give a kept row new values and keep the indexes right. False when that would make it another row's twin. */
  function rewrite(row, values) {
    const oldKey = keyOf(row)
    const newKey = keyOf(values)
    if (newKey !== oldKey && seen.has(newKey)) return false
    unindexRow(row)
    if (newKey !== oldKey) {
      seen.delete(oldKey)
      rowByKey.delete(oldKey)
      seen.add(newKey)
      rawSeen.add(rawKeyOf(values))
      rowByKey.set(newKey, row)
    }
    Object.assign(row, values)
    indexRow(row)
    return true
  }
  /** An `all` field whose items were replaced (a pager inside the record): the items seen so far, in order. */
  function unionJoined(was, now, join) {
    const items = was.split(join)
    const have = new Set(items)
    for (const item of now.split(join)) {
      if (have.has(item)) continue
      have.add(item)
      items.push(item)
    }
    return items.join(join)
  }
  /** Rows whose element showed other values after an expand click; their first values were kept. */
  const replacedOnReread = new Set()
  /** Per column whose value such a row kept: the rows, and the first change seen (a snippet around it). */
  const replacedCells = new Map()
  /** Columns such rows had empty and took from the opened record, with how many rows. */
  const filledOnReread = new Map()
  const REPLACED_SNIPPET = 40
  /** Note the cells a kept row keeps its first value of (they changed into something else); returns their keys. */
  function noteReplacedCells(kept, rec) {
    const keys = []
    for (const key of Object.keys(rec)) {
      const was = String(kept[key] ?? '')
      const now = String(rec[key] ?? '')
      if (was === now || blank(key, was) || blank(key, now) || grew(was, now) || loose(key, was) || loose(key, now)) continue
      if (typeof fields[key] === 'object' && fields[key]?.all) continue
      keys.push(key)
      let entry = replacedCells.get(key)
      if (!entry) {
        const at = commonPrefixLength(was, now)
        const from = Math.max(0, at - 10)
        const snip = text => (from > 0 ? '…' : '') + text.slice(from, from + REPLACED_SNIPPET) + (text.length > from + REPLACED_SNIPPET ? '…' : '')
        entry = { column: key, rows: new Set(), was: snip(was), now: snip(now) }
        replacedCells.set(key, entry)
      }
      entry.rows.add(kept)
    }
    return keys
  }

  function absorb(batch, ordered) {
    let added = 0
    let filtered = 0
    // Rows kept earlier whose cells changed on this read (replies joined into a row that just opened).
    let updated = 0
    // Rows on the page left unread because maxRows was reached (not duplicates, not filtered).
    let cut = 0
    // Seeded rows read for the first time in this run.
    let known = 0
    const reread = row => {
      if (seedLeft.delete(row)) known += 1
    }
    let pending = []
    /** The saved row (not read again yet, on this page) that `row` read as `values` is, when their keys meet. */
    const savedTwin = (row, values) => {
      const key = keyOf(values)
      if (key === keyOf(row)) return null
      const other = rowByKey.get(key)
      return other && other !== row && seedLeft.has(other) && (turnOf.get(other) === turn || savedAnyTurn(other)) ? other : null
    }
    /** Take a row this run added back out (it was a saved row read in another state). */
    const drop = row => {
      const at = pending.indexOf(row)
      if (at >= 0) pending.splice(at, 1)
      else if (rows.includes(row)) rows.splice(rows.indexOf(row), 1)
      unindexRow(row)
      seen.delete(keyOf(row))
      rowByKey.delete(keyOf(row))
      elementOf.delete(row)
      turnOf.delete(row)
      for (const [id, held] of rowById) if (held === row) rowById.delete(id)
      added -= 1
    }
    const flush = before => {
      if (!pending.length) return
      const at = ordered && before ? rows.indexOf(before) : -1
      if (at >= 0) rows.splice(at, 0, ...pending)
      else rows.push(...pending)
      pending = []
    }
    for (const { rec } of batch) {
      for (const key of fillDown) {
        if (!rec[key] && previous) rec[key] = previous[key]
      }
      previous = rec
    }
    // How many elements of this read carry each key. With several (the same words posted twice in a row, or
    // under several records), which of them a kept row came from is unknown: none of them says where new rows go.
    const sameKey = new Map()
    // Likewise without loose cells: two elements of one read that differ only in counts or pictures are two records.
    const sameStable = new Map()
    for (const { rec } of batch) {
      const key = keyOf(rec)
      sameKey.set(key, (sameKey.get(key) || 0) + 1)
      const stable = stableKeyOf(rec)
      if (stable) sameStable.set(stable, (sameStable.get(stable) || 0) + 1)
    }
    /** Rows this read has matched an element to: no second element of the read is the same record. */
    const claimed = new Set()
    const bind = (row, id) => {
      rowById.set(id, row)
      elementOf.set(row, id)
      turnOf.set(row, turn)
      claimed.add(row)
    }
    /** The first row after `from` in this read that is already placed in the result: new rows go before it. */
    const placedAfter = from => {
      for (let i = from + 1; i < batch.length; i += 1) {
        const key = keyOf(batch[i].rec)
        const row = rowById.get(batch[i].id) || (sameKey.get(key) === 1 ? rowByKey.get(key) : null)
        if (row && !pending.includes(row)) return row
      }
      return null
    }
    for (const [index, { id, rec }] of batch.entries()) {
      // The same element read again on this page: the same row unless a named cell turned into another value.
      // After a page turn an element may show the next page's record: then only an exact twin is the same row.
      const held = rowById.get(id)
      const kept = held && turnOf.get(held) === turn ? held : undefined
      const merged = kept ? mergeRead(kept, rec) : null
      // A record read collapsed in this run that, opened, is a row an earlier run saved (--resume, read again from
      // the top): that saved row is the record, and the collapsed copy goes.
      const twin = merged ? savedTwin(kept, merged) : null
      if (twin) {
        drop(kept)
        reread(twin)
        const again = mergeRead(twin, rec)
        if (again) rewrite(twin, again)
        bind(twin, id)
        flush(twin)
        continue
      }
      if (merged) {
        const changed = Object.keys(merged).filter(k => String(kept[k] ?? '') !== merged[k])
        const ok = changed.length > 0 && (keyOf(merged) === keyOf(kept) || !required.some(k => !merged[k])) && rewrite(kept, merged)
        // Progress is a cell that grew or got filled with what the record says, not a count that ticked or a picture that loaded.
        if (ok && changed.some(k => !loose(k, merged[k]))) updated += 1
        bind(kept, id)
        flush(kept)
        continue
      }
      if (required.some(k => !rec[k])) {
        filtered += 1
        continue
      }
      const key = keyOf(rec)
      const raw = rawKeyOf(rec)
      if (seen.has(key)) {
        if (!rawSeen.has(raw)) {
          mergedByLink += 1
          rawSeen.add(raw)
        }
        const existing = rowByKey.get(key)
        if (existing) {
          reread(existing)
          if (existing === kept) {
            // The same element and key showing other values after an expand click: the first values stay. When
            // every such cell was a cut-off text ("…") and now reads whole, the record was collapsed and is now
            // open: the cells only the opened record shows (empty before) are taken too. Not otherwise — a pager
            // inside the record shows other items, and their cells must not mix into the first item's.
            replacedOnReread.add(existing)
            const changed = noteReplacedCells(kept, rec)
            const opened = changed.length > 0 && changed.every(key => ELLIPSIS_CUT.test(String(kept[key])) && !ELLIPSIS_CUT.test(String(rec[key])))
            if (opened) {
              const { merged, keys } = fillBlanks(kept, rec)
              if (keys.length && rewrite(kept, merged)) {
                for (const key of keys) filledOnReread.set(key, (filledOnReread.get(key) || 0) + 1)
              }
            }
          }
          // The row this element stands for, and so the place new rows go before — unless other elements
          // of this read carry the same key: then it is one more copy, and the row may sit somewhere else.
          if (sameKey.get(key) === 1) {
            bind(existing, id)
            flush(existing)
          }
        }
        continue
      }
      // A record read before from an element that is gone or shows another record now (a list that draws its
      // rows again, a virtual list), or by the preview, whose count or picture has changed since. Only when
      // this read has no other element like it, that row is the only one like it, and no page was turned
      // since: look-alikes on two pages, or side by side, are two records.
      const stable = stableKeyOf(rec)
      const holders = stable && sameStable.get(stable) === 1 ? rowsByStable.get(stable) : null
      if (holders?.size === 1) {
        const [existing] = holders
        if (!claimed.has(existing) && (turnOf.get(existing) === turn || savedAnyTurn(existing)) && elementOf.get(existing) !== id && rewrite(existing, mergeLoose(existing, rec))) {
          reread(existing)
          mergedSameRecord += 1
          bind(existing, id)
          flush(existing)
          continue
        }
      }
      // Already at the limit (a read after the last clicks): this row and the rest stay unread.
      if (maxRows && rows.length + pending.length >= maxRows) {
        cut = batch.slice(index).filter(later => !rowById.has(later.id) && !seen.has(keyOf(later.rec))).length
        flush(placedAfter(index - 1))
        break
      }
      seen.add(key)
      rawSeen.add(raw)
      rowByKey.set(key, rec)
      indexRow(rec)
      bind(rec, id)
      pending.push(rec)
      added += 1
      if (maxRows && rows.length + pending.length >= maxRows) {
        // What is left of this read that no read has taken yet (elements, so copies of one row each count).
        cut = batch.slice(index + 1).filter(later => !rowById.has(later.id) && !seen.has(keyOf(later.rec))).length
        // The rows taken so far go where the page has them, not after everything read before.
        flush(placedAfter(index))
        break
      }
    }
    flush(null)
    return { added, filtered, cut, updated, known }
  }

  async function harvest(label) {
    harvests += 1
    const expanding = Boolean(config.expand?.length)
    const read = () => inPage(([sel, f]) => window.__dlk.extractTagged(sel, f), [config.rows, fields])
    let batch = await read()
    // The first rows of each page, to tell that page from another when a later process opens it again: rows no
    // earlier page showed (rows every page repeats, pinned or sponsored, would make any page look like it), hashed
    // as the page shows them (before fillDown fills them from the row above).
    if (keysPage !== pages) {
      keysPage = pages
      pageKeys = batch
        .filter(({ rec }) => !required.some(k => !rec[k]) && (!seen.has(keyOf(rec)) || seedLeft.has(rowByKey.get(keyOf(rec)))))
        .slice(0, 3)
        .map(({ rec }) => rowHash(rec))
    }
    let got = absorb(batch, expanding)
    await onRows({ rows, rounds })
    let added = got.added
    let known = got.known
    let cut = got.cut
    // Before the first click: a record whose own pager already shows a later page (someone paged it while
    // looking). Expand only goes forward, so what its earlier pages held is never read.
    if (expanding && harvests === 1) {
      expandPastStart = await inPage(sel => window.__dlk.unclickedAmongRows(sel, [], 2, 'prev'), config.rows).catch(() => [])
    }
    if (expanding) {
      // Passes in a row whose clicks brought nothing, and passes in a row with nothing to click.
      let idle = 0
      let lull = 0
      let clickedLast = 0
      let lastBefore = ''
      const take = read => {
        const onPageBefore = batch.length
        batch = read
        got = absorb(batch, true)
        added += got.added
        known += got.known
        cut = got.cut
        // Progress is new rows, or rows whose cells grew (one row per comment: opening replies adds none).
        const progress = got.added > 0 || got.updated > 0 || got.known > 0
        // Fewer rows right after clicks that brought nothing: one of them hides content. A record's own pager
        // also leaves fewer rows on its last page — but those are new rows.
        if (clickedLast && batch.length < onPageBefore && !progress && !expandShrank) {
          expandShrank = { from: onPageBefore, to: batch.length, at: label }
        }
        return progress
      }
      for (let pass = 0; pass < EXPAND_PASSES && !(maxRows && rows.length >= maxRows); pass += 1) {
        // Stopped by the host: no more clicks. What the last ones brought is still read below.
        if (await hostStops()) break
        // Read, then click, in one call to the page: a click that replaces what a record shows (its own
        // pager) can only replace rows this read has taken, however late their page arrived.
        const step = await inPage(
          ([sel, f, expand]) => {
            const read = window.__dlk.extractTagged(sel, f)
            const before = window.__dlk.contentMark(sel)
            return { read, before, clicked: window.__dlk.clickAll(expand, sel) }
          },
          [config.rows, fields, config.expand]
        ).catch(() => null)
        if (!step) break
        const progress = take(step.read)
        await onRows({ rows, rounds })
        clickedLast = step.clicked
        lastBefore = step.before
        if (!step.clicked) {
          // Nothing to click now. What the last clicks asked for may still be on its way (buttons disabled
          // or unchanged while it loads): wait for it once, and go round again while it keeps arriving.
          if (lull > 0 && !progress) break
          lull += 1
          const busy = await inPage(([expand, sel]) => window.__dlk.expandBusy(expand, sel), [config.expand, config.rows]).catch(() => 0)
          await waitForChange(step.before, busy ? EXPAND_WAIT_MS : EXPAND_LATE_MS)
          continue
        }
        lull = 0
        if (pass > 0) idle = progress ? 0 : idle + 1
        expandClicks += step.clicked
        await waitForChange(step.before)
        // Clicks that did nothing where the selector matched a wrapper around the one control: click that control.
        const beforeInner = await contentMark()
        const retried = await inPage(([expand, sel]) => window.__dlk.clickAll(expand, sel, 60, true), [config.expand, config.rows]).catch(() => 0)
        if (retried) await waitForChange(beforeInner)
        if (idle >= 2) break
      }
      // What the last clicks brought (the loop reads before it clicks). Stopped by the host: also what came in
      // while the last pass waited without clicking.
      if ((clickedLast || stopReason) && !(maxRows && rows.length >= maxRows)) {
        await waitForChange(lastBefore, EXPAND_LATE_MS)
        take(await read())
        await onRows({ rows, rounds })
      }
      noteExpandClicks(await inPage(() => window.__dlk.takeExpandClicks()).catch(() => []))
    }
    // Once, on the first page: what the expand selectors left closed among the rows (a record's own pager),
    // and whether their clicks did anything at all. Not after a stop by the host: it left them closed.
    if (expanding && harvests === 1 && !stopReason) {
      const skip = [...config.expand, ...(next?.selector ? [next.selector] : [])]
      expandMissed = await inPage(([sel, s]) => window.__dlk.unclickedAmongRows(sel, s), [config.rows, skip]).catch(() => [])
      const left = expandClicks > 0 ? await inPage(([expand, sel]) => window.__dlk.expandLeft(expand, sel), [config.expand, config.rows]).catch(() => null) : null
      if (left?.count) expandNoEffect = { clicked: expandClicks, stale: left.count, left: left.sample }
    }
    const entry = { round: rounds.length + 1, label, onPage: batch.length, filtered: got.filtered, added, ...(known ? { known } : {}), total: rows.length, ...(cut ? { cutAtMaxRows: cut } : {}) }
    rounds.push(entry)
    await onRound(entry, { rows, rounds })
    // Progress: new rows, or rows saved by an earlier run read for the first time in this one.
    return added + known
  }

  async function clickControl(selector, waitMs) {
    const mark = await inPage(c => window.__dlk.markFirstClickable(c), selector)
    if (!mark.usable) return 'missing'
    const before = await inPage(([s]) => ({ sig: window.__dlk.signature(s), doc: window.__dlk.DOC_ID }), [config.rows])
    await page.click('[data-dlk-target]', { timeout: 5000 }).catch(() => undefined)
    const deadline = Date.now() + waitMs
    while (Date.now() < deadline) {
      await page.waitForTimeout(300)
      const now = await inPage(([s]) => ({ sig: window.__dlk.signature(s), doc: window.__dlk.DOC_ID }), [config.rows]).catch(() => null)
      if (!now) continue
      if (now.doc !== before.doc) {
        await waitForRows()
        return 'navigated'
      }
      if (now.sig !== before.sig) {
        await settle(page, { quietMs: QUIET_MS, maxMs: 10_000 })
        return 'changed'
      }
    }
    return 'no-change'
  }

  // ---------- asking the host whether the list ended ----------
  // The rules stop on what they can count (rounds without new rows, a control gone). A host that passes
  // `confirmStop` is asked first; its answer decides: stop, wait, or do one thing on the page and go on. Without
  // an answer the rules decide, as they do without the hook.
  /** Rounds in a row the host was asked without a row arriving in between, after which the rules decide. */
  const MAX_ASKS_WITHOUT_ROWS = 3
  const STILL_LOADING_WAIT_MS = 5000
  const aiStop = { asks: 0, outcome: null, verdicts: [], userMessage: null, remedies: 0 }
  let asksWithoutRows = 0
  let rowsAtLastAsk = -1
  /** The host said more is coming but gave nothing to do: one more look, then end as possibly incomplete. */
  let incompleteAt = null
  /** After an answer that only asked to look again (still loading; more expected but nothing to do, or what was
   *  done brought nothing): one more round before the rules want to stop again, not their whole patience. */
  let lookOnce = false
  /** What a stall counter restarts from when the host says go on (`limit`: rounds the rules wait). */
  const resumeFrom = limit => {
    const from = lookOnce ? Math.max(0, limit - 1) : 0
    lookOnce = false
    return from
  }
  /** → true to stop with `reason`, false to go on (the caller restarts its counters with resumeFrom). */
  async function confirmEnd(reason) {
    if (!confirmStop) return true
    lookOnce = false
    if (rows.length > rowsAtLastAsk) asksWithoutRows = 0
    if (incompleteAt !== null) {
      if (rows.length <= incompleteAt) {
        aiStop.outcome = 'possibly-incomplete'
        return true
      }
      incompleteAt = null
    }
    if (asksWithoutRows >= MAX_ASKS_WITHOUT_ROWS) {
      aiStop.outcome = 'rules (asked without new rows)'
      return true
    }
    asksWithoutRows += 1
    rowsAtLastAsk = rows.length
    aiStop.asks += 1
    const evidence = await inPage(sel => window.__dlk.stopEvidence(sel), config.rows).catch(() => null)
    let advice = null
    try {
      advice = evidence
        ? await confirmStop({
            stopReason: reason,
            rowCount: rows.length,
            maxRows: maxRows || null,
            paging: next?.type ?? 'scroll',
            url: page.url(),
            headRows: rows.slice(0, 3),
            tailRows: rows.slice(-3),
            rounds: rounds.slice(-6),
            evidence: { tree: evidence.tree, snippets: evidence.snippets, listRootFound: evidence.listRootFound },
          })
        : null
    } catch {
      advice = null
    }
    const verdict = advice?.verdict ?? 'unavailable'
    aiStop.verdicts.push(verdict)
    if (advice?.userMessage) aiStop.userMessage = advice.userMessage
    switch (verdict) {
      case 'complete':
        aiStop.outcome = 'confirmed-complete'
        return true
      case 'wall':
        aiStop.outcome = 'wall'
        return true
      case 'still_loading':
        await page.waitForTimeout(STILL_LOADING_WAIT_MS)
        lookOnce = true
        return false
      case 'incomplete': {
        const before = rows.length
        if (advice.remedy && (await runRemedy(advice.remedy))) {
          lookOnce = rows.length === before
          return false
        }
        incompleteAt = rows.length
        lookOnce = true
        return false
      }
      default:
        aiStop.outcome = 'rules (no AI verdict)'
        return true
    }
  }
  /** Do what the host proposed, then read what it brought. → whether it was done. */
  async function runRemedy(remedy) {
    const before = await inPage(([s]) => ({ sig: window.__dlk.signature(s), doc: window.__dlk.DOC_ID }), [config.rows]).catch(() => null)
    const done = await inPage(([ref, action]) => window.__dlk.stopRemedy(ref, action), [remedy.ref, remedy.action]).catch(() => null)
    if (!done?.done) return false
    aiStop.remedies += 1
    const deadline = Date.now() + 8000
    while (Date.now() < deadline) {
      await page.waitForTimeout(300)
      const now = await inPage(([s]) => ({ sig: window.__dlk.signature(s), doc: window.__dlk.DOC_ID }), [config.rows]).catch(() => null)
      if (!now || !before) continue
      if (now.doc !== before.doc) {
        await waitForRows()
        break
      }
      if (now.sig !== before.sig) break
    }
    await settle(page, { quietMs: QUIET_MS, maxMs: 10_000 })
    const added = await harvest('after AI remedy')
    await inPage(came => window.__dlk.stopRemedyBrought(came), added > 0).catch(() => undefined)
    return true
  }

  /** Is the tab drawn? If not, stop with tab-not-rendering. → whether it is. */
  async function checkRendering() {
    if (await isRendering()) return true
    await page.bringToFront().catch(() => undefined)
    if (await isRendering()) return true
    stopReason = 'tab-not-rendering'
    note = 'the browser is not drawing this tab (window minimized or covered, or tab in the background), so clicks, scrolling and lazy loading stall. Ask the user to bring that Chrome window to the front and keep it visible during the run.'
    return false
  }

  /** Setup runs a second time in this browser (see reopen). */
  let setupAgain = false
  /** Load the start page and run setup. → whether that worked. */
  async function openStart() {
    lastStatus = await gotoAndSettle(page, config.url, { wait: Number(config.initialWaitMs ?? 0) })
    if (!(await checkRendering())) return false
    if (config.setup?.length) {
      await dismiss()
      // Setup clicks ask the page helpers which match is on screen.
      await inPage(() => true).catch(() => undefined)
      setupLog = await runSetup(page, setupAgain ? config.setup.map(step => ({ ...step, optional: true })) : config.setup)
      if (setupLog.error) {
        stopReason = 'setup-failed'
        note = setupLog.error
        return false
      }
    }
    return true
  }

  /** Load the page, run setup and read page 1 (the first call of a run only). */
  async function openPage() {
    pageLoaded = true
    await openStart()
    const initial = stopReason ? 0 : await waitForRows()
    await dismiss()
    if (stopReason) {
      // setup failed: nothing to harvest
    } else if (initial === 0) {
      stopReason = 'no-rows-on-first-page'
    } else {
      // Before anything is opened: what the rows show as they stand (a "12 replies" label is gone once they are open).
      unreadParts = await inPage(([sel, f]) => window.__dlk.unreadParts(sel, f), [config.rows, fields]).catch(() => null)
      await harvest('page 1')
      claimed = await inPage(sel => window.__dlk.claims(sel), config.rows).catch(() => [])
      unreadLinks = await inPage(([sel, f]) => window.__dlk.unreadLinks(sel, f), [config.rows, fields]).catch(() => null)
    }
    // Page 1 was read as it loaded; what scrolling it draws is read too.
    if (!stopReason && next && (next.type === 'click' || next.type === 'url') && (await reveal())) await harvest('page 1 (scrolled)')
  }

  /**
   * Go on where an earlier process stopped (resumeAt.how 'continued'). Setup runs on the start page first, as
   * it did then. Pages by URL: the loop loads the next page. Pages by click: the last page that run finished is
   * opened, and kept only when it shows that page's first rows at the same address; otherwise the list is read
   * from the top (the seeded rows are not added twice).
   */
  async function reopen() {
    pages = Number(resumeAt.pages)
    turn = Number(resumeAt.turn ?? 0)
    position = { pages, turn, url: resumeAt.url ?? null, rows: Number(resumeAt.rows ?? rows.length), keys: resumeAt.keys ?? [], urlPerPage: next?.type === 'click' ? true : null }
    if (config.setup?.length && !(await openStart())) return
    const goOn = () => {
      // Rows saved after that page were read from the next one: they are that page's rows, not look-alikes from another.
      rows.slice(position.rows).forEach(row => turnOf.set(row, turn + 1))
      // fillDown fills the next page's first cells from the last row of that page, as it did in one run.
      previous = rows[position.rows - 1] ?? null
    }
    if (next?.type === 'url') {
      resumed = { how: 'continued' }
      pageLoaded = Boolean(config.setup?.length)
      goOn()
      return
    }
    lastStatus = await gotoAndSettle(page, resumeAt.url, { wait: Number(config.initialWaitMs ?? 0) })
    if (!config.setup?.length && !(await checkRendering())) return
    const found = await waitForRows()
    await dismiss()
    const shown = found ? await inPage(([sel, f]) => window.__dlk.extractTagged(sel, f), [config.rows, fields]).catch(() => []) : []
    const hashes = new Set(shown.map(({ rec }) => rowHash(rec)))
    const keys = position.keys
    const same = keys.filter(key => hashes.has(key)).length >= Math.min(2, keys.length) && keys.length > 0
    const address = u => {
      try {
        const url = new URL(u)
        url.hash = ''
        url.searchParams.sort()
        return url.href
      } catch {
        return u
      }
    }
    const moved = address(page.url()) !== address(resumeAt.url)
    // A page past the first saved at the start page's address: a next click that went back to the start.
    const atStart = address(resumeAt.url) === address(config.url)
    if (found && same && !moved && !atStart) {
      resumed = { how: 'continued', at: resumeAt.url }
      pageLoaded = true
      urlPerPage = true
      keysPage = pages
      pageKeys = keys
      goOn()
      return
    }
    const why = !found ? 'showed none of the rows' : moved ? `went on to ${page.url()}` : atStart ? 'is the start page' : 'showed other rows than when it was read'
    resumed = { how: 'from-start', note: `the saved page ${resumeAt.url} ${why}: read the list again from the top; the saved rows were kept, and rows read again were not added twice` }
    pages = 1
    turn = 0
    position = null
    // Setup already ran once in this browser: a step that did something lasting (a cookie banner accepted) finds
    // nothing the second time, and is skipped rather than stopping the run.
    setupAgain = Boolean(config.setup?.length)
    await openPage()
  }

  // The paging loop's counters.
  let pages = 1
  let stagnant = 0
  let immobile = 0
  // Scrolling for more rows is the default, not a setting: with nothing said about more rows the list is
  // scrolled anyway, what scrolls it is left to the browser (the rows are scrolled into view), and a page
  // reached by a click or a URL is scrolled to its end before it is read (rows drawn only in view).
  const implicitScroll = !next
  const scrolls = implicitScroll || next.type === 'scroll'
  /** How many rows scrolling has brought. */
  let scrolledIn = 0
  const scrollOnce = () =>
    inPage(([s, st, rowsSel]) => window.__dlk.scrollStep(s, st, rowsSel), [next?.scroller ?? null, Number(next?.step ?? 0), config.rows])
  /** Whether pages of this list grow when scrolled (learnt on the first page that did). */
  let lazyPages = false
  /** Scroll a page reached by a click or a URL to the end of its rows, as long as that draws more of them.
   *  → whether it did. */
  async function reveal() {
    let grew = false
    for (let i = 0; i < 8; i += 1) {
      const had = await rowCount()
      const shown = await contentMark()
      const step = await scrollOnce().catch(() => ({ error: 'scroll failed' }))
      if (step.error) return grew
      await waitForChange(shown, lazyPages ? 2500 : 500)
      // A virtual list on a paged site: read at every stop, the rows above are gone by the next.
      if (step.virtual) await harvest(`page ${pages} (scrolled)`)
      else if ((await rowCount()) <= had) return grew
      if (stopReason) return grew
      if (step.virtual && step.atBottom) return grew
      grew = true
      lazyPages = true
    }
    return grew
  }

  // ---------- running in chunks ----------
  // Everything a later call needs to go on as if it had never stopped, as plain JSON: rows are referred to by
  // their place in `rows`. What follows from the rows (`seen`, `rowByKey`, `rowsByStable`) is rebuilt from them.
  // The page keeps its own part (element ids, what expand clicked) in window.__dlk while it does not navigate:
  // `doc` names that document, and a later call that finds another one (the tab navigated or reloaded between
  // calls) stops with the rows so far instead of going on against a page it knows nothing of.
  const STATE_VERSION = 3
  const docId = () => inPage(() => window.__dlk.DOC_ID).catch(() => null)
  async function snapshot() {
    const at = new Map(rows.map((row, index) => [row, index]))
    const ref = row => (at.has(row) ? at.get(row) : -1)
    return {
      version: STATE_VERSION,
      url: page.url(),
      doc: await docId(),
      rows,
      rowMeta: rows.map(row => [elementOf.get(row) ?? null, turnOf.get(row) ?? 0]),
      rowById: [...rowById].map(([id, row]) => [id, ref(row)]),
      rawSeen: [...rawSeen],
      previous: previous ? (at.has(previous) ? { row: at.get(previous) } : { rec: previous }) : null,
      rounds,
      counters: { pages, stagnant, immobile, scrolledIn, lazyPages, turn, harvests, seeded, mergedByLink, mergedSameRecord, expandClicks },
      run: { note, setupLog, lastStatus, claimed, unreadLinks, unreadParts, lastScroll },
      place: { position, pageLoaded, urlPerPage, keysPage, pageKeys, resumed, seedLeft: [...seedLeft].map(ref) },
      expand: {
        shrank: expandShrank,
        missed: expandMissed,
        pastStart: expandPastStart,
        noEffect: expandNoEffect,
        clicked: [...expandClicked].map(([selector, shapes]) => [selector, [...shapes]]),
        replaced: [...replacedOnReread].map(ref),
        replacedCells: [...replacedCells.values()].map(({ rows: kept, ...cell }) => ({ ...cell, rows: [...kept].map(ref) })),
        filled: [...filledOnReread],
      },
      aiStop: { ...aiStop, asksWithoutRows, rowsAtLastAsk, incompleteAt, lookOnce },
    }
  }
  async function restore(state) {
    if (state?.version !== STATE_VERSION) throw new Error(`cannot resume from this state (version ${state?.version}, expected ${STATE_VERSION})`)
    state.rows.forEach((row, index) => {
      const [element, rowTurn] = state.rowMeta[index] ?? [null, 0]
      rows.push(row)
      seen.add(keyOf(row))
      rowByKey.set(keyOf(row), row)
      indexRow(row)
      if (element !== null) elementOf.set(row, element)
      turnOf.set(row, rowTurn)
    })
    for (const [id, index] of state.rowById) if (rows[index]) rowById.set(id, rows[index])
    for (const raw of state.rawSeen) rawSeen.add(raw)
    previous = state.previous ? (state.previous.rec ?? rows[state.previous.row] ?? null) : null
    rounds.push(...state.rounds)
    ;({ pages, stagnant, immobile, scrolledIn, lazyPages, turn, harvests, seeded, mergedByLink, mergedSameRecord, expandClicks } = state.counters)
    ;({ note, setupLog, lastStatus, claimed, unreadLinks, unreadParts, lastScroll } = state.run)
    ;({ position, pageLoaded, urlPerPage, keysPage, pageKeys, resumed } = state.place)
    for (const index of state.place.seedLeft) if (rows[index]) seedLeft.add(rows[index])
    const ex = state.expand
    expandShrank = ex.shrank
    expandMissed = ex.missed
    expandPastStart = ex.pastStart
    expandNoEffect = ex.noEffect
    for (const [selector, shapes] of ex.clicked) expandClicked.set(selector, new Map(shapes))
    for (const index of ex.replaced) if (rows[index]) replacedOnReread.add(rows[index])
    for (const { rows: kept, ...cell } of ex.replacedCells) replacedCells.set(cell.column, { ...cell, rows: new Set(kept.map(index => rows[index]).filter(Boolean)) })
    for (const [column, count] of ex.filled) filledOnReread.set(column, count)
    const { asksWithoutRows: asks, rowsAtLastAsk: atAsk, incompleteAt: incomplete, lookOnce: once, ...stop } = state.aiStop
    Object.assign(aiStop, stop)
    asksWithoutRows = asks
    rowsAtLastAsk = atAsk
    incompleteAt = incomplete
    lookOnce = once
    const doc = await docId()
    if (!state.doc || doc !== state.doc) {
      throw new Error(`the tab navigated between calls (was ${state.url}, now ${page.url()}): the rows of the calls before are kept, the rest of the list was not read`)
    }
  }
  /** Has this call done its share (`steps`: page 1 and the turns of the loop it ran)? Never before it read something. */
  const chunkDone = steps =>
    Boolean(pauseAfter) && steps > 0 && ((pauseAfter.steps > 0 && steps >= pauseAfter.steps) || (pauseAfter.ms > 0 && Date.now() - chunkStarted >= pauseAfter.ms))

  /** At a page boundary (the top of the paging loop): note where the run stands, once per page. */
  async function notePosition() {
    if (!pageLoaded || (position && position.pages === pages && position.turn === turn)) return
    // The row limit reached on this page may have left part of it unread (rows past the limit, records not
    // expanded): it is not finished. The position stays at the page before, so a later run reads this one again
    // (the rows it already gave are not added twice).
    if (maxRows && rows.length >= maxRows) return
    position = { pages, turn, url: page.url(), rows: rows.length, keys: pageKeys, urlPerPage }
    await onPage(position, { resumed })
  }

  try {
    if (resume) await restore(resume)
    else if (resumeAt?.how === 'continued') await reopen()
    else await openPage()
    // A call that has loaded nothing yet (pages by URL, resumed) does not pause before its first page.
    let steps = resume || !pageLoaded ? 0 : 1
    while (!stopReason) {
      await notePosition()
      if (chunkDone(steps)) return { paused: true, state: await snapshot() }
      steps += 1
      if (await hostStops()) break
      if (maxRows && rows.length >= maxRows) {
        stopReason = 'max-rows'
        break
      }
      if (next?.type === 'none') {
        stopReason = 'single-page'
        break
      }
      if (pages >= maxPages) {
        if (next && (next.type === 'click' || next.type === 'load-more')) {
          const mark = await inPage(c => window.__dlk.markFirstClickable(c), next.selector).catch(() => ({ usable: true }))
          if (!mark.usable) {
            stopReason = next.type === 'click' ? 'next-control-gone' : 'load-more-gone'
            note = `reached maxPages (${maxPages}) and the next control is gone too`
            break
          }
        }
        stopReason = 'max-pages'
        break
      }
      if (pageLoaded) await dismiss()
      await page.waitForTimeout(DELAY_MS + Math.round(Math.random() * DELAY_MS))

      if (scrolls) {
        const shown = await contentMark()
        const countBefore = await rowCount()
        const step = await scrollOnce()
        lastScroll = step
        if (step.error) {
          stopReason = step.error
          break
        }
        // What the scroll asked for is a request: wait for it to show, then for the page to go quiet.
        await waitForChange(shown, implicitScroll && scrolledIn === 0 ? 2000 : SCROLL_WAIT_MS)
        pages += 1
        // Nothing moved and no row came: the rows are the ones already read. Reading them again would take
        // what changes on its own (a ticking price, a clock) for new rows.
        const drew = step.moved || (await rowCount()) !== countBefore
        const added = drew ? await harvest(`scroll ${pages - 1}`) : 0
        scrolledIn += added
        // Stopped by the host half-way through the round: the rules below have nothing to say.
        if (stopReason) break
        if (!step.moved && !step.atBottom) {
          immobile += 1
          if (immobile >= 3) {
            // Nothing said about more rows and the page does not move: it is what it is.
            const reason = implicitScroll && scrolledIn === 0 ? 'single-page' : 'scroll-blocked'
            if (await confirmEnd(reason)) {
              stopReason = reason
              break
            }
            immobile = 0
            stagnant = resumeFrom(STAGNANT_LIMIT)
            continue
          }
        } else {
          immobile = 0
        }
        stagnant = added === 0 && step.atBottom ? stagnant + 1 : 0
        // Nothing said about more rows: two rounds at the end of the list that bring none settle it (the
        // second also goes to the very bottom of the page). Asked to scroll: the usual patience.
        const patience = implicitScroll && scrolledIn === 0 ? 2 : STAGNANT_LIMIT
        if (stagnant >= patience) {
          const reason = implicitScroll && scrolledIn === 0 ? 'single-page' : 'scroll-end'
          if (await confirmEnd(reason)) stopReason = reason
          else stagnant = resumeFrom(patience)
        }
      } else if (next.type === 'click') {
        const urlBefore = page.url()
        const result = await clickControl(next.selector, Number(next.waitMs ?? 10_000))
        if (result === 'missing') {
          if (await confirmEnd('next-control-gone')) {
            stopReason = 'next-control-gone'
            break
          }
          stagnant = resumeFrom(STAGNANT_LIMIT)
          continue
        }
        if (result === 'no-change') {
          stagnant += 1
          if (stagnant >= 2) {
            if (await confirmEnd('next-click-no-effect')) {
              stopReason = 'next-click-no-effect'
              break
            }
            stagnant = resumeFrom(2)
          }
          continue
        }
        pages += 1
        turn += 1
        const urlChanged = page.url() !== urlBefore
        // No rows on the new page: unless the host says to wait or did something, that is the end. Either way the
        // next click would skip this page, so it is waited for here.
        if ((await rowCount()) === 0 && ((await confirmEnd('no-rows-after-page-turn')) || (await waitForRows(8000)) === 0)) {
          stopReason = 'no-rows-after-page-turn'
          break
        }
        await reveal()
        if (stopReason) break
        const added = await harvest(`page ${pages}${result === 'navigated' ? ' (navigated)' : ''}`)
        // A turn that brought rows: did it go to a URL of its own?
        if (added > 0) urlPerPage = (urlPerPage ?? true) && urlChanged
        if (stopReason) break
        stagnant = added === 0 ? stagnant + 1 : 0
        if (stagnant >= STAGNANT_LIMIT) {
          if (await confirmEnd('no-new-rows')) stopReason = 'no-new-rows'
          else stagnant = resumeFrom(STAGNANT_LIMIT)
        }
      } else if (next.type === 'load-more') {
        const result = await clickControl(next.selector, Number(next.waitMs ?? 8000))
        if (result === 'missing') {
          await settle(page, { quietMs: QUIET_MS * 2, maxMs: 12_000 })
          await harvest('after load-more gone')
          if (stopReason) break
          if (await confirmEnd('load-more-gone')) {
            stopReason = 'load-more-gone'
            break
          }
          stagnant = resumeFrom(STAGNANT_LIMIT)
          continue
        }
        pages += 1
        const added = await harvest(`load-more ${pages - 1}`)
        if (stopReason) break
        stagnant = added === 0 ? stagnant + 1 : 0
        if (stagnant >= STAGNANT_LIMIT) {
          if (await confirmEnd('load-more-no-new-rows')) stopReason = 'load-more-no-new-rows'
          else stagnant = resumeFrom(STAGNANT_LIMIT)
        }
      } else if (next.type === 'url') {
        pages += 1
        turn += 1
        const target = next.url.replace('{page}', String((next.start ?? 2) + pages - 2))
        lastStatus = await gotoAndSettle(page, target)
        pageLoaded = true
        if ((await waitForRows(8000)) === 0) {
          stopReason = 'url-page-empty'
          break
        }
        await reveal()
        if (stopReason) break
        const added = await harvest(`url page ${pages}`)
        if (stopReason) break
        if (added === 0 && (await confirmEnd('url-page-no-new-rows'))) stopReason = 'url-page-no-new-rows'
      } else {
        throw new Error(`unknown next.type: ${next.type}`)
      }
    }
  } catch (error) {
    stopReason = stopReason ?? 'error'
    note = String(error.message || error).split('\n')[0]
  }

  // Did a block / bot check / login wall cause this? Only replace the stop reason when nothing could be
  // read at that point; when the run stalled after collecting rows, report the wall next to the reason
  // (a dismissable "log in to see more" popup also looks like a wall).
  const NO_ROWS = ['no-rows-on-first-page', 'no-rows-after-page-turn', 'url-page-empty', 'setup-failed']
  const STALLED = ['next-click-no-effect', 'no-new-rows', 'load-more-no-new-rows', 'scroll-blocked', 'scroll-end', 'url-page-no-new-rows', 'error']
  let wall = null
  if (NO_ROWS.includes(stopReason) || STALLED.includes(stopReason)) {
    wall = await inPage(s => window.__dlk.wall(s), lastStatus).catch(() => null)
    if (wall && !wall.kind) wall = null
    if (wall && NO_ROWS.includes(stopReason)) {
      note = `${stopReason}${note ? ` (${note})` : ''} — page looks like a ${wall.kind === 'login' ? 'login wall' : 'block / bot check'}: ${wall.evidence}`
      stopReason = wall.kind === 'login' ? 'login-wall' : 'blocked'
    }
  }
  // Not the end? A limit stopped the run while more was still coming.
  let warning = ''
  const recent = rounds.slice(-3)
  // Rows saved by an earlier run (--resume) read again count: those pages were not empty.
  /** Rows a round brought: new ones, and saved ones an earlier run had (--resume) read again ("3+10 saved"). */
  const readIn = r => (r.known ? `${r.added}+${r.known} saved` : r.added)
  const stillAdding = recent.some(r => r.added > 0 || r.known > 0)
  if (stopReason === 'max-pages') {
    const why = next?.type === 'click' || next?.type === 'load-more'
      ? 'the next / load-more control is still there'
      : next?.type === 'scroll'
        ? stillAdding ? 'scrolling was still adding rows' : lastScroll && !lastScroll.atBottom ? 'the page could still scroll further' : ''
        : stillAdding ? 'the last pages still added rows' : ''
    if (why) warning = `NOT THE END: stopped at maxPages (${maxPages}) while ${why} (last rounds added ${recent.map(readIn).join(', ')}). If the user wants everything, rerun the same command with --resume --max-pages ${Math.max(50, maxPages * 4)}: it goes on from here.`
  } else if (stopReason === 'max-rows') {
    warning = `NOT THE END: stopped at maxRows (${maxRows}); the list may have more. If the user wants more, rerun the same command with --resume and a higher --max-rows.`
  }

  // Totals the page claims, compared with what we have. Read again at the end (some pages update them).
  const endClaims = rows.length ? await inPage(sel => window.__dlk.claims(sel), config.rows).catch(() => []) : []
  for (const c of endClaims) if (!claimed.some(x => x.n === c.n && x.text === c.text)) claimed.push(c)
  const bigger = claimed.filter(c => c.n >= rows.length * 1.25 && rows.length > 0)
  const totalCheck = !claimed.length
    ? undefined
    : claimed.some(c => Math.abs(c.n - rows.length) <= Math.max(1, rows.length * 0.05))
      ? `matches a count on the page (${claimed.map(c => `"${c.text}"`).join(', ')})`
      : bigger.length
        ? `page shows ${bigger.map(c => `"${c.text}"`).join(', ')} but ${rows.length} rows were collected — stopped early, or the number also counts things the list doesn't show (replies, hidden or deleted items)? Check before reporting.`
        : `counts on the page: ${claimed.map(c => `"${c.text}"`).join(', ')}`

  // Scrolling that stopped adding rows: maybe the wrong element was scrolled.
  let scrollCandidates
  // The last scroll added nothing (a preview has a single one; longer runs need the last two).
  const flat = rounds.length >= 2 && (rounds.length >= 3 ? rounds.slice(-2) : rounds.slice(-1)).every(r => r.added === 0 && !r.known)
  if (next?.type === 'scroll' && (flat || stopReason === 'scroll-blocked') && rows.length) {
    const found = await inPage(([s, c]) => window.__dlk.scrollCandidates(s, c), [config.rows, next.scroller ?? null]).catch(() => [])
    // Only worth showing when there is something other than what was scrolled.
    if (found.some(c => !c.configured)) scrollCandidates = found
  }

  const tail = await inPage(() => window.__dlk.bodyText().slice(-400)).catch(() => '')
  return { rows, rounds, stopReason, ...(confirmStop ? { aiStop } : {}), note, warning, totalCheck, claimed, mergedByLink, mergedSameRecord, scrollCandidates, setupLog, wall, tail, lastUrl: page.url(), seeded, position, resumed, expandShrank, expandReplaced: replacedOnReread.size, expandReplacedCells: [...replacedCells.values()].map(({ rows: kept, ...cell }) => ({ ...cell, rows: kept.size })), expandFilledCells: [...filledOnReread].map(([column, rows]) => ({ column, rows })), expandMissed, expandNoEffect, expandPastStart, expandClicked: [...expandClicked].map(([selector, shapes]) => ({ selector, clicks: [...shapes.values()].reduce((sum, seen) => sum + seen.clicks, 0), labels: [...shapes.values()].sort((a, b) => b.clicks - a.clicks).map(seen => seen.label) })), unreadLinks, unreadParts }
}
