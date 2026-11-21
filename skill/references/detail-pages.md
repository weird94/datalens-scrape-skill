# Detail pages

`detail.mjs` opens each row's own page (the URL in one list column) and adds the fields read there. It is a second pass over a list CSV: collect the list first, with its link column.

## Before writing detail.json

- **Look at several items, not one.** Take 2–3 links far apart in the list, and rows that look different there (another category, no price, a badge), and inspect each: `inspect.mjs <url> --html "<record css>"`, `--probe "<field css>"`. Items of one site often use different layouts (a product with variants, a job without a salary block, an old article on an older template). A selector that works on one sample can miss the field on others.
- **Selectors describe the place, never the sample's content.** Nothing from one item's own text (its name, brand, id, price) goes into a selector: it matches only that item.
- **Set `root` to the main record** (the item itself, not the page). Detail pages usually also show related, similar or recently viewed items with the same classes, sometimes before the record; without `root` a field reads the first match anywhere on the page. With `root`, `expand` clicks only inside it too.
- **Covering two layouts:** a comma list (`"[itemprop=brand], .meta .brand"`) takes the first element in page order that matches any part, not the first part that matches. Check it on a page of each layout, and that its parts cannot both match on one page.
- **Values in attributes:** microdata often sits on `<meta itemprop=… content=…>` with no text: read it with `{ "css": "[itemprop=sku]", "attr": "content" }`.
- **What says the page is there:** put the fields every item has in `require` (only ones you saw on every sample: an optional field there turns the items without it into `empty`). The run waits until they show up (late-rendered pages), and a page without them counts as `empty` instead of becoming a row of blanks. When the content arrives in one block, `waitFor` its container instead. `require` is checked after `setup` and `expand`, so a field behind a click may be in it (the clicks come once another field has shown and stayed for 1 s; if no field shows before the click, each page first waits the full `waitTimeoutMs`). Without `require`, a page is read once every field shows; if one never does, the read waits until nothing changed for 3 s (1 s with `expand`). `require` cuts that wait short on pages that lack an optional field.
- **Data behind a click** ("read more", a collapsed spec table, a tab): `expand` clicks every match inside `root` (the whole page without one) before reading (buttons that show more, not links that leave); `setup` runs fixed steps first (a tab, a language switch). Check with `inspect.mjs <url> --click "<css>" --html "<record css>"`.
- **Column names** must differ from the list's columns (the run refuses otherwise): name them for what they are (`detail_title`, `seller_rating`).
- **A second pass** over a detail output (for pages its rows link to) works the same way; its status column is `detail_status_2`.

## Preview, then run

`--max-rows 5` reads the first 5 links only; the rest are `pending`. Read the summary:

- `fillRate` per column on ok pages. A column far below the others: those items lack the field (a job with no salary, a product with no discount), or show it in another place. Before deciding which, look for the value in the record text the warning quotes from a page where the column is empty; if that text is cut off or the value is not in it, inspect that whole record (`--html "<root>"`), not only the block where the field usually is: if the value is there, widen the selector (a comma list); if not, keep the selector and report the fill rate. Never widen until something matches: that turns a true blank into a wrong value. A column empty everywhere: wrong selector, or it needs a click.
- The preview reads only the first links; a layout that appears later in the list does not show up in it. After the full run, read `fillRate` and `warnings` again and handle new ones the same way.
- `status`: many `empty` pages (the warning gives the reason and examples) means another layout, content that renders late, or a soft block.
- `deadLinks`: links that answered 404 / 410. They count as `empty`; report them, don't retry. Expired items often answer 200 instead (a "no longer available" page, or a redirect to a search page): `root` and `require` make those `empty` rather than a row of the wrong values; report them with the dead links.

Then run with the real `--out`. The same `--out` continues where a run stopped; a preview written to another file is not reused.

## Resuming, retries, blocks

- Every page is written to `<out>.detail.jsonl` when it finishes, and the CSV is rewritten as the run goes. A run that is killed loses at most the page in flight (with `--browser chrome`, the batch in flight: up to 8 pages). Ctrl-C, SIGTERM and SIGHUP stop it cleanly (`stopReason: "interrupted"`). Rerunning the same command skips `ok` and `empty` pages, retries `failed` ones while they have tries left (`maxAttempts`, counted over all runs) and `blocked` ones every time. A changed `fields` / `root` / `require` / `waitFor` / `setup` / `expand` reads every page again; pacing and retry settings do not.
- **Empty pages read again:** an empty page counts as done only once an ok page came after it (or the run ended normally); a run stopped in the middle of a run of empty pages reads them again next time, after the other links. To read every `empty` page again (e.g. after raising `waitTimeoutMs` for slow pages), add `--retry-empty`; pages recorded as empty by the bundled browser are read again on their own with `--browser chrome`, and the other way round. Dead links (404 / 410) are never read again.
- `failed` is a page that did not load or answered a server error: usually temporary. Rerun later, or raise `maxAttempts`.
- **Blocked midway.** Sites often serve the first pages and then a captcha, an "access denied" page or a login wall. Three blocked pages in a row stop the run (`stopReason: "blocked"`). Some sites send empty pages instead: after three empty pages with no ok page between them (failed and blocked pages and dead links don't count), the run reads a page that was fine before (a server error on that check is tried once more); if that one is empty or blocked too, it stops the same way and marks those pages blocked, so a rerun fetches them again. Keep what you have, tell the user how far it got, and ask before rerunning the same command with `--browser chrome` ([browser.md](browser.md)). Do not solve captchas or log in for the user; do not lower `delayMs` or raise `concurrency` to get through faster.
- **Empty from the start** (`stopReason: "no-data"`): three pages read empty and none has read ok yet (in this run or before), so there is nothing to compare with. Inspect one of those URLs: if the fields are there, the selectors or `require` miss (fix detail.json; the changed spec reads them again); if the page shows the data in inspect but not in the run, or shows nothing at all, the site may be serving this browser empty pages — ask the user about `--browser chrome`.
- A captcha widget alone (many sites show a small badge in a corner of every page) does not make a page blocked when its fields read; block or login wording on a page that read nothing does.
- Pacing: one page at a time, with a pause of `delayMs`..2×`delayMs` (default 1500 ms) before each. `concurrency` (up to 3) runs pages in parallel in the bundled browser only; use it for sites that clearly tolerate it.

## Things to report

The summary's `status` counts (per row, the same as the `detail_status` column: ok / empty / failed / blocked / pending / no-link; `deadLinks` among the empty ones), the fill rate of each detail column, and how the run ended. Rows whose page failed or was blocked keep their list data with empty detail cells; say how many, and that rerunning the same command fills them in.
