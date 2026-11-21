// Page-side engine of the skill, for hosts other than the CLI scripts (the extension).
// Everything here only needs a Playwright-like `page` object (see index.d.ts for the subset used).
export { installDlk } from './in-page.mjs'
export { collectOnPage } from './collector.mjs'
export { CHUNK_SOURCES, chunkCall, collectInChunks } from './chunks.mjs'
export { inspectOnPage } from './inspector.mjs'
export { verifyTable } from './verifier.mjs'
export { checkDetailSpec, classifyDetail, detailBatchProgram, detailLink, detailSpecKey, detailStatusColumn, mergeDetailRows, needsDetailFetch, nextStreaks, readDetailBatch, readDetailCheckpoint, readDetailPage, DETAIL_STATUS_COLUMN, DETAIL_STREAK_LIMIT } from './detail.mjs'
export { csvCell, parseCsv, toCsv } from './csv.mjs'
export { gotoAndSettle, runSetup, settle } from './page-helpers.mjs'
export { expandMissedText, expandNoEffectText, expandPastStartText, expandReplacedText, expandShrankText, formatInspectReport, summarizeCollect, summarizeDetail } from './report-format.mjs'
