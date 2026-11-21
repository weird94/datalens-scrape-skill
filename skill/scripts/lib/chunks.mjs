// Running a collection as a series of bounded calls, so the host can save rows between them.
//
// In the user's Chrome the whole loop runs inside one `playwright-cli run-code` call: nothing comes back until
// it returns. Split into chunks, each call runs the loop for a while (collectOnPage's `pauseAfter`) and hands
// back its state as JSON; the host writes the CSV, and the next call goes on from that state (`resume`) in the
// same tab. The same calls run against a bundled browser's page in the tests.
import { collectOnPage } from './collector.mjs'
import { installDlk } from './in-page.mjs'
import { gotoAndSettle, runSetup, settle } from './page-helpers.mjs'
import { rowIdentity } from './row-identity.mjs'

/** Function declarations (as source) that one call needs in scope: collectOnPage and what it uses. */
export const CHUNK_SOURCES = [installDlk, settle, gotoAndSettle, runSetup, rowIdentity, collectOnPage].map(String)

/**
 * The expression one call evaluates (with CHUNK_SOURCES in scope and `page` bound): the first call when
 * `state` is null, otherwise the call that goes on from it. `pauseAfter`: { steps, ms } per call.
 * @param {object} config
 * @param {object | null} state
 * @param {{ steps?: number, ms?: number }} pauseAfter
 */
export function chunkCall(config, state, pauseAfter) {
  return `collectOnPage(page, ${JSON.stringify(config)}, { settle, gotoAndSettle, runSetup, installDlk, pauseAfter: ${JSON.stringify(pauseAfter)}, resume: ${JSON.stringify(state ?? null)} })`
}

/**
 * Call `runChunk(state, n)` until it returns a result that is not paused, and return that result. `state` is
 * null on the first call, then what the previous call paused with. `onPause(state)` runs between calls (save
 * the rows so far); a run that fails half-way is the host's to turn into a result from the last state.
 * @param {(state: object | null, n: number) => Promise<any> | any} runChunk
 * @param {(state: object) => Promise<void> | void} [onPause]
 */
export async function collectInChunks(runChunk, onPause = () => undefined) {
  let state = null
  for (let n = 1; ; n += 1) {
    const result = await runChunk(state, n)
    if (!result?.paused) return result
    state = result.state
    await onPause(state)
  }
}

/** collectOnPage with the same JSON round trip a run-code call has, for a page in this process. */
export function runChunkHere(page, config, lib, state, pauseAfter) {
  const json = value => JSON.parse(JSON.stringify(value))
  return collectOnPage(page, json(config), { ...lib, pauseAfter, resume: state ? json(state) : null }).then(json)
}
