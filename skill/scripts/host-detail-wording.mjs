// The detail-page texts as a host that runs the detail pass in-process (the extension's side panel) serves them.
// Such a host has no detail.mjs / inspect.mjs to run, no --out file to go on from, no signals, no --browser switch
// and no pacing settings, and it keeps a result as tables of one saved result rather than CSV files. Its agent would
// go after any of those, so each passage that names them is said here without them (or left out); every rule about
// what to read and how stays word for word. Where such a host behaves otherwise, its wording says what it does: a
// run of the same spec skips pages read ok and dead links and reads every other one again (empty ones last); a
// 404 / 410 has its own status, `dead-link`; a changed spec leaves each row's earlier values until it reads that
// row's page ok; it follows only links in the list's own columns (never a link read on a detail page); and it reads
// the pages in the user's own tab, one after another, taking that tab back to the list afterwards.
// Used by sync-references.mjs; each passage must appear exactly once in its source, so an edit to the .md /
// SKILL.md that moves one fails the sync instead of letting CLI wording through.

/** [CLI passage, host wording] pairs for references/detail-pages.md. */
export const DETAIL_NOTE_HOST = [
  ["`detail.mjs` opens each row's own page", "The detail pass opens each row's own page"],
  ['It is a second pass over a list CSV:', 'It is a second pass over a collected list:'],
  ['## Before writing detail.json', '## Before writing the detail spec'],
  [
    '- **A second pass** over a detail output (for pages its rows link to) works the same way; its status column is `detail_status_2`.',
    "- **Only links in the list's own columns** can be followed: a link read on a detail page (a detail field) cannot be opened in another pass. A pass over another link column of the list gets its own status column, `detail_status_2`.",
  ],
  ['and inspect each: `inspect.mjs <url> --html "<record css>"`, `--probe "<field css>"`.', "and inspect each: the record's html, probes for the fields."],
  ['inspect that whole record (`--html "<root>"`)', 'inspect that whole record (the html of `root`)'],
  ['Check with `inspect.mjs <url> --click "<css>" --html "<record css>"`.', "Check it by inspecting the page: click the control, then look at the record's html."],
  ['`--max-rows 5` reads the first 5 links only; the rest are `pending`. Read the summary:', 'A preview reads only a few links. Read its summary:'],
  ['The preview reads only the first links; a layout that appears later in the list does not show up in it.', 'The preview reads only a few links; a layout that only other items use does not show up in it.'],
  [
    'Then run with the real `--out`. The same `--out` continues where a run stopped; a preview written to another file is not reused.',
    'Then run it. Running the same spec over the same list again goes on where a run stopped.',
  ],
  [
    '- Every page is written to `<out>.detail.jsonl` when it finishes, and the CSV is rewritten as the run goes. A run that is killed loses at most the page in flight (with `--browser chrome`, the batch in flight: up to 8 pages). Ctrl-C, SIGTERM and SIGHUP stop it cleanly (`stopReason: "interrupted"`). Rerunning the same command skips `ok` and `empty` pages, retries `failed` ones while they have tries left (`maxAttempts`, counted over all runs) and `blocked` ones every time.',
    '- What a run read is kept when it stops. Running the same spec again skips pages read `ok` and dead links, and reads `failed`, `blocked`, `empty` and `pending` ones again (`empty` ones last, after the others); a `failed` page gets up to `maxAttempts` tries in each run.',
  ],
  [
    'A changed `fields` / `root` / `require` / `waitFor` / `setup` / `expand` / `expandPasses` / `children` reads every page again; pacing and retry settings do not.',
    "A changed `fields` / `root` / `require` / `waitFor` / `setup` / `expand` / `expandPasses` / `children` reads every page again (dead links aside), and each row keeps the values the earlier spec read until the new spec reads that row's page `ok`; retry settings do not change what was read.",
  ],
  [
    '**Empty pages read again:** an empty page counts as done only once an ok page came after it (or the run ended normally); a run stopped in the middle of a run of empty pages reads them again next time, after the other links.',
    '**Empty pages read again:** every `empty` page is read again when the same spec runs again, after the other links.',
  ],
  [
    ' To read every `empty` page again (e.g. after raising `waitTimeoutMs` for slow pages), add `--retry-empty` (with `children`, it also reads again the `ok` pages that had no child row); pages recorded as empty by the bundled browser are read again on their own with `--browser chrome`, and the other way round.',
    '',
  ],
  [
    ' and ask before rerunning the same command with `--browser chrome` ([browser.md](browser.md)). Do not solve captchas or log in for the user; do not lower `delayMs` or raise `concurrency` to get through faster.',
    ' and ask before running it again (the user may get past the check themselves first). Do not solve captchas or log in for the user, and do not try to get through faster.',
  ],
  ['(fix detail.json;', '(fix the spec;'],
  [
    "`deadLinks`: links that answered 404 / 410. They count as `empty`; report them, don't retry.",
    '`deadLinks`: links that answered 404 / 410. They show as `dead-link` (not `empty`) and are not read again; report them.',
  ],
  ['the site may be serving this browser empty pages — ask the user about `--browser chrome`.', 'the site may be serving the run empty pages — tell the user.'],
  [
    '- Pacing: one page at a time, with a pause of `delayMs`..2×`delayMs` (default 1500 ms) before each. `concurrency` (up to 3) runs pages in parallel in the bundled browser only; use it for sites that clearly tolerate it.',
    "- The pages open in the user's tab, one after another, at a fixed pace (one page at a time, with a pause before each); the tab goes back to the list afterwards. Tell the user to keep that tab in front and not use it while the run goes: a tab that is not in front is not drawn, so the run pauses until the user brings it back.",
  ],
  ['add `children` to detail.json:', 'add `children` to the spec:'],
  ['write them from one whole child row (`--html "<rows>"`)', 'write them from one whole child row (the html of `rows`)'],
  ['check with `--html` on a page that has replies.', 'check with the html of a page that has replies.'],
  [" On a separate reviews page (below), use that page's heading.", ''],
  ['detail.mjs does not scroll:', 'The detail pass does not scroll:'],
  ['- Output: the main CSV gets', '- Output: the result gets'],
  [
    "The child rows go to `<out>.children.csv` (beside `<out>.csv`): `parent_link` (the row's link cell), `parent_row` (the row's 1-based number among the main CSV's data rows), `child_index`",
    'The child rows go to a child table of the same result, each tied to the row it came from, with `child_index`',
  ],
  [
    "Join on `parent_row`; a link in several rows is read once and its children are listed under each of those rows, so each row's `children_count` equals its child rows.",
    'A link in several rows is read once.',
  ],
  [
    " A run without `children` to the same `--out` moves an old `<out>.children.csv` to `<out>.children.stale.csv` (the summary says so): don't report it as current.",
    '',
  ],
  ['`rows` (rows in the child CSV)', '`rows` (rows in the child table)'],
  [
    "detail.mjs reads only the children the item's page itself shows, and warns when it sees such a link. To get the rest, collect it separately. When the whole list is on one page of its own (\"See all reviews\" shows them all, maybe behind a load-more button), read that link as a detail field (`attr: \"href\"`) and run a second detail pass over the output with `link` set to that column and `children` (plus `expand`) reading that page; its child CSV joins on `parent_row` like the first and replaces the first pass's child rows for those items: that page usually repeats the ones the item's page showed, so do not concatenate the two. When the list goes on page by page through URLs, run collect.mjs on each item's list URL (its `next` follows the pager), one run per item, and join on the item's link.",
    "the detail pass reads only the children the item's page itself shows, and warns when it sees such a link. Only links in the list's own columns can be followed, so a detail pass cannot add the rest of such a list, not even by reading its link as a detail field. Tell the user which items have more children on a separate page; if they want the rest of one item's list, collect it as a list of its own on that page (its `next` follows the pager), one run per item.",
  ],
  ['say how many, and that rerunning the same command fills them in.', 'say how many, and that running the same spec again fills them in.'],
  ["the child CSV's path and row count,", "the child table's row count,"],
  [
    'ok / empty / failed / blocked / pending / no-link; `deadLinks` among the empty ones)',
    'ok / empty / dead-link / failed / blocked / pending / no-link; `deadLinks` lists the dead links)',
  ],
]

/** [CLI passage, host wording] pairs for SKILL.md's "### Detail pages" (SKILL_CONFIG_DETAIL). */
export const DETAIL_CONFIG_HOST = [
  [
    '`detail.json` for `scripts/detail.mjs list.csv detail.json --out full.csv [--max-rows N] [--browser bundled|chrome] [--session NAME] [--retry-empty]`:',
    "The detail spec, for a second pass that opens each row's own page in the user's tab, one after another (the tab goes back to the list afterwards):",
  ],
  ['  "expand": [".description button.show-more"],\n  "delayMs": 1500\n', '  "expand": [".description button.show-more"]\n'],
  [
    'and writes the rows to `<out>.children.csv` (`parent_link`, `parent_row`, `child_index` + its fields) — [references/detail-pages.md](references/detail-pages.md)',
    'and puts the rows in a child table of the result (each tied to its row, with `child_index` + its fields) — see the detail-pages note',
  ],
  [
    '| `delayMs` / `concurrency` / `maxAttempts` | pause before each page, `delayMs`..2×`delayMs` (default 1500) / pages at once, 1–3, bundled browser only (default 1) / tries per page over all runs (default 3) |',
    '| `maxAttempts` | tries per page (default 3) |',
  ],
  [
    'Every page is checkpointed in `<out>.detail.jsonl`: rerunning the same command skips `ok` / `empty`, retries `failed` while tries are left and `blocked` always; a spec that reads differently reads every page again; `--retry-empty` (or the other `--browser`) reads `empty` pages again.',
    "What a run read is kept when it stops: running the same spec again skips `ok` pages and dead links, and reads `failed`, `blocked`, `empty` and `pending` ones again (`empty` ones last); a spec that reads differently reads every page again, and each row keeps the values the earlier spec read until the new one reads its page `ok`.",
  ],
  [
    '`detail_status` (`detail_status_2` when the list already has one): `ok`, `empty` (loaded without the fields; dead links, HTTP 404/410, too), `failed`, `blocked`, `pending` (not read yet), `no-link`.',
    "`detail_status` (`detail_status_2` for a pass over another link column of the list; only links in the list's own columns are followed): `ok`, `empty` (loaded without the fields), `dead-link` (HTTP 404/410), `failed`, `blocked`, `pending` (not read yet), `no-link`.",
  ],
  [
    ' · `tab-not-rendering` · `interrupted` (Ctrl-C, SIGTERM or SIGHUP)',
    ' · `tab-not-rendering` (the tab was not in front, and the user stopped the run) · `pages-failed` (5 links in a row failed) · `tab-closed` (the user closed the tab) · `stopped-by-user` · `points-exhausted`',
  ],
  ['(the run stops with a message otherwise)', '(the preview refuses the spec otherwise)'],
  ['The summary (`full.json`) adds', 'The summary adds'],
]

/** Each CLI passage in `text` replaced by its host wording; throws when one is not there exactly once. */
export function reword(text, pairs, what) {
  let out = text
  for (const [cli, host] of pairs) {
    const found = out.split(cli).length - 1
    if (found !== 1) throw new Error(`${what} must contain this passage once (found ${found}) — update scripts/host-detail-wording.mjs: ${JSON.stringify(cli.slice(0, 80))}`)
    out = out.replace(cli, () => host)
  }
  return out
}
