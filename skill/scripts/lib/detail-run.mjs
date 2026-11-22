// The detail-page scheduler (which pages to read, in what order, when to stop), without any I/O: detail.mjs
// drives it from Node with its checkpoint file, and a host without a file system (the extension) drives it with
// its own store through `persist`. It never reads a page itself: the host reads each URL from `queue` and hands
// the result to `take`.
import {
  childTextKeeper,
  DETAIL_STREAK_LIMIT,
  detailLink,
  detailSpecKey,
  needsDetailFetch,
  nextStreaks,
  recordTextKeeper,
} from './detail.mjs'

/**
 * A detail run over `listRows` (each row's `spec.link` cell is its detail URL).
 *   entries — url → the latest checkpoint entry read with this spec (a Map; the run adds to it as pages finish)
 *   maxLinks — only the first N distinct links (a preview; 0 = all)
 *   retryEmpty — read pages recorded as empty again
 *   browser — what reads the pages ('bundled', 'chrome', …): written into each entry; an empty page recorded by
 *     another one is read again
 *   persist(entry) — called with every entry as it is kept (after `entries` has it); may return a promise
 *     (`flush()` waits for those)
 * → {
 *   queue: URLs to read, in order (the host takes from the front; a failed page with tries left is pushed back),
 *   take(url, result) → 'stop' (too many blocked pages) | 'canary' (too many empty ones: call checkCanary) | null,
 *   checkCanary(read) → Promise<'stop' | null>, read(url) → a result, or null when the run is stopping,
 *   stop(reason, note), finish() → { stopReason, note, canary, fetched }, flush() → Promise,
 *   entries, rowUrls, links, considered, specKey, maxAttempts, needsFetch(url), stopReason, note, canary, fetched, streaks
 * }
 * Results handed to `take` are recorded; a read the host aborted is simply not handed over (read again next run).
 */
export function createDetailRun({ spec, listRows, entries = new Map(), maxLinks = 0, retryEmpty = false, browser = null, persist = () => undefined }) {
  const specKey = detailSpecKey(spec)
  const maxAttempts = Number(spec.maxAttempts ?? 3)
  const detailNames = Object.keys(spec.fields)
  const childNames = spec.children ? Object.keys(spec.children.fields) : []
  /** Record excerpts go into the checkpoint for the first few pages per blank column only (the summary quotes one). */
  const keepRecordText = recordTextKeeper(entries, detailNames)
  const keepChildText = childTextKeeper(entries, childNames)

  // ---------- plan ----------
  const rowUrls = listRows.map(row => detailLink(row[spec.link]))
  const links = [...new Set(rowUrls.filter(Boolean))]
  const considered = maxLinks ? links.slice(0, maxLinks) : links
  const fetchOptions = { browser, retryEmpty: Boolean(retryEmpty) }
  const needsFetch = url => needsDetailFetch(entries.get(url), maxAttempts, fetchOptions)
  const todo = considered.filter(needsFetch)
  // Empty pages read again go last: a run that stopped on a run of empty pages does not stop on the same ones again.
  const wasEmpty = url => entries.get(url)?.status === 'empty'
  const queue = [...todo.filter(url => !wasEmpty(url)), ...todo.filter(wasEmpty)]

  let stopReason = null
  let note = ''
  let fetched = 0
  let streaks = { blocked: 0, empty: 0 }
  /** URLs of the empty pages since the last ok one: unconfirmed until an ok page (or the canary) vouches for the site. */
  let emptyStreak = []
  const canary = []
  /** persist() calls still running (their first failure is reported by flush). */
  const pending = new Set()
  let persistError = null

  /** Stop the run (the first reason given wins). */
  function stop(reason, text = '') {
    if (stopReason) return
    stopReason = reason
    note = text
  }

  /** Keep an entry: in `entries`, then persisted. → the entry. */
  function append(entry) {
    entries.set(entry.url, entry)
    const done = persist(entry)
    if (done && typeof done.then === 'function') {
      const tracked = Promise.resolve(done).then(
        () => pending.delete(tracked),
        error => {
          pending.delete(tracked)
          persistError ??= error
        }
      )
      pending.add(tracked)
    }
    return entry
  }

  /** Record one finished page. An empty one (not a dead link) is `unconfirmed` until the site is vouched for. */
  function record(url, result, attemptsDelta = 1) {
    const prev = entries.get(url)
    const { status, fields = {}, error, httpStatus, notFound, recordText, recordScope, children, childrenMatched, childText, childPager, childMore, childPlaces, childDupes, childrenHidden, childError, expandCapped } = result
    return append({
      url,
      status,
      fields,
      attempts: Number(prev?.attempts ?? 0) + attemptsDelta,
      spec: specKey,
      ...(browser ? { browser } : {}),
      ...(status === 'empty' && !notFound ? { unconfirmed: true } : {}),
      ...(error ? { error } : {}),
      ...(httpStatus ? { httpStatus } : {}),
      ...(notFound ? { notFound } : {}),
      ...(status === 'ok' && children ? { children } : {}),
      ...(status === 'ok' && childrenMatched ? { childrenMatched } : {}),
      ...(status === 'ok' && childPager ? { childPager } : {}),
      ...(status === 'ok' && childMore ? { childMore } : {}),
      ...(status === 'ok' && childPlaces ? { childPlaces } : {}),
      ...(status === 'ok' && childDupes ? { childDupes } : {}),
      ...(status === 'ok' && childrenHidden ? { childrenHidden } : {}),
      ...(status === 'ok' && childError ? { childError } : {}),
      ...(status === 'ok' && expandCapped ? { expandCapped } : {}),
      ...(keepChildText(result) ? { childText } : {}),
      ...(keepRecordText(result) ? { recordText, ...(recordScope ? { recordScope } : {}) } : {}),
    })
  }

  /** The empty pages since the last ok one really are empty: the site served an ok page after (or around) them. */
  function confirmEmpty() {
    for (const url of emptyStreak) {
      const entry = entries.get(url)
      if (!entry?.unconfirmed) continue
      const { unconfirmed, ...rest } = entry
      append(rest)
    }
    emptyStreak = []
  }

  /**
   * Take one result in: record it, requeue a failure with tries left, update the streaks.
   * → 'stop' (too many blocked pages), 'canary' (too many empty ones: check an ok page again) or null.
   */
  function take(url, result) {
    fetched += 1
    const entry = record(url, result)
    if (entry.status === 'failed' && entry.attempts < maxAttempts) queue.push(url)
    streaks = nextStreaks(streaks, result)
    if (result.status === 'ok') confirmEmpty()
    else if (result.status === 'empty' && !result.notFound) emptyStreak.push(url)
    if (streaks.blocked >= DETAIL_STREAK_LIMIT) {
      stop('blocked', `${streaks.blocked} pages in a row looked blocked (last: ${url} — ${result.error ?? ''})`)
      return 'stop'
    }
    if (streaks.empty >= DETAIL_STREAK_LIMIT) return 'canary'
    return null
  }

  /**
   * Too many empty pages in a row: read again a page that read ok before, to tell "these pages are empty"
   * from "the site stopped serving us". `read(url)` → the result, or null when the run is stopping.
   * A server error on the check proves nothing: once more (on another ok page when there is one), and
   * after two errors the run goes on and checks again after the next empty pages. → 'stop' or null.
   */
  async function checkCanary(read) {
    const ok = [...entries.values()].filter(e => e.status === 'ok' && !emptyStreak.includes(e.url)).map(e => e.url)
    if (!ok.length) {
      const first = entries.get(emptyStreak[0])
      stop('no-data', `${emptyStreak.length} pages read empty and none has read ok yet (e.g. ${emptyStreak[0]}: ${first?.error ?? 'empty'})`)
      return 'stop'
    }
    for (const target of [ok[0], ok[1] ?? ok[0]]) {
      const result = await read(target)
      if (!result) return 'stop'
      canary.push({ url: target, status: result.status, ...(result.error ? { error: result.error } : {}), afterEmpty: emptyStreak.length })
      if (result.status === 'ok') {
        streaks = { ...streaks, empty: 0 }
        confirmEmpty()
        return null
      }
      if (result.status === 'failed') continue
      // Every empty page the run cannot vouch for (from this run or one before) becomes blocked: a rerun reads them again.
      const suspects = [...entries.values()].filter(e => e.status === 'empty' && e.unconfirmed)
      for (const e of suspects) record(e.url, { status: 'blocked', fields: {}, error: `re-marked: a page that read fine before (${target}) now reads ${result.status}` }, 0)
      stop(
        'blocked',
        `${emptyStreak.length} pages read empty with no ok page between them, and ${target}, which read fine before, now reads ${result.status}${result.error ? ` (${result.error})` : ''}: the site is probably blocking, or its pages changed`
      )
      return 'stop'
    }
    streaks = { ...streaks, empty: 0 }
    return null
  }

  /**
   * The run is over: without a stop it ended as 'done', or as 'max-rows' while some link past maxLinks is still to be
   * read; either way the empty pages since the last ok one are what they read. → { stopReason, note, canary, fetched }
   */
  function finish() {
    if (!stopReason) stopReason = considered.length < links.length && links.slice(considered.length).some(needsFetch) ? 'max-rows' : 'done'
    if (stopReason === 'done' || stopReason === 'max-rows') confirmEmpty()
    return { stopReason, note, canary, fetched }
  }

  /** Wait for the persist() calls still running; rejects with the first one that failed. */
  async function flush() {
    while (pending.size) await Promise.all([...pending])
    if (persistError) throw persistError
  }

  return {
    queue,
    take,
    checkCanary,
    stop,
    finish,
    flush,
    needsFetch,
    entries,
    rowUrls,
    links,
    considered,
    specKey,
    maxAttempts,
    canary,
    get stopReason() {
      return stopReason
    },
    get note() {
      return note
    },
    get fetched() {
      return fetched
    },
    /** Blocked pages in a row, empty pages since the last ok one (a batch reader stops early on them). */
    get streaks() {
      return streaks
    },
  }
}
