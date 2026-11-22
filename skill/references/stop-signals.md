# Judging how a run ended

The collector stops on rules; you decide what the stop means. Use the summary JSON: `stopReason`, `roundLog` (rows per round), `pageTextTail` (last visible text on the page), `lastUrl`.

| stopReason | usually means | check |
|---|---|---|
| `single-page` | no `next`, and scrolling brought no rows (or `next: none`) | was there really no pager / load-more button? |
| `next-control-gone` | last page — the next control disappeared | page text "page N of N"? |
| `next-click-no-effect`, `no-new-rows` | clicking next changed nothing new | last page with a still-clickable arrow (normal), or the wrong control |
| `no-rows-after-page-turn` | the page after a click has none of your rows | a wall (captcha/login/rate limit — read `pageTextTail`), or the wrapper changed and your selector no longer matches (inspect page N) |
| `load-more-gone` | button disappeared — normal end | |
| `load-more-no-new-rows` | clicks stopped adding rows | button stuck on "Loading…" = hang or rate limit; or a look-alike control |
| `scroll-end` | at the bottom, nothing new for 3 rounds | footer reached; or loading is slow (raise `stagnantRounds`/`quietMs`) |
| `scroll-blocked` | scrolling didn't move | popup locking the page → `dismiss` |
| `no-rows-on-first-page` | rows never appeared | late render (raise `waitTimeoutMs`/`initialWaitMs`), empty or gated page, wrong selector |
| `max-pages` / `max-rows` | your limit, and the next control was still there | tell the user there's more, or go on: `--resume` with a higher limit |
| `blocked` | no rows, and the page looks like a bot check / block page (`note` has the evidence: challenge element, wording, HTTP status) | offer the user's own Chrome (browser.md); if that is blocked too, stop and report |
| `login-wall` | no rows, and the page asks to log in | the user logs in — in their own Chrome (browser.md) |
| `tab-not-rendering` | `--browser chrome` only: the Chrome window is minimized or covered, so the page stopped drawing | ask the user to bring the window to the front and keep it visible, then rerun |
| `setup-failed` | a required setup step could not run (`note` names it) | the button text/selector differs (language, A/B layout), the page is a wall, or the step needs `optional: true` |

## Going on after a stop: `--resume`
Rerun the exact same command with `--resume` (raise `--max-pages` / `--max-rows` when a limit stopped it) to go on with the run saved at `--out` instead of starting over. It keeps the saved rows, does not add them twice, and the summary reads as one run (`rounds`, `roundLog` and `seconds` go on; `resumedFrom` lists each earlier part).
- `next.type: "url"`: goes on at the first page not yet read. A page the row limit cut part way is read again.
- `next.type: "click"` where each click loaded a page with its own URL: reopens the last page read, checks it still shows the same rows, and clicks on. If it shows other rows or lands elsewhere, the list is read from the top instead.
- Scrolling, `load-more`, or a click that changes the page in place: the list is read again from the top. Saved rows that come by again are not added twice (`known` in `roundLog`), so only the time to get back there is lost. The summary says `resumed: "from-start"`.
- Refused when the config's `url`, `rows`, `fields`, `next` (its `waitMs` / `quietMs` may change), `require`, `dedupe`, `setup`, `expand` or `fillDown` changed, when there is no saved summary, when the CSV has other columns, or while another run still writes the same `--out`: write to a new `--out`, or drop `--resume` to start over.
- A run that already reached the end of the list (no `wall`), or the same `--max-pages` / `--max-rows` it is rerun with, is printed and left as it is. One that stopped at a wall can go on in the user's own Chrome (`--resume --browser chrome`), once the user agrees.

## `aiStop`: when a second look decided

Some hosts have the end of the list looked at before a rule stop takes effect, and the summary then carries `aiStop`: `outcome` is how that look ended the run, `verdicts` each answer, `userMessage` its one sentence for the user.
- `confirmed-complete`: the page showed the end (a "no more" line, the last page, a matching total). Report it as complete.
- `possibly-incomplete`: more was expected but nothing on the page brought it. Keep the rows and say the list may go on.
- `wall`: a login or a check stopped the list. Say so, as for the `wall` field below.
- `rules (…)`: no answer; read `stopReason` as usual.
`stopReason` stays the rule that wanted to stop.

## Walls
Text like "verify you are human", "slide to complete the puzzle", "安全验证", "访问过于频繁", "too many requests", "access denied", "sign in to continue", or a login form in `pageTextTail` means the site stopped serving data. Keep the rows you have and tell the user where and why it stopped. Don't solve captchas or fake a login yourself. What you can offer: running in the user's own Chrome ([browser.md](browser.md)), where many bot checks don't trigger and the user can log in or pass a check themselves.

## Totals that don't add up
Pages often claim a total ("2,418 reviews", "1,234 results") that you can't actually load: replies counted in the total, hidden or deleted items, a cap on how far you can page. Report both numbers; don't keep retrying to reach the claim.

## Short pages in the middle
If `roundLog` shows most pages giving 20 rows and one page giving 7 that isn't the last, rows probably rendered late on that page — raise `waitTimeoutMs` or add a `waitFor` that only matches when the page is complete, and rerun.

## Good final report
"Collected 862 reviews — all that load; the header claims 2,418 (it likely counts ratings without text). Stopped at the bottom of the list after scrolling stopped adding rows." / "Collected 45 listings from pages 1–5. Page 6 asked to sign in, so the run stopped there."

## The `wall` field
When a run stalls or ends after collecting rows (no new rows, scroll blocked or at the end, click had no effect), the summary carries `wall` if the page looks like a block or login wall at that point. The stop reason stays as it was, because a popup saying "log in to see more" may just need closing (`dismiss`). Look at `wall.evidence` and the page text, then decide: popup to dismiss, a wall that appeared mid-run (keep the rows, tell the user), or a rate limit (wait, or slower `delayMs`).
