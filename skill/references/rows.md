# What counts as a row

A row is one record in the user's terms. Decide that first, then find the element that wraps exactly one record.

## Cards and lines inside cards
A card often holds several lines with the same class (title line, meta line, action line). The row is the card, not the line. If LISTS shows one group whose count is an exact multiple of another group's count, the bigger group is probably lines inside the smaller group's cards — pick the cards. Check one card with `--html`.

## Two similar lists on one page
Detail pages often carry a small list the user wants (a handful of Q&A entries, a spec table) next to a bigger one they don't (a related-items strip). Pick by what the user asked for, not by size. Lists with fewer than 3 items never appear in LISTS — look at the page text, then probe your own selector. If the page simply doesn't have many rows (an item with only a few answers), say so; it is not a scraping failure.

## Navigation, filters, tabs
Channel bars, filter chips, breadcrumbs, sort buttons and footer links are repeated structures too. LISTS marks groups inside nav/aside/header/footer. If the main area is empty and only navigation remains (logged-out or "no results" pages), report that instead of exporting the nav.

## Tables
- Header rows (`th`), section/group rows (one cell spanning the table with `colspan`), subtotal/total rows and footnote rows are not data. Exclude them with `require` on a field only data rows have, or in the selector: `tbody > tr:not(.group)`, `tr:has(td:nth-child(4))`.
- Striped tables alternate classes (`odd`/`even`, two hashed classes). Select by tag (`tbody > tr`), not by one of the classes.
- Merged cells (`rowspan`): the shared value (category, date) appears only in the first row of each group; the other rows have fewer cells, so **every positional selector after the merged column shifts by one** in rows 2+ of the group. `fillDown` does not catch this: the shifted selector reads the neighbouring cell, which is not empty, so nothing gets filled and the column silently holds the wrong values. Read cells by a stable class or `data-*` attribute if there is one. If cells are only distinguishable by position, look at a group's second row with `--html` and handle the two shapes separately — e.g. two configs (`tr:has(td[rowspan])` vs the rest) or `index: -1` / `-2` counted from the end when the merged column is at the start — then spot-check rows 2–4 of a group in the preview against the page.
- Multi-level headers, cells spanning several columns, or a table where the shapes above get messy: say so in the report and name the rows you could not verify, rather than delivering a column you know may be shifted.
- When a table is grouped, the user usually wants one row per item, not one per group — unless they say otherwise.

## Rows mixed with non-data items
"Show all" / "load more" items rendered as list items, ad slots, "sponsored" cards, separators, skeleton placeholders: the row selector catches them because they share the tag or class. Use `require` (they lack the real fields) or `:not(...)`. `verify.mjs` flags rows that fill far fewer columns than the rest — look at them before delivering.

## Records split over sibling elements
Some pages spread one record over consecutive siblings: a title row followed by a details row in a table, `dt` + `dd` pairs, a heading followed by its paragraph. Select the first element of each record as the row (often it carries a distinguishing class) and read the other part with `{"css": "…", "sibling": 1}`. Check in the preview that the second part really belongs to the same record in every row.

## Nested wrappers
Some lists nest each next item inside the previous item's wrapper, so items sit at different depths. A child selector (`>`) then finds only the first level. Use a descendant selector on the item class (`.thread .comment`) and check the count against what the page shows.

## Comments with replies
A "12 replies" / "View replies" / "展开12条回复" button means the replies are collapsed, not absent; its count is not a substitute for them. When the user asks for comments, include the replies unless they want top-level comments only:
- one row per comment of any depth — use this unless the user asks for another shape, so every reply keeps its own author, time and counts as columns: `rows` matching both comment and reply elements (often the same class, replies nested inside their comment), plus a field that tells them apart: `{"matches": ".replies .comment"}` (true when the row itself matches — ancestors in the selector count), a "replying to" label, or the element's `class`. Check in the preview that a comment's fields are its own, not its first reply's.
- one row per top-level comment, the replies joined into one field (`{"css": ".replies .text", "all": true}`), only when the user asks for that shape: the replies lose their own columns.
To record which comment a reply answers — and to keep the same words posted under two comments as two rows instead of one — add a column that reads only on the comment's own row (its text or author: a selector that finds nothing inside a reply row), list it in `fillDown` so the replies below inherit it, and keep it in `dedupe`.
Put the per-comment "show replies" button and the "show more replies" button that follows it in `expand`. A "Hide" / "收起" button often shares their class: leave it out (`:not(.…)`, or `button:has-text("…")`), or each pass folds back what the last one opened — the preview warns when rows on the page go down after expanding. Check that the expand click doesn't navigate away. Open the record with the most replies when you look: only long ones show what comes after the first click (a pager, "more replies"). When each comment's replies have a pager of their own ("上一页 1 2 下一页", "Next"), put its next button in `expand` too: the run reads the rows after every click, so the replies a page turn replaced are kept — one row per reply works with such a pager. When next, previous and the page numbers are the same kind of button, select next by its text (`button:has-text("下一页")`).

## Empty and gated pages
No rows at all on the first page can mean: the list renders late (try `--wait 5000`, raise `waitTimeoutMs`), the page is empty ("no reviews yet", "content deleted", soft 404), it needs login, or the visitor was blocked ("too many requests", 403). Quote what the page says in your report.
