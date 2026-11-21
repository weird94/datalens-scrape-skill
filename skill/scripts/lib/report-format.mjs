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
