// Quality checks for a collected table: fill rates, duplicates, rows whose shape differs from the
// majority (control / group-header / ad rows), columns that look broken, and what the collector's
// summary says (limits hit, totals the page claims, scroll candidates).
// Pure function, shared by verify.mjs and the extension.

/** Stop reasons of a run that did not get to the end, and what to say about each (given the summary's note). */
const UNFINISHED = {
  running: () => 'the run had not finished when this CSV was written (it is still going, or its process died)',
  interrupted: () => 'the run was stopped (Ctrl-C, SIGTERM or SIGHUP) before it finished',
  error: note => `the run stopped on an error${note ? ` (${note})` : ''}`,
}

/**
 * @param {{ header: string[], rows: string[][], summary?: object | null }} input
 * @returns {{ lines: string[], warnings: string[], notes: string[] }} report text, plus the WARN and NOTE messages
 */
export function verifyTable({ header, rows, summary = null }) {
  const lines = []
  const warn = msg => lines.push(`WARN  ${msg}`)
  const notes = []
  const note = msg => notes.push(`NOTE  ${msg}`)
  lines.push(`ROWS  ${rows.length}   COLUMNS  ${header.length}: ${header.join(', ')}`)
  // A run that did not finish: the CSV holds only what was collected until it stopped.
  const unfinished = summary ? UNFINISHED[summary.stopReason] : null
  if (unfinished) warn(`${unfinished(summary.note)}: the CSV holds only the rows collected until then — rerun the same command to get the rest (collect.mjs with --resume), or tell the user the list is incomplete`)
  if (!rows.length) return { lines, warnings: lines.filter(l => l.startsWith('WARN')).map(l => l.slice(6)), notes: [] }

  // Columns
  lines.push('', 'COLUMNS')
  const cols = header.map((name, i) => {
    const values = rows.map(r => r[i] ?? '')
    const filled = values.filter(Boolean)
    const distinct = new Set(filled).size
    return { name, i, values, filled: filled.length, distinct, avgLen: filled.length ? Math.round(filled.reduce((a, v) => a + v.length, 0) / filled.length) : 0 }
  })
  for (const c of cols) {
    const fill = Math.round((100 * c.filled) / rows.length)
    const examples = [...new Set(c.values.filter(Boolean))].slice(0, 3).map(v => (v.length > 40 ? v.slice(0, 40) + '…' : v))
    lines.push(`  ${c.name.padEnd(16)} filled ${String(fill).padStart(3)}%  distinct ${String(c.distinct).padStart(4)}  avgLen ${String(c.avgLen).padStart(4)}  e.g. ${examples.join(' | ')}`)
    if (c.filled > 0 && fill < 90) warn(`column "${c.name}" is empty in ${rows.length - c.filled} rows — optional field, or a selector that misses some row variants?`)
    if (c.filled === 0) warn(`column "${c.name}" is always empty — wrong selector or attr`)
    if (rows.length >= 5 && c.distinct === 1 && c.filled === rows.length) warn(`column "${c.name}" has the same value in every row`)
    if (c.values.some(v => (v.startsWith('data:') ? v.length < 400 : /spacer|placeholder|1x1/i.test(v)))) warn(`column "${c.name}" contains placeholder-looking values (lazy images?)`)
    // Text the page cut short ("…"). A note, not a warning: user-written text ends with "..." too.
    const cut = c.values.filter(v => /(\.\.\.|…)$/.test(v))
    if (cut.length) note(`column "${c.name}": ${cut.length} values end with "…" — if the page shortened them, the full text may be in a title attribute or a detail page, and a regex/split label that came after the cut is missing (the value runs on). e.g. …${cut[0].slice(-40)}`)
  }
  for (let a = 0; a < cols.length; a += 1) {
    for (let b = a + 1; b < cols.length; b += 1) {
      if (cols[a].filled && cols[a].values.every((v, k) => v === cols[b].values[k])) warn(`columns "${cols[a].name}" and "${cols[b].name}" are identical — two fields hit the same element`)
    }
  }

  // Links that point to the same page and differ only in tracking parameters / #fragment
  const TRACKING = /^(utm_.*|pp|si|feature|fbclid|gclid|dclid|msclkid|yclid|igsh.*|ref|ref_.*|refsrc|spm|scm|share.*|trk|tracking.*|_ga.*|_gl|mc_.*|sr|qid|sprefix|crid|ved|ei|sxsrf|t|time_continue|ab_channel|vd_source|from|source|src)$/i
  const normLink = v => {
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
  for (const c of cols) {
    const links = c.values.filter(v => /^https?:\/\//i.test(v))
    if (links.length < Math.max(3, c.filled * 0.8)) continue
    const groups = new Map()
    for (const v of links) groups.set(normLink(v), (groups.get(normLink(v)) ?? new Set()).add(v))
    const multi = [...groups.values()].filter(g => g.size > 1)
    if (multi.length) warn(`column "${c.name}": ${multi.reduce((a, g) => a + g.size - 1, 0)} links are the same page as another row apart from tracking parameters — duplicates? e.g. ${[...multi[0]].slice(0, 2).join('  vs  ')}`)
  }

  // Duplicates
  const keyCount = new Map()
  for (const r of rows) keyCount.set(r.join('\u0001'), (keyCount.get(r.join('\u0001')) ?? 0) + 1)
  const dups = [...keyCount.values()].filter(n => n > 1).reduce((a, n) => a + n - 1, 0)
  if (dups) warn(`${dups} duplicate rows`)

  // Shape outliers: which columns are filled, compared with the most common pattern
  const shape = r => r.map(v => (v ? 1 : 0)).join('')
  const shapes = new Map()
  for (const r of rows) shapes.set(shape(r), (shapes.get(shape(r)) ?? 0) + 1)
  const [majority] = [...shapes.entries()].sort((a, b) => b[1] - a[1])[0]
  const outliers = rows.map((r, idx) => ({ r, idx })).filter(({ r }) => {
    const s = shape(r)
    const filledHere = [...s].filter(x => x === '1').length
    const filledMajority = [...majority].filter(x => x === '1').length
    return s !== majority && filledHere < filledMajority - 0 && filledHere <= Math.max(1, filledMajority / 2)
  })
  if (outliers.length) {
    warn(`${outliers.length} rows fill far fewer columns than the usual row — control rows, group headers, ads? Check them:`)
    for (const { r, idx } of outliers.slice(0, 6)) lines.push(`        row ${idx + 1}: ${r.map(v => (v.length > 30 ? v.slice(0, 30) + '…' : v)).join(' | ')}`)
  }
  // Text-length outliers on the first text column (a header/total row inside data, a merged blob)
  const lens = rows.map(r => (r[0] ?? '').length).sort((a, b) => a - b)
  const median = lens[Math.floor(lens.length / 2)]
  const blobs = rows.filter(r => (r[0] ?? '').length > Math.max(200, median * 5)).length
  if (blobs) warn(`${blobs} rows have a first column 5× longer than usual — a merged container caught as one row?`)

  // The collector's summary: limits hit, totals the page claims
  if (summary) {
    if (summary.warning) warn(summary.warning)
    const bigger = (summary.claimedTotals ?? []).filter(c => c.n >= rows.length * 1.25)
    const matched = (summary.claimedTotals ?? []).some(c => Math.abs(c.n - rows.length) <= Math.max(1, rows.length * 0.05))
    if (bigger.length && !matched) warn(`the page shows ${bigger.map(c => `"${c.text}"`).join(', ')} but the CSV has ${rows.length} rows — stopped early, or the number counts more than the list shows (replies, hidden items)? Say which in the report.`)
    const other = (summary.scrollCandidates?.candidates ?? []).filter(c => !c.configured)
    if (other.length) warn(`scrolling stopped adding rows; these elements around the rows can also scroll — if the list should have more, try one as next.scroller: ${other.map(c => `${c.selector} (${c.clientHeight}px of ${c.scrollHeight}px, at ${c.scrollTop})`).join('  |  ')}`)
    if (summary.unreadLinks) {
      const { withLinks, rows: seen, example } = summary.unreadLinks
      note(`${withLinks} of the first ${seen} rows link to pages of their own (e.g. ${example}) but no column reads a link — add a column with attr "href" for the row's own page, and one for its author / shop / source if it links there; skip this if the user asked for certain columns only`)
    }
    if (summary.unreadParts) {
      const { of, parts } = summary.unreadParts
      const list = parts.map(p => (p.kind === 'image' ? `an image (${p.selector}, e.g. ${p.sample}; ${p.rows} of ${of} rows)` : `"${p.sample}" (${p.selector}; ${p.rows} of ${of} rows)`)).join(', ')
      note(`the rows show more than the columns read: ${list} — add a column for each that is data (a count, a label, a level, a place, a picture) unless the user named the columns; controls and decoration can stay out`)
    }
    if (summary.duplicatesMergedByLink) note(`${summary.duplicatesMergedByLink} rows were dropped as duplicates because their links matched apart from tracking parameters`)
  }

  lines.push('', 'FIRST ROWS')
  for (const r of rows.slice(0, 3)) lines.push('  ' + r.map(v => (v.length > 40 ? v.slice(0, 40) + '…' : v)).join(' | '))
  lines.push('LAST ROWS')
  for (const r of rows.slice(-3)) lines.push('  ' + r.map(v => (v.length > 40 ? v.slice(0, 40) + '…' : v)).join(' | '))
  const warnings = lines.filter(l => l.startsWith('WARN')).map(l => l.slice(6))
  if (!warnings.length) lines.push('', 'OK  no warnings')
  if (notes.length) lines.push('', ...notes)
  return { lines, warnings, notes: notes.map(n => n.slice(6)) }
}
