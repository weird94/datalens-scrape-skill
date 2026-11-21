/**
 * Types for the skill's page-side engine. The functions only use the subset of Playwright's `page`
 * below, so a host can run them on anything that implements it (the extension's ChromeTabPage).
 */

export interface SkillLocator {
  first(): SkillLocator
  click(options?: { timeout?: number; force?: boolean }): Promise<void>
  fill(text: string, options?: { timeout?: number }): Promise<void>
  press(key: string): Promise<void>
  selectOption(value: string | { label: string }, options?: { timeout?: number }): Promise<unknown>
  hover(options?: { timeout?: number }): Promise<void>
  scrollIntoViewIfNeeded(options?: { timeout?: number }): Promise<void>
  waitFor(options?: { state?: 'attached' | 'visible'; timeout?: number }): Promise<void>
  evaluate<R, A>(fn: (el: Element, arg: A) => R, arg?: A, options?: { timeout?: number }): Promise<R>
}

/** The part of Playwright's Page the engine calls. `url()` is synchronous, like Playwright's. */
export interface SkillPage {
  evaluate<R>(fn: () => R | Promise<R>): Promise<R>
  evaluate<R, A>(fn: (arg: A) => R | Promise<R>, arg: A): Promise<R>
  goto(url: string, options?: { waitUntil?: string; timeout?: number }): Promise<{ status(): number } | null>
  waitForLoadState(state?: 'load' | 'domcontentloaded', options?: { timeout?: number }): Promise<void>
  waitForTimeout(ms: number): Promise<void>
  waitForURL(url: (url: URL) => boolean, options?: { waitUntil?: 'commit' | 'load' | 'domcontentloaded'; timeout?: number }): Promise<void>
  url(): string
  click(selector: string, options?: { timeout?: number }): Promise<void>
  bringToFront(): Promise<void>
  locator(selector: string): SkillLocator
  keyboard: { press(key: string): Promise<void> }
}

export type FieldSpec =
  | string
  | {
      css?: string
      attr?: string
      index?: number
      all?: boolean
      join?: string
      sibling?: number
      exists?: boolean
      matches?: string
      exclude?: string
      split?: string
      part?: number
      regex?: string
      flags?: string
      replace?: [string, string][]
      number?: boolean
      default?: string
    }

export type SetupStep = Record<string, unknown> & { optional?: boolean; timeoutMs?: number }

export interface NextSpec {
  type: 'click' | 'load-more' | 'scroll' | 'url' | 'none'
  selector?: string
  scroller?: string
  step?: number
  url?: string
  start?: number
  waitMs?: number
  quietMs?: number
}

/** The JSON config the agent writes (SKILL.md "Config"). */
export interface ScrapeConfig {
  url: string
  rows: string
  fields: Record<string, FieldSpec>
  setup?: SetupStep[]
  next?: NextSpec | null
  require?: string[]
  dedupe?: string[]
  fillDown?: string[]
  expand?: string[]
  dismiss?: string[]
  autoDismiss?: boolean
  waitFor?: string
  waitTimeoutMs?: number
  initialWaitMs?: number
  maxPages?: number
  maxRows?: number
  stagnantRounds?: number
  quietMs?: number
  delayMs?: number
}

export interface RoundEntry {
  round: number
  label: string
  onPage: number
  filtered: number
  added: number
  total: number
  /** Rows on the page left unread because maxRows was reached in this round. */
  cutAtMaxRows?: number
}

export interface WallInfo {
  kind: 'blocked' | 'login' | null
  evidence: string
  title: string
  textHead: string
  /** What was seen apart from the HTTP status: a visible challenge element, block text, login text. */
  signals?: { challenge: boolean; text: string | null; login: string | null }
}

export interface ScrollCandidate {
  selector: string
  clientHeight: number
  scrollHeight: number
  scrollTop: number
  configured: boolean
}

export interface CollectResult {
  rows: Record<string, string>[]
  rounds: RoundEntry[]
  stopReason: string | null
  note: string
  /** "NOT THE END: …" when a limit stopped a list that was still growing. */
  warning: string
  totalCheck?: string
  claimed: { text: string; n: number }[]
  mergedByLink: number
  /** Rows recognised as a record read before (another element, or the preview) apart from counts, pictures and empty cells. */
  mergedSameRecord: number
  scrollCandidates?: ScrollCandidate[]
  setupLog: { done: unknown[]; error?: string } | null
  wall: WallInfo | null
  tail: string
  lastUrl: string
  /** Rows the host handed in (`seedRows`) that start the result. */
  seeded: number
  /** Rows on the page went down after an expand pass (an expand selector also hit a "hide" button). */
  expandShrank: { from: number; to: number; at: string } | null
  /** Rows whose element showed other values after an expand click (a pager inside the record); the first values were kept. */
  expandReplaced?: number
  /** Per column those rows kept a value of: how many rows, and the first change seen (snippets around it). */
  expandReplacedCells?: { column: string; rows: number; was: string; now: string }[]
  /** Columns those rows had empty and took from the opened record (their changed cells went from cut off to whole). */
  expandFilledCells?: { column: string; rows: number }[]
  /** Controls among the rows that say "more" / "next" and that the expand selectors did not click (first page). */
  expandMissed?: { text: string; count: number; selector: string; after?: string }[]
  /** "Previous" controls among the rows before the run's first expand click: a record's own pager is past its first page. */
  expandPastStart?: { text: string; count: number; selector: string; after?: string }[]
  /** Expand clicks on the first page that did nothing: the element is still there and nothing around it changed. */
  expandNoEffect?: { clicked: number; stale: number; left: { text: string; selector: string }[] } | null
  /** Per expand selector that clicked anything: how many clicks, and the controls' labels (one per kind, numbers aside), most clicked first. */
  expandClicked?: { selector: string; clicks: number; labels: string[] }[]
  /** Page 1's rows link to pages of their own but no field reads a link (`window.__dlk.unreadLinks`). */
  unreadLinks?: UnreadLinks | null
  /** Page 1's rows show texts or images no field reads (`window.__dlk.unreadParts`). */
  unreadParts?: { of: number; parts: { kind: 'text' | 'image'; selector: string; sample: string; rows: number }[] } | null
  /** Only with a `confirmStop` hook: what the host said when the rules wanted to stop. */
  aiStop?: AiStopReport
}

/** What the host said when the rules wanted to stop, over the whole run. */
export interface AiStopReport {
  /** Times the host was asked. */
  asks: number
  /** How the run ended: `confirmed-complete`, `wall`, `possibly-incomplete`, or a `rules (…)` fallback; null when the
   *  run ended without the host deciding (a limit, the user, an error). */
  outcome: string | null
  /** Each answer in order; `unavailable` when there was none. */
  verdicts: string[]
  /** The host's last sentence for the user. */
  userMessage: string | null
  /** Actions the host proposed that were done on the page. */
  remedies: number
}

export type StopVerdict = 'complete' | 'incomplete' | 'wall' | 'still_loading' | 'no_evidence'

/** What `confirmStop` is asked with: the rules' stop reason, the rows so far, and the end of the list as an
 *  accessibility tree whose `[ref=eN]` name elements a remedy may act on. */
export interface ConfirmStopRequest {
  stopReason: string
  rowCount: number
  maxRows: number | null
  paging: 'scroll' | 'click' | 'load-more' | 'url' | 'none'
  url: string
  headRows: Record<string, string>[]
  tailRows: Record<string, string>[]
  rounds: RoundEntry[]
  evidence: { tree: string; snippets: string; listRootFound: boolean }
}

export interface ConfirmStopAnswer {
  verdict: StopVerdict
  /** With `incomplete`: one thing to do on the page before going on. */
  remedy?: { ref: string; action: 'click' | 'scrollTo' | 'scrollWithin' } | null
  userMessage?: string | null
}

/** Rows that carry links of their own while no field reads `href`. */
export interface UnreadLinks {
  /** Rows looked at (the first 30 of page 1). */
  rows: number
  /** Of those, rows with at least one link to another page. */
  withLinks: number
  /** One of the row-specific links. */
  example: string
}

/** A field for an element a person clicked in a row (`window.__dlk.pick`). */
export interface PickedField {
  field: { css: string; index?: number; attr?: 'href' | 'src' }
  /** What the field reads in the clicked row. */
  sample: string
  /** Share of the rows on the page where the field reads something, 0–100. */
  fill: number
}

/** `window.__dlk.pick` resolves with this when the click was not inside a row. */
export interface PickOutsideRow {
  error: 'not-in-row'
}

export interface PageHelpers {
  settle: typeof settle
  gotoAndSettle: typeof gotoAndSettle
  runSetup: typeof runSetup
  installDlk: typeof installDlk
}

export interface CollectHooks {
  /** After each round: the round, and the rows and rounds so far (live arrays; rows may still change in place). */
  onRound?: (round: RoundEntry, progress: { rows: Record<string, string>[]; rounds: RoundEntry[] }) => void | Promise<void>
  /** After each read of the page, also half-way through a round (expand passes): the rows and rounds so far (live arrays). */
  onRows?: (progress: { rows: Record<string, string>[]; rounds: RoundEntry[] }) => void | Promise<void>
  /** Return a stop reason to end the run with the rows collected so far. */
  shouldStop?: (rowCount: number) => string | null | Promise<string | null>
  /** Asked when the rules want to stop (not at a limit, a user stop or `next: { type: 'none' }`). Its answer decides; null or a
   *  throw leaves it to the rules. Three asks in a row without new rows hand the decision back to the rules. */
  confirmStop?: (request: ConfirmStopRequest) => Promise<ConfirmStopAnswer | null>
  /** Rows already collected from this page (a preview): they start the result and are not added again. */
  seedRows?: Record<string, string>[]
  /** Run in chunks: return `{ paused: true, state }` once a call has done this many steps (page 1 and the turns of
   *  the paging loop) or run this long. */
  pauseAfter?: { steps?: number; ms?: number }
  /** A state a paused call returned (as JSON): go on from it in the same tab, without loading the page again. */
  resume?: CollectState | null
}

/** What a paused call hands back: plain JSON (rows, rounds, counters, expand bookkeeping); `url` is where the tab is,
 *  `doc` the document it showed (a later call in another document stops with stopReason "error"). */
export interface CollectState {
  version: number
  url: string
  doc: string | null
  rows: Record<string, string>[]
  rounds: RoundEntry[]
  [key: string]: unknown
}

export type CollectPaused = { paused: true; state: CollectState }

export interface InspectOptions {
  url: string
  wait?: number
  setup?: SetupStep[]
  clicks?: string[]
  scroll?: boolean
  probes?: string[]
  html?: string[]
  /** Texts to locate on the page (find). */
  find?: string[]
  /** Selectors or refs whose element is printed as a tree (a closed part of the page tree, one record). */
  tree?: string[]
  text?: boolean
}

/** A part of the page as an indented tree (in-page.mjs `tree`). */
export interface PageTree {
  selector: string
  /** "first of N" when the selector matched several elements. */
  note?: string
  /** Why nothing matched; then there is no text. */
  why?: string
  /** Lines of the whole part, open or not. */
  lines?: number
  text?: string
}

/** inspect.mjs's report; shapes of the nested entries follow in-page.mjs. */
export interface InspectReport {
  url: string
  status?: number | null
  title?: string
  textLength?: number
  notRendering?: boolean
  setup?: { done: unknown[]; error?: string }
  clicks?: unknown[]
  clickError?: string
  wall?: WallInfo
  lists?: unknown[]
  controls?: unknown[]
  pagers?: unknown[]
  scroll?: unknown
  overlays?: unknown[]
  /** The call asked about particular elements: only the top lists, no tree / controls / scroll / overlays. */
  brief?: boolean
  /** Open shadow roots on the page. */
  shadowRoots?: number
  /** The whole page's tree (full overview only). */
  tree?: PageTree
  /** The parts asked for with `tree`. */
  trees?: PageTree[]
  finds?: unknown[]
  probes?: unknown[]
  textHead?: string
  textTail?: string
  error?: string
}

export function installDlk(): void
export function settle(page: SkillPage, options?: { quietMs?: number; maxMs?: number }): Promise<void>
export function gotoAndSettle(page: SkillPage, url: string, options?: { wait?: number }): Promise<number | null>
export function runSetup(page: SkillPage, steps?: SetupStep[]): Promise<{ done: unknown[]; error?: string }>
/** With `pauseAfter` a call may return paused; without it, it runs to the end. */
export function collectOnPage(page: SkillPage, config: ScrapeConfig, lib: PageHelpers & CollectHooks & { pauseAfter: { steps?: number; ms?: number } }): Promise<CollectResult | CollectPaused>
export function collectOnPage(page: SkillPage, config: ScrapeConfig, lib: PageHelpers & CollectHooks): Promise<CollectResult>
/** Function declarations (as source) a run-code call needs to run collectOnPage. */
export const CHUNK_SOURCES: string[]
/** The expression one chunked call evaluates (CHUNK_SOURCES in scope, `page` bound). */
export function chunkCall(config: ScrapeConfig, state: CollectState | null, pauseAfter: { steps?: number; ms?: number }): string
/** Call `runChunk` until a result is not paused; `onPause` runs between calls with the state so far. */
export function collectInChunks(
  runChunk: (state: CollectState | null, n: number) => Promise<CollectResult | CollectPaused> | CollectResult | CollectPaused,
  onPause?: (state: CollectState) => void | Promise<void>
): Promise<CollectResult>
export function inspectOnPage(page: SkillPage, opts: InspectOptions, lib: PageHelpers): Promise<InspectReport>
/** inspectOnPage's report as inspect.mjs prints it. */
export function formatInspectReport(report: InspectReport & { browser?: string }): string
/** collectOnPage's result without the rows, as collect.mjs writes it next to the CSV. */
export function summarizeCollect(result: CollectResult, extra?: Record<string, unknown>): Record<string, unknown>
/** The warning text for `CollectResult.expandPastStart`. */
export function expandPastStartText(past: NonNullable<CollectResult['expandPastStart']>): string
/** The warning text for `CollectResult.expandNoEffect`. */
export function expandNoEffectText(noEffect: NonNullable<CollectResult['expandNoEffect']>): string
/** The warning text for `CollectResult.expandMissed`. */
export function expandMissedText(missed: NonNullable<CollectResult['expandMissed']>): string
/** The warning text for `CollectResult.expandReplaced`. */
export function expandReplacedText(
  count: number,
  cells?: CollectResult['expandReplacedCells'],
  filled?: CollectResult['expandFilledCells']
): string
/** The warning text for `CollectResult.expandShrank`. */
export function expandShrankText(shrank: NonNullable<CollectResult['expandShrank']>): string
export function verifyTable(input: {
  header: string[]
  rows: string[][]
  summary?: Record<string, unknown> | null
}): { lines: string[]; warnings: string[]; notes: string[] }

// ---------- detail pages (scripts/detail.mjs) ----------

/** detail.json: which list column holds each row's detail URL and what to read on that page. */
export interface DetailSpec {
  link: string
  fields: Record<string, FieldSpec>
  /** CSS of the detail record on the page; fields are read relative to it (default: the whole page). */
  root?: string
  /** A page where any of these is empty counts as empty. */
  require?: string[]
  /** Wait for this selector before reading (default: until the fields show up and the page is quiet). */
  waitFor?: string
  waitTimeoutMs?: number
  quietMs?: number
  setup?: SetupStep[]
  expand?: string[]
  dismiss?: string[]
  autoDismiss?: boolean
  delayMs?: number
  concurrency?: number
  maxAttempts?: number
}

export type DetailStatus = 'ok' | 'empty' | 'failed' | 'blocked'

export interface DetailRead {
  status: DetailStatus
  fields: Record<string, string>
  error?: string
  httpStatus?: number
  /** HTTP 404 / 410: a dead link (status 'empty'). */
  notFound?: boolean
  expandClicks?: number
}

/** One checkpoint line (`<out>.detail.jsonl`). */
export interface DetailEntry extends DetailRead {
  url: string
  attempts: number
  /** detailSpecKey of the spec it was read with. */
  spec?: string
  /** The browser that read it ('bundled' | 'chrome'); an empty page is read again by the other one. */
  browser?: string
  /** An empty page the run could not vouch for yet (no ok page after it): read again on a rerun. */
  unconfirmed?: boolean
}

export type DetailStopReason = 'done' | 'max-rows' | 'blocked' | 'no-data' | 'tab-not-rendering' | 'interrupted' | 'error'

export interface DetailStreaks {
  blocked: number
  empty: number
}

export const DETAIL_STATUS_COLUMN: 'detail_status'
export const DETAIL_STREAK_LIMIT: number
/** Open one detail page and read the spec's fields there. Never throws: failures come back as 'failed'. */
export function readDetailPage(page: SkillPage, url: string, spec: DetailSpec, lib: PageHelpers): Promise<DetailRead>
/**
 * Several detail pages in one tab, with jittered pauses; stops early when a streak reaches `state.limit`,
 * and with `notRendering` (no results) when the browser does not draw the tab.
 */
export function readDetailBatch(
  page: SkillPage,
  urls: string[],
  spec: DetailSpec,
  lib: PageHelpers,
  state?: Partial<DetailStreaks> & { limit?: number; delayFirst?: boolean }
): Promise<{ results: Array<DetailRead & { url: string }>; notRendering?: boolean }>
export function classifyDetail(input: {
  httpStatus: number | null
  rec: Record<string, string> | null
  fields: Record<string, FieldSpec>
  required?: string[]
  root?: string | null
  wall?: WallInfo | null
}): DetailRead
/** Sources and call for `playwright-cli run-code` (lib/chrome.mjs) that read `urls` with readDetailBatch in the user's Chrome. */
export function detailBatchProgram(
  urls: string[],
  spec: DetailSpec,
  state?: Partial<DetailStreaks> & { limit?: number; delayFirst?: boolean }
): { sources: string[]; call: string }
export function nextStreaks(streaks: DetailStreaks, result: Pick<DetailRead, 'status' | 'notFound'>): DetailStreaks
/** An absolute http(s) URL from a list cell, or null. */
export function detailLink(value: unknown): string | null
/** The output's status column: `detail_status`, or `detail_status_2`… when the list already has one. */
export function detailStatusColumn(listColumns: string[]): string
/** Problems with a detail spec against the list's columns; empty when it is fine. */
export function checkDetailSpec(spec: unknown, listColumns: string[]): string[]
export function detailSpecKey(spec: DetailSpec): string
export function needsDetailFetch(
  entry: DetailEntry | undefined,
  maxAttempts: number,
  options?: { browser?: string | null; retryEmpty?: boolean }
): boolean
export function readDetailCheckpoint(text: string, specKey?: string | null): { entries: Map<string, DetailEntry>; stale: number }
export function mergeDetailRows(
  listRows: Record<string, string>[],
  linkColumn: string,
  detailNames: string[],
  entries: Map<string, DetailEntry>,
  statusColumn?: string
): Record<string, string>[]
/** Counts by status per row (as the output's status column), fill rates on ok pages, warnings. */
export function summarizeDetail(input: {
  /** Each list row's detail URL (null: no usable link). */
  rowUrls: Array<string | null>
  entries: Map<string, DetailEntry>
  detailNames: string[]
  stopReason: DetailStopReason
  note?: string
  maxRows?: number
  canary?: Array<{ url: string; status: DetailStatus; error?: string; afterEmpty: number }>
  extraWarnings?: string[]
  extra?: Record<string, unknown>
}): Record<string, unknown>

// ---------- CSV ----------
export function csvCell(value: unknown): string
/** Header + rows, UTF-8 BOM in front, "\n" line ends; a one-column row with an empty cell is written as "". */
export function toCsv(columns: string[], rows: Record<string, unknown>[]): string
/** RFC 4180 CSV (BOM, quoted commas / line breaks / doubled quotes) → columns and rows keyed by column. */
export function parseCsv(text: string): { columns: string[]; rows: Record<string, string>[] }
