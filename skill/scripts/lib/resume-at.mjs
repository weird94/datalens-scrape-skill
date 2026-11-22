// Where a list run that stopped goes on from: the part of `collect.mjs --resume` (lib/resume.mjs) that needs no
// file system and no node: module, so a host that keeps its own checkpoint (the extension) decides the same way.
//   next.type "url": at the next page of the template;
//   next.type "click" whose pages each had a URL of their own: on the last page it finished, clicking on from there;
//   otherwise (scrolling, load-more, a click that changes the page in place): from the top, with the saved rows
//   seeded, so nothing saved is lost and nothing is doubled.

/** Stop reasons that mean the list ended: nothing to resume (unless the page looked like a wall). */
export const END_OF_LIST = new Set([
  'single-page',
  'next-control-gone',
  'next-click-no-effect',
  'no-rows-after-page-turn',
  'no-new-rows',
  'load-more-gone',
  'load-more-no-new-rows',
  'scroll-end',
  'scroll-blocked',
  'url-page-empty',
  'url-page-no-new-rows',
])

/** The page a URL template run loads after `pages` pages (the collector's own formula). */
export const urlPage = (config, pages) => config.next.url.replace('{page}', String((config.next.start ?? 2) + pages - 1))

/**
 * Pages by URL that ended on a page that is not there (HTTP 404 / 410, next to no text, nothing that looks like a
 * bot check or a login): the page after the last one. The collector calls that a wall (a site may answer a bot
 * with an error page), but going on would only ask for the same missing page again.
 */
function pastLastPage(wall, note) {
  if (!wall || !/^url-page-empty\b/.test(String(note ?? ''))) return false
  return /\bHTTP 4(04|10)\b/.test(String(wall.evidence ?? '')) && !wall.signals?.challenge && !wall.signals?.text && !wall.signals?.login
}

/** Why a resumed run reads the list again from the top. */
export function fromStartNote(config, pages) {
  const type = config.next?.type ?? 'scroll'
  const why = type === 'scroll'
    ? 'a scrolling list cannot be entered half-way'
    : type === 'load-more'
      ? 'a load-more list cannot be entered half-way'
      : type === 'click' && pages < 2
        ? 'the saved run had not turned a page yet'
        : type === 'click'
          ? "the list's pages have no URL of their own"
          : 'this list has no pages to go back to'
  return `read the list again from the top (${why}); the saved rows were kept, and rows read again were not added twice`
}

/**
 * How the next run goes on from one that stopped.
 *   config — the next run's config (its maxPages / maxRows decide whether a run stopped at a limit can go on)
 *   position — the collector's position after the last page it finished (CollectPosition; null: none yet)
 *   stopReason, wall, note — how the stopped run ended (its summary's fields)
 *   rowCount — the rows it kept; carry — what the whole run adds up ({ rounds, claimed, mergedByLink, mergedSameRecord })
 * → { done: message, reason: 'end-of-list' | 'max-pages' | 'max-rows' } (nothing to read: the message names why)
 *   | { how: 'continued', at, resumeAt } | { how: 'from-start', note, resumeAt }
 * `resumeAt` goes to collectOnPage (lib.resumeAt), with the kept rows as seedRows.
 */
export function planResumeAt({ config, position = null, stopReason, wall = null, note = '', rowCount = 0, carry = {} }) {
  if ((END_OF_LIST.has(stopReason) && !wall) || pastLastPage(wall, note)) {
    return { done: `the saved run already reached the end of the list (stopReason ${stopReason})`, reason: 'end-of-list' }
  }
  const pages = Number(position?.pages ?? 0)
  // Stopped at a limit this run has too: going on would stop at once, with nothing new.
  const maxPages = Number(config.maxPages ?? 50)
  const maxRows = Number(config.maxRows ?? 0)
  if (stopReason === 'max-pages' && pages >= maxPages) return { done: `the saved run already read ${pages} pages, and maxPages is ${maxPages}`, reason: 'max-pages' }
  if (stopReason === 'max-rows' && maxRows > 0 && rowCount >= maxRows) return { done: `the saved run already has ${rowCount} rows, and maxRows is ${maxRows}`, reason: 'max-rows' }

  const at = config.next?.type === 'url' && pages >= 1
    ? urlPage(config, pages)
    : config.next?.type === 'click' && pages >= 2 && position?.urlPerPage && position?.url
      ? position.url
      : null
  if (!at) return { how: 'from-start', note: fromStartNote(config, pages), resumeAt: { how: 'from-start', ...carry } }
  const where = { pages, turn: Number(position.turn ?? 0), url: position.url ?? null, rows: Number(position.rows ?? rowCount), keys: position.keys ?? [] }
  return { how: 'continued', at, resumeAt: { how: 'continued', ...where, ...carry } }
}
