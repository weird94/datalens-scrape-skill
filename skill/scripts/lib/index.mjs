// Page-side engine of the skill, for hosts other than the CLI scripts (the extension).
// Everything here only needs a Playwright-like `page` object (see index.d.ts for the subset used).
export { installDlk } from './in-page.mjs'
export { collectOnPage } from './collector.mjs'
export { inspectOnPage } from './inspector.mjs'
export { verifyTable } from './verifier.mjs'
export { gotoAndSettle, runSetup, settle } from './page-helpers.mjs'
export { expandMissedText, expandNoEffectText, expandPastStartText, expandReplacedText, expandShrankText, formatInspectReport, summarizeCollect } from './report-format.mjs'
