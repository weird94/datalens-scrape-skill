// How inspect and collect results read, shared by the CLI scripts and the extension's agent tools
// so the agent sees the same report wherever it runs.

/** inspectOnPage's report as the text inspect.mjs prints. `report.browser` names the browser used. */
export function formatInspectReport(report) {
  const lines = []
  lines.push(`PAGE  ${report.title ?? ''}  ${report.url}  (HTTP ${report.status ?? '?'}, visible text ${report.textLength ?? '?'} chars, ${report.browser} browser)`)
  if (report.error) lines.push(`ERROR ${report.error}`)
  if (report.shadowRoots) lines.push(`SHADOW   ${report.shadowRoots} open shadow roots (web components). Selectors reach into them: a descendant selector (a space) crosses shadow roots at any depth ("comment-card .author" finds .author inside comment-card's shadow root; "#replies .author" only the authors under #replies); ">" stays inside one tree. What a shadow root shows through a slot belongs to the host's own children: make the row the host or an element above it. TREE marks shadow hosts with (shadow).`)
  if (report.notRendering) lines.push('HIDDEN   the browser is not drawing this tab (window minimized or covered, or tab in the background): --setup/--click/--scroll were skipped and lazy content is missing. Ask the user to bring that Chrome window to the front, then rerun.')
  if (report.wall?.kind === 'blocked') {
    lines.push(`BLOCKED  this looks like a block / bot-check page, not the content (${report.wall.evidence}).`)
    lines.push(`         Don't tune selectors on it.${report.browser === 'chrome' ? ' Ask the user to open the page in this Chrome tab and get past the check, then retry.' : ' Ask the user whether to use their own Chrome — references/browser.md.'}`)
  } else if (report.wall?.kind === 'login') {
    lines.push(`LOGIN?   the page asks to log in (${report.wall.evidence}).`)
    lines.push(`         If the list is visible behind a popup you can close, dismiss it. Otherwise the user has to log in — references/browser.md.`)
  }
  for (const d of report.setup?.done ?? []) lines.push(`SETUP step ${d.step} ${d.ok ? 'ok' : `skipped (${d.message})`}${d.navigated ? ', navigated' : ''}`)
  if (report.setup?.error) lines.push(`SETUP FAILED ${report.setup.error}`)
  for (const c of report.clicks ?? []) {
    lines.push(`CLICK ${c.css} → ${c.result ?? `clicked "${c.clicked}"${c.navigated ? ', navigated' : ''}${c.change ? ` — ${c.change}` : ''}`}`)
  }
  if (report.brief) {
    lines.push('', 'OVERVIEW skipped: this call asked about particular elements. Top lists now:')
    if (!report.lists?.length) lines.push('  none found')
    for (const [i, l] of (report.lists ?? []).entries()) lines.push(`  ${i + 1}. ${l.selector}  ×${l.count}${l.samples[0] ? `  · ${l.samples[0]}` : ''}`)
    lines.push('  Inspect without probes / html / find / tree for the full overview (lists, tree, controls, scrolling, overlays).')
  } else formatOverview(report, lines)
  formatTrees(report, lines)
  formatFinds(report, lines)
  formatProbes(report, lines)
  if (report.textHead !== undefined) lines.push('', `TEXT HEAD  ${report.textHead}`, `TEXT TAIL  …${report.textTail}`)
  return lines.join('\n')
}

const refTag = ref => (ref ? `[ref=${ref}] ` : '')
const matchCount = n => (n > 1 ? ` (selector matches ${n})` : '')

function formatOverview(report, lines) {
  lines.push('', 'LISTS (repeated structures, best first)')
  if (!report.lists?.length) lines.push('  none found — page may still be rendering (try --wait 5000), may be empty/gated, or the list has < 3 items (use --probe)')
  for (const [i, l] of (report.lists ?? []).entries()) {
    const flagsText = [l.nav ? 'inside nav/aside/header/footer' : '', l.spreadOver ? `spread over ${l.spreadOver} parents` : '', l.visible < l.count ? `${l.count - l.visible} hidden` : ''].filter(Boolean).join(', ')
    lines.push(`  ${i + 1}. ${l.selector}  ×${l.count}  avgText ${l.avgText}  links ${l.links}%${flagsText ? `  [${flagsText}]` : ''}`)
    for (const s of l.samples) lines.push(`       · ${s}`)
  }
  if (report.tree?.text) {
    lines.push('', `TREE (the page as it renders, ${report.tree.lines} lines in all: shadow content in place, a wrapper with one child on its child's line, "…(N more x)" = more siblings like the two above, {+N lines: "…"} = closed, {+N lines, no text} = closed and without text — open one with tree: its ref, or a selector)`)
    lines.push(report.tree.text)
  }
  lines.push('', 'CONTROLS (pagination / load-more / expand candidates)')
  if (!report.controls?.length) lines.push('  none')
  for (const c of report.controls ?? []) {
    const bits = [c.tag, c.text && `"${c.text}"`, c.aria && `aria="${c.aria}"`, c.href && `href=${c.href}`, !c.visible && 'HIDDEN', c.disabled && 'DISABLED', c.pressed && `pressed=${c.pressed}`].filter(Boolean)
    lines.push(`  - ${refTag(c.ref)}${c.selector}${matchCount(c.matches)}  ${bits.join('  ')}`)
  }
  for (const p of report.pagers ?? []) lines.push(`  pager: ${p.selector}  "${p.text}"`)
  const s = report.scroll
  if (s) {
    lines.push('', `SCROLL  window ${s.window.scrollHeight}px / viewport ${s.window.viewport}px${s.bodyScrollLocked ? '  BODY SCROLL LOCKED' : ''}`)
    for (const c of s.containers) lines.push(`  container: ${c.selector}  ${c.clientHeight}px showing of ${c.scrollHeight}px`)
  }
  if (report.overlays?.length) {
    lines.push('', 'OVERLAYS (fixed, large)')
    for (const o of report.overlays) {
      const closers = o.closers.map((c, i) => `${refTag(o.closerRefs?.[i])}${c}`)
      lines.push(`  - ${o.selector} z=${o.zIndex} "${o.text}"  closers: ${closers.join(' | ') || 'none found'}`)
    }
  }
}

function formatTrees(report, lines) {
  for (const t of report.trees ?? []) {
    if (!t.text) {
      lines.push('', `TREE ${t.selector}  ×0 — ${t.why}`)
      continue
    }
    lines.push('', `TREE ${t.selector}${t.note ? ` (${t.note})` : ''}  ${t.lines} lines in all`, t.text)
  }
}

function formatFinds(report, lines) {
  for (const f of report.finds ?? []) {
    lines.push('', `FIND "${f.text}"  ×${f.count}${f.count > f.hits.length ? ` (first ${f.hits.length})` : ''}`)
    if (!f.count) lines.push('  no element shows this text (check the spelling, or the content has not loaded yet)')
    for (const h of f.hits) {
      const where = h.onScreen ? '' : h.visible ? '  off screen' : '  HIDDEN'
      lines.push(`  · ${refTag(h.ref)}${h.selector}${matchCount(h.matches)}  ${h.tag}  "${h.text}"${where}`)
      if (h.click) lines.push(`      click target: ${refTag(h.click.ref)}${h.click.selector}${matchCount(h.click.matches)}  ${h.click.tag}`)
    }
  }
}

function formatProbes(report, lines) {
  if (!report.probes?.length) return
  lines.push('', 'PROBES')
  for (const p of report.probes) {
    if (p.error) {
      lines.push(`  ${p.selector}  ERROR ${p.error}`)
      continue
    }
    if (!p.count && p.why) {
      lines.push(`  ${p.selector}  ×0 — ${p.why}`)
      continue
    }
    lines.push(`  ${p.selector}  ×${p.count} (visible ${p.visible}${p.onScreen !== undefined && p.count > 1 ? `, on screen ${p.onScreen}` : ''})`)
    const sample = t => (typeof t === 'string' ? t : `${refTag(t.ref)}${t.text}`)
    for (const t of p.first) lines.push(`     · ${sample(t)}`)
    if (p.last.length) lines.push('     …')
    for (const t of p.last) lines.push(`     · ${sample(t)}`)
    if (p.html) lines.push(`     html: ${p.html}`)
  }
}

/**
 * collectOnPage's result as the summary collect.mjs writes next to the CSV (and verify reads):
 * everything but the rows. `extra` adds host fields (browser, seconds, out).
 */
/** Rows on the page went down after clicking the expand selectors. */
export function expandShrankText({ from, to, at }) {
  return `rows on the page went from ${from} to ${to} after clicking the expand selectors (${at}) — one of them also matches a button that hides content ("收起", "Hide", "Show less"), often one sharing the expand button's class. Make each expand selector match only buttons that show more (add :not(…) or use :has-text("…")).`
}

export function expandPastStartText(past) {
  const list = past.map(m => `"${m.text}" ×${m.count} (${m.selector}${m.after ? `, right after the row "${m.after}"` : ''})`).join(', ')
  return `a record's own pager is already past its first page: ${list} — expand only pages forward, so the items of its earlier pages are not on the page and will be missing. Click it back to the first page (--click / clicks) and collect again.`
}

export function expandNoEffectText({ clicked, stale, left }) {
  const sample = left?.length ? ` (e.g. ${left.map(l => `"${l.text}" via ${l.selector}`).join(', ')})` : ''
  return `expand clicked ${clicked} element${clicked > 1 ? 's' : ''} and ${stale} of them did nothing: still there, with nothing around them changed${sample} — the selector matches something that does not open anything (a label, or a wrapper with several controls). Click one with --click / clicks, read the CLICK line, and target the control that does.`
}

export function expandMissedText(missed) {
  const list = missed.map(m => `"${m.text}" ×${m.count} (${m.selector}${m.after ? `, right after the row "${m.after}"` : ''})`).join(', ')
  return `controls among the rows that expand did not click: ${list} — sitting between rows, they belong to a record, not to the list: if they show more of it (its own pager, "more replies", "read more"), add them to expand; the rows behind them are missing otherwise.`
}

export function expandReplacedText(count, cells = [], filled = []) {
  const rowsOf = n => `${n} row${n > 1 ? 's' : ''}`
  const changed = cells.length ? ` Changed: ${cells.map(c => `column "${c.column}" in ${rowsOf(c.rows)} ("${c.was}" → "${c.now}")`).join('; ')}.` : ''
  const took = filled.length
    ? ` Those cells were cut off ("…") and now read whole — the record opened — so the cells only the opened record shows were taken: ${filled.map(c => `"${c.column}" in ${rowsOf(c.rows)}`).join(', ')}.`
    : ''
  return `${rowsOf(count)} showed other values after an expand click and kept the first ones.${changed}${took} If a pager inside the record replaced that part with other items (a record's own replies), read it with "all": true (the items seen are joined), or make each item a row of its own. If it is the same content shown again (a teaser and its full text, a formula or embed rendered), the first values are what the page showed first: acknowledge it, or read the part that only the opened record has.`
}

export function summarizeCollect(result, extra = {}) {
  const rounds = result.rounds ?? []
  return {
    rows: result.rows.length,
    stopReason: result.stopReason,
    warning: result.warning || undefined,
    totalCheck: result.totalCheck || undefined,
    note: result.note || undefined,
    setup: result.setupLog ?? undefined,
    wall: result.wall ?? undefined,
    claimedTotals: result.claimed?.length ? result.claimed : undefined,
    duplicatesMergedByLink: result.mergedByLink || undefined,
    // Rows read again whose counts or pictures had changed (or the preview's rows): kept once, with the latest values.
    sameRecordMerged: result.mergedSameRecord || undefined,
    seededRows: result.seeded || undefined,
    expand: result.expandShrank ? expandShrankText(result.expandShrank) : undefined,
    expandReplaced: result.expandReplaced ? expandReplacedText(result.expandReplaced, result.expandReplacedCells, result.expandFilledCells) : undefined,
    expandMissed: result.expandMissed?.length ? expandMissedText(result.expandMissed) : undefined,
    expandNoEffect: result.expandNoEffect ? expandNoEffectText(result.expandNoEffect) : undefined,
    expandPastStart: result.expandPastStart?.length ? expandPastStartText(result.expandPastStart) : undefined,
    unreadLinks: result.unreadLinks ?? undefined,
    unreadParts: result.unreadParts ?? undefined,
    aiStop: result.aiStop ?? undefined,
    scrollCandidates: result.scrollCandidates?.length
      ? { hint: 'scrolling stopped adding rows; if the list should have more, the scroller may be wrong — these elements around the rows can scroll', candidates: result.scrollCandidates }
      : undefined,
    ...(extra.browser ? { browser: extra.browser } : {}),
    rounds: rounds.length,
    roundLog: rounds.length > 12 ? [...rounds.slice(0, 6), { skipped: rounds.length - 12 }, ...rounds.slice(-6)] : rounds,
    lastUrl: result.lastUrl,
    pageTextTail: result.tail,
    ...Object.fromEntries(Object.entries(extra).filter(([key]) => key !== 'browser')),
  }
}

/** What a detail run's stop reason means for the agent, when it needs saying. */
const DETAIL_STOP_NOTES = {
  blocked:
    'the site started answering with a block / bot check / login wall. Progress is kept in the checkpoint. Ask the user before going on: rerunning the same command with --browser chrome (their own Chrome, references/browser.md) usually gets past it, and resumes where this run stopped. Do not try to solve captchas or log in for the user.',
  'no-data':
    'either the selectors / "require" miss on these pages (inspect one of them, fix detail.json, rerun), or the site serves this browser empty pages (if inspect shows the data, ask the user before rerunning the same command with --browser chrome). The empty pages stay to be read again: a rerun reads the other links first, then these.',
  'tab-not-rendering':
    'the browser is not drawing this tab (window minimized or covered, or tab in the background), so late content never comes. Ask the user to bring that Chrome window to the front and keep it visible during the run, then rerun the same command.',
  interrupted: 'stopped (Ctrl-C, SIGTERM or SIGHUP). Progress is kept: rerun the same command to resume.',
}

const pct = (n, of) => (of ? Math.round((100 * n) / of) : 0)

/**
 * detail.mjs's summary: counts by status per row (the same counts as the output's status column; a link in
 * several rows is read once and counts for each row), fill rate of each detail column on the pages that read
 * ok, and warnings the agent should act on or report.
 *   rowUrls — each list row's detail URL (null: no usable link); entries: url → latest checkpoint entry
 *   maxRows — the --max-rows limit when one was given; extraWarnings — warnings the run itself raised
 *   children — with a child list: { selector (children.rows), names (child columns), out (child CSV), countColumn,
 *              rooted (the spec has "root") }
 */
export function summarizeDetail({ rowUrls, entries, detailNames, stopReason, note = '', maxRows = 0, canary = [], extraWarnings = [], extra = {}, children = null }) {
  const links = [...new Set(rowUrls.filter(Boolean))]
  const statusOf = url => (url ? entries.get(url)?.status ?? 'pending' : 'no-link')
  const status = { ok: 0, empty: 0, failed: 0, blocked: 0, pending: 0, 'no-link': 0 }
  for (const url of rowUrls) status[statusOf(url)] += 1
  const of = wanted => links.filter(url => statusOf(url) === wanted)
  const okUrls = of('ok')
  const fill = Object.fromEntries(detailNames.map(name => [name, okUrls.filter(url => String(entries.get(url).fields?.[name] ?? '') !== '').length]))
  const fillRate = Object.fromEntries(detailNames.map(name => [name, `${fill[name]}/${okUrls.length} (${pct(fill[name], okUrls.length)}%)`]))
  const sample = (urls, n = 3) => urls.slice(0, n)
  const warnings = [...extraWarnings]

  if (okUrls.length) {
    const best = Math.max(...detailNames.map(name => fill[name]))
    const bestName = detailNames.find(name => fill[name] === best)
    for (const name of detailNames) {
      const emptyOn = okUrls.filter(url => String(entries.get(url).fields?.[name] ?? '') === '')
      // The record's text on a page where the column is empty (kept in the checkpoint): the value may be in it, in another place.
      // A cut-off excerpt (ends in "…") shows only the start of the record: not finding the value there proves nothing.
      const quoted = emptyOn.find(url => entries.get(url).recordText)
      const { reads, cut } = quoteRecord(quoted, entries.get(quoted))
      if (fill[name] === 0) {
        warnings.push(
          `column "${name}" is empty on every ok page: wrong selector, or it only shows after a click (expand / setup).${reads ? ` ${reads}` : ''} Check with inspect --probe on ${sample(okUrls, 2).join(' , ')}.`
        )
      } else if (okUrls.length >= 3 && best - fill[name] >= Math.max(1, okUrls.length * 0.15)) {
        const look = !reads
          ? 'Inspect the whole record on one of them (--html "<root>"), not only the block where the field usually is'
          : cut
            ? `${reads} Look for the value there; if it is not in this part, inspect the whole record (--html "<root>") before deciding the item lacks it`
            : `${reads} Look for the value there before deciding the item lacks it`
        warnings.push(
          `column "${name}" is filled on ${fill[name]}/${okUrls.length} ok pages while "${bestName}" is on ${best}: either those items lack this field, or they show it in another place. ${emptyOn.length === 1 && quoted ? '' : `It is empty on ${sample(emptyOn).join(' , ')}. `}${look}: if the value is there, widen the selector to cover both places (a comma list); if not, keep the selector and report the fill rate.`
        )
      }
    }
  }
  // An expand control still there after the last pass: what it would open (often more of a list) was not read.
  const cappedExpand = okUrls.filter(url => entries.get(url).expandCapped)
  if (cappedExpand.length) {
    const { text, passes } = entries.get(cappedExpand[0]).expandCapped
    warnings.push(
      `on ${cappedExpand.length} of ${okUrls.length} ok pages a control in "expand" was still there after ${passes} rounds of clicks (e.g. ${JSON.stringify(text)} on ${cappedExpand[0]}): what it would still open was not read. If those pages need it, raise "expandPasses" (now ${passes}, up to 200) and rerun (every page is read again); otherwise report that these items have more than was read.`
    )
  }
  const childSummary = children ? summarizeChildren({ children, rowUrls, okUrls, entries, warnings, statusOf }) : null
  const softEmpty = of('empty').filter(url => !entries.get(url).notFound)
  const deadLinks = of('empty').filter(url => entries.get(url).notFound)
  const visited = okUrls.length + softEmpty.length
  if (softEmpty.length >= 2 && softEmpty.length >= visited * 0.2) {
    const reasons = [...new Set(softEmpty.map(url => entries.get(url).error).filter(Boolean))].slice(0, 3)
    warnings.push(
      `${softEmpty.length} of ${visited} pages read as empty (${reasons.join('; ')}), e.g. ${sample(softEmpty).join(' , ')}. Inspect one: another layout, content that renders late (set waitFor), a click it needs, or a soft block.`
    )
  }
  const failed = of('failed')
  if (failed.length) {
    const errors = sample(failed).map(url => `${url}: ${entries.get(url).error ?? 'failed'}`)
    warnings.push(`${failed.length} page${failed.length > 1 ? 's' : ''} failed (${errors.join('; ')}). Rerun the same command to retry pages with tries left (maxAttempts), or raise maxAttempts.`)
  }
  const pendingLinks = of('pending').length
  if (stopReason === 'max-rows' && pendingLinks) {
    warnings.push(`NOT THE END: preview of the first ${maxRows} links; ${pendingLinks} links are pending. Rerun without --max-rows (same --out resumes) for all of them.`)
  }
  const stopNote = DETAIL_STOP_NOTES[stopReason]
  return {
    rows: rowUrls.length,
    links: links.length,
    status,
    stopReason,
    note: [note, stopNote].filter(Boolean).join(' — ') || undefined,
    fillRate,
    warnings: warnings.length ? warnings : undefined,
    deadLinks: deadLinks.length ? { count: deadLinks.length, sample: sample(deadLinks) } : undefined,
    canary: canary.length ? canary : undefined,
    ...(cappedExpand.length ? { expandCapped: { count: cappedExpand.length, sample: sample(cappedExpand) } } : {}),
    ...(childSummary ? { children: childSummary } : {}),
    ...extra,
  }
}

/** How a warning quotes the record text kept for `url` (its checkpoint `entry`). → { reads: 'On … reads: "…".' or '', cut } */
function quoteRecord(url, entry) {
  if (!entry?.recordText) return { reads: '', cut: false }
  const cut = entry.recordText.endsWith('…')
  const where = entry.recordScope === 'root' ? 'the record' : entry.recordScope === 'main' ? 'the page\'s main content (no "root" set)' : 'the page'
  return { reads: `On ${url} ${where} ${cut ? 'starts' : 'reads'}: ${JSON.stringify(entry.recordText)}${cut ? ' (cut off)' : ''}.`, cut }
}

/**
 * The child list's part of the summary: child rows in the child CSV (per main row, like the count column), ok
 * pages without any, the fill rate of each child column (each page's children once), pages where `max` cut the
 * list, pages whose children could not be read; warnings (pushed to `warnings`) for what a page showed about the
 * child list that the config missed: a child read that threw, a selector that matched nothing, a child column filled
 * far less than the others, child rows that read nothing, rows from several places on the page, a container matched
 * with its rows, a control beside the rows expand did not click, a count beside them larger than the rows read,
 * matches the page does not show, and a link to more of them on another URL.
 */
function summarizeChildren({ children, rowUrls, okUrls, entries, warnings, statusOf }) {
  const { selector, names, out, countColumn, rooted = false } = children
  const sample = (urls, n = 3) => urls.slice(0, n)
  const entryOf = url => entries.get(url)
  const countOf = url => entryOf(url).children?.length ?? 0
  const rowsWord = n => `${n} child row${n === 1 ? '' : 's'}`
  const rows = rowUrls.filter(url => statusOf(url) === 'ok').reduce((sum, url) => sum + countOf(url), 0)
  const errored = okUrls.filter(url => entryOf(url).childError)
  // Pages whose children were read (a child read that threw says nothing about the list).
  const read = okUrls.filter(url => !entryOf(url).childError)
  const none = read.filter(url => countOf(url) === 0)
  const kids = read.flatMap(url => (entryOf(url).children ?? []).map((child, i) => ({ url, i, child })))
  const filled = name => kids.filter(k => String(k.child[name] ?? '') !== '')
  const fill = Object.fromEntries(names.map(name => [name, filled(name).length]))
  const capped = read.filter(url => entryOf(url).childrenMatched)
  const on = (pages, what) => `on ${pages.length} of ${okUrls.length} ok pages ${what}`

  if (errored.length) {
    warnings.push(
      `children could not be read on ${errored.length} of ${okUrls.length} ok pages: ${entryOf(errored[0]).childError} (e.g. ${errored[0]}). That is the "children" config, not the site: fix "children.rows" (${JSON.stringify(selector)}) or a child field's CSS and rerun (the pages are read again after a config change). Their own fields read fine.`
    )
  }
  if (read.length && !kids.length) {
    const quoted = none.find(url => entryOf(url).recordText)
    const { reads } = quoteRecord(quoted, entryOf(quoted))
    warnings.push(
      `"children.rows" (${JSON.stringify(selector)}) matched no child row on any of the ${read.length} ok pages: wrong selector, the list is outside "root", or it only shows after a click (expand / setup) or renders later than the record (waitFor).${reads ? ` ${reads}` : ''} Check with inspect --probe on ${sample(read, 2).join(' , ')}.`
    )
  } else if (kids.length) {
    const best = Math.max(...names.map(name => fill[name]))
    const bestName = names.find(name => fill[name] === best)
    for (const name of names) {
      const empty = kids.filter(k => String(k.child[name] ?? '') === '')
      // A child row's text kept in the checkpoint (the first child row with a blank field on a page).
      const quoted = empty.find(k => Number(entryOf(k.url).childText?.index) === k.i + 1)
      const text = quoted ? entryOf(quoted.url).childText.text : ''
      const reads = quoted ? `On ${quoted.url} child row ${quoted.i + 1} ${text.endsWith('…') ? 'starts' : 'reads'}: ${JSON.stringify(text)}.` : ''
      if (fill[name] === 0) {
        warnings.push(`child column "${name}" is empty in every child row: wrong selector (it is read inside each child row), or it only shows after a click.${reads ? ` ${reads}` : ''}`)
      } else if (kids.length >= 3 && best - fill[name] >= Math.max(1, kids.length * 0.15)) {
        warnings.push(
          `child column "${name}" is filled in ${fill[name]}/${kids.length} child rows while "${bestName}" is in ${best}: either those rows lack it, or show it in another place.${reads ? ` ${reads}` : ''} Look for the value in such a row (--html "<children.rows>"): if it is there, widen the selector (a comma list); if not, keep it and report the fill rate.`
        )
      }
    }
    // Rows that read nothing at all: the selector matches more than the rows (headings, wrappers, every element).
    const blank = kids.filter(k => names.every(name => String(k.child[name] ?? '') === ''))
    if (blank.length >= 2 && blank.length >= kids.length * 0.2) {
      warnings.push(
        `${blank.length} of ${kids.length} child rows read nothing in any child column (e.g. child row ${blank[0].i + 1} on ${blank[0].url}): "children.rows" (${JSON.stringify(selector)}) matches more than the rows. Narrow it to one whole child row (check with --html "<children.rows>" on a page).`
      )
    }
  }
  const spread = read.filter(url => entryOf(url).childPlaces)
  if (spread.length) {
    const { places, firsts } = entryOf(spread[0]).childPlaces
    warnings.push(
      `${on(spread, `the child rows come from ${places} separate places on the page`)} (e.g. on ${spread[0]}: ${firsts.map(t => JSON.stringify(t)).join(', ')}): ${
        rooted
          ? 'narrow "children.rows" (or "root") to the one list the user wants.'
          : 'with no "root", related items around the record bring their own rows in; set "root" to the record\'s container (the child rows are matched inside it).'
      }`
    )
  }
  const doubled = read.filter(url => entryOf(url).childDupes)
  if (doubled.length) {
    warnings.push(
      `${on(doubled, `"children.rows" matches a container together with the child rows in it`)}: the container reads the same as its first row, so that row is there twice (e.g. ${doubled[0]}). Narrow "children.rows" (${JSON.stringify(selector)}) to the row itself.`
    )
  }
  const unclicked = read.filter(url => entryOf(url).childMore?.control)
  if (unclicked.length) {
    const url = unclicked[0]
    warnings.push(
      `${on(unclicked, 'a control beside the child rows was not clicked')} (e.g. ${JSON.stringify(entryOf(url).childMore.control)} on ${url}, ${rowsWord(countOf(url))} read): it is not in "expand". If it shows more of the list, add its selector to "expand" and rerun (the pages are read again).`
    )
  }
  const counted = read.filter(url => {
    const e = entryOf(url)
    return e.childMore?.claim && !e.childMore.control && !e.childPager && !e.expandCapped && !e.childrenMatched
  })
  if (counted.length) {
    const url = counted[0]
    warnings.push(
      `${on(counted, 'a heading beside the child rows counts more than were read')} (e.g. ${JSON.stringify(entryOf(url).childMore.claim.text)} on ${url}, ${countOf(url)} read): the rest may be behind a click (expand), on another URL, or load on scroll. Look at one of them before reporting the list as complete.`
    )
  }
  const hidden = none.filter(url => entryOf(url).childrenHidden)
  if (hidden.length) {
    warnings.push(
      `${on(hidden, `no child row was read, but "children.rows" matches ${entryOf(hidden[0]).childrenHidden} elements the page does not show`)} (e.g. ${hidden[0]}): a template, or rows in a closed tab or section. If they are real rows, open them first ("setup" for a tab, "expand" for a section).`
    )
  }
  const paged = read.filter(url => entryOf(url).childPager)
  if (paged.length) {
    const { text, href } = entryOf(paged[0]).childPager
    warnings.push(
      `${on(paged, 'the child list has a link to more of it on another URL')} (e.g. ${JSON.stringify(text)} → ${href} on ${paged[0]}): only the child rows each detail page itself shows were read. If the user wants all of them, collect the rest separately (references/detail-pages.md, "Child lists").`
    )
  }
  return {
    out,
    countColumn,
    rows,
    okPages: okUrls.length,
    pagesWithNone: {
      count: none.length,
      sample: sample(none),
      // Some pages have children and these have none: check one; a list that rendered late can be read again.
      ...(none.length && kids.length ? { check: 'open one: if it shows child rows, they rendered late; rerun with --retry-empty to read these pages again' } : {}),
    },
    fillRate: Object.fromEntries(names.map(name => [name, `${fill[name]}/${kids.length} (${pct(fill[name], kids.length)}%)`])),
    ...(capped.length ? { capped: { count: capped.length, sample: sample(capped) } } : {}),
    ...(errored.length ? { childErrors: { count: errored.length, sample: sample(errored) } } : {}),
  }
}
