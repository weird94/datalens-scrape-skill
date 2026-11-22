// `collect.mjs … --resume`: what a saved run (its summary and CSV) allows the next run to do.
// Pure functions (no file system), so they can be tested without a browser.
//
// The summary of every save carries a `resume` block: a key of the config parts that decide what is read, and
// where the run stood after the last page it finished (pages read, that page's URL, a few of its rows). A run
// with --resume then goes on
//   - next.type "url": at the next page of the template;
//   - next.type "click" whose pages each had a URL of their own: on the last page it finished (checked to show
//     that page's rows), clicking on from there;
//   - otherwise (scrolling, load-more, a click that changes the page in place): from the top, with the saved
//     rows seeded, so nothing saved is lost and nothing is doubled.
import { createHash } from 'node:crypto'
import { parseCsv } from './csv.mjs'
import { END_OF_LIST, fromStartNote, planResumeAt, urlPage } from './resume-at.mjs'

export { END_OF_LIST, fromStartNote, urlPage }

/** Config keys that change which rows a run reads. Limits (maxPages, maxRows) and pacing are left out. */
export const RESUME_KEYS = ['url', 'rows', 'fields', 'next', 'require', 'dedupe', 'setup', 'expand', 'fillDown']
/** Parts of `next` that only pace the run (how long to wait after a click): they may change between the parts. */
const NEXT_PACING = ['waitMs', 'quietMs']

/** JSON with object keys sorted, so the same config written in another key order gives the same text. */
function stableJson(value) {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`
  if (value && typeof value === 'object') {
    return `{${Object.keys(value)
      .sort()
      .filter(key => value[key] !== undefined)
      .map(key => `${JSON.stringify(key)}:${stableJson(value[key])}`)
      .join(',')}}`
  }
  return JSON.stringify(value ?? null)
}

/** A short key of what a config reads (RESUME_KEYS). */
export function configKey(config) {
  const parts = Object.fromEntries(RESUME_KEYS.map(key => [key, config[key] ?? null]))
  if (parts.next && typeof parts.next === 'object') parts.next = Object.fromEntries(Object.entries(parts.next).filter(([key]) => !NEXT_PACING.includes(key)))
  return createHash('sha256').update(stableJson(parts)).digest('hex').slice(0, 16)
}

/** How a list of this config gets more rows, as the resume block names it. */
export const pagingOf = config => config.next?.type ?? 'scroll'

/**
 * The `resume` block of a summary: the config key and the collector's position (after the last page it
 * finished), plus, for a URL template, the page a resumed run loads first.
 */
export function resumeBlock(config, position) {
  const block = { config: configKey(config), paging: pagingOf(config), ...(position ?? { pages: 0 }) }
  if (config.next?.type === 'url' && block.pages >= 1) block.next = urlPage(config, block.pages)
  return block
}

/**
 * The rounds of the saved run, from its summary: `roundLog` shortened to its first and last rounds gets the
 * skipped ones back as placeholders ({ round, skipped: true }), so the next rounds are numbered on and the
 * summary of the whole run shortens the same way.
 */
export function priorRounds(summary) {
  const rounds = []
  for (const entry of summary?.roundLog ?? []) {
    if (entry && typeof entry.skipped === 'number' && entry.round === undefined) {
      for (let i = 0; i < entry.skipped; i += 1) rounds.push({ round: rounds.length + 1, skipped: true })
    } else rounds.push(entry)
  }
  return rounds
}

/**
 * What `--resume` does with the saved run.
 *   config — this run's config; summary — the saved summary (null: none); csvText — the saved CSV (null: none)
 * → { refuse: message } | { done: true, message } | { how: 'continued' | 'from-start', seedRows, resumeAt, resumedFrom }
 * `resumeAt` goes to collectOnPage (lib.resumeAt); `resumedFrom` is what the summary says about the saved run.
 */
export function resumePlan({ config, summary, csvText }) {
  const startOver = 'Use a new --out, or rerun without --resume to start over (that replaces the saved files).'
  if (!summary) return { refuse: '--resume: no saved run at --out (no summary file next to the CSV). Run without --resume.' }
  const saved = summary.resume
  if (!saved?.config) return { refuse: `--resume: the saved summary has no resume information (written by an older collect.mjs). ${startOver}` }
  if (saved.config !== configKey(config)) {
    return { refuse: `--resume: the config changed since the saved run (${RESUME_KEYS.join(', ')} must stay the same). ${startOver}` }
  }
  if (csvText === null || csvText === undefined) return { refuse: `--resume: the saved CSV is missing. ${startOver}` }
  let csv
  try {
    csv = parseCsv(csvText)
  } catch (error) {
    return { refuse: `--resume: the saved CSV cannot be read (${error.message}). ${startOver}` }
  }
  const columns = Object.keys(config.fields)
  if (csv.columns.join('\u0000') !== columns.join('\u0000')) {
    return { refuse: `--resume: the saved CSV has other columns (${csv.columns.join(', ')}) than the config's fields (${columns.join(', ')}). ${startOver}` }
  }
  const pages = Number(saved.pages ?? 0)
  const position = { pages, turn: Number(saved.turn ?? 0), url: saved.url ?? null, rows: Number(saved.rows ?? csv.rows.length), keys: saved.keys ?? [], urlPerPage: saved.urlPerPage ?? null }
  // What the summary of the whole run adds up.
  const carry = {
    rounds: priorRounds(summary),
    claimed: summary.claimedTotals ?? [],
    mergedByLink: summary.duplicatesMergedByLink ?? 0,
    mergedSameRecord: summary.sameRecordMerged ?? 0,
  }
  const plan = planResumeAt({ config, position, stopReason: summary.stopReason, wall: summary.wall, note: summary.note, rowCount: csv.rows.length, carry })
  if (plan.done) {
    const tail = plan.reason === 'end-of-list'
      ? '; nothing to resume, the files are left as they are. To collect the list again, run without --resume.'
      : `: nothing more to read, the files are left as they are. Raise --${plan.reason} to go on.`
    return { done: true, message: `--resume: ${plan.done}${tail}` }
  }
  const { how, at, note, resumeAt } = plan
  const resumedFrom = { rows: csv.rows.length, stopReason: summary.stopReason, pages, how, ...(at ? { at } : { note }) }
  return { how, seedRows: csv.rows, resumeAt, resumedFrom }
}
