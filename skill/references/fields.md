# Field extraction traps

Write field selectors relative to the row, then preview and run `verify.mjs`. Most field bugs show up as an empty-ish column, two identical columns, or values that belong to a neighbouring column.

## Optional items of the same kind
Tiles often show optional badges built from the same component (e.g. "new", "ships free", "low stock"). A row that lacks one shifts the rest, so a positional selector (`li:nth-of-type(3)`) reads a different badge in different rows. Anchor on what distinguishes each badge instead:
- an icon or marker inside it: `li:has(svg[data-icon=truck])`, `li:has(.badge-icon-stock)`;
- an attribute on it: `li[data-kind=shipping]`.
If badges differ only by their text, read them all into one field (`{"css": "li.badge", "all": true, "join": "; "}`), or make one column per badge you care about with `all: true` plus a `regex` naming it (`"regex": "(ships free)"` gives the badge text or empty).

## Several fields with the same class
Two figures both styled `.metric` (e.g. views and downloads): a plain `.metric` selector returns the first one for both fields. Use `index` (negative counts from the end, `-1` = last), but only if the order is fixed in every row; otherwise find a distinguishing ancestor/attribute (`.metric[title*=download i]`), or read the whole group and pick by label with `regex` (`"regex": "([\\d,.]+[kKM万]?) downloads"`). `verify.mjs` warns when two columns are identical.

## Values that aren't visible text
Star ratings, icons and counters often carry the value in `aria-label`, `title`, `alt` or `data-*` while the visible text is empty or an icon. Use `attr`. Check one row with `--html`.

## Images
`attr: "src"` returns the real image URL and skips lazy-load placeholders (data URIs, 1×1 spacers) by falling back to `data-src`, `data-original`, `srcset`. Images that only get a real URL when scrolled into view need a scroll pass (`next.type: "scroll"`) or come out empty — check the column's fill rate.

## Discounts and optional sub-elements
A price block may hold "now" and "was" prices only when discounted. A positional selector (`div:first-child`) then reads the old price on discounted rows and the current price on others. Select by the class or attribute that marks the current price and look at both kinds of rows in the preview.

## Tag changes between pages
If a column's fill rate drops on later pages, the markup changed between pages — often the tag (a link on one page, plain text on another) while the class stays. Prefer class-only selectors over tag+class when the class is meaningful, and compare page 1 and page 2 with `--html`.

## Text placement
Some rows wrap text in a `span`, others put it directly in the paragraph. Select the element that always holds the text (the paragraph or cell), not the optional inner wrapper.

## Live values
Counts and prices that tick (likes, "3 hours ago", a stock price) and pictures that load late (avatars, lazy images) don't make a row read again a new row: the collector recognises a record by what it says, leaving those cells and empty ones out, and keeps the latest values. Two records that differ only in them stay two rows when they show side by side or on two pages. Set `dedupe` only when the verify report still shows duplicates, to the fields that name a record (author + text + time, or its link).

## Links
`attr: "href"` resolves to an absolute URL and looks at the nearest link around or inside the element. Links that open detail pages are worth keeping even if the user didn't ask — they make rows traceable.

## Cleaning values
The field options in SKILL.md clean a value after it is read. Typical cases:
- **A trailing link or badge inside the text** ("… more>", "NEW"): `exclude` its selector rather than stripping the words with `replace`, so the same word in real content survives.
- **Several values in one element, separated by `<br>` or `/`**: `split` + `part`. With `split: "\n"` the line breaks are kept while reading, so `<br>`-separated lines become parts. Check rows with fewer parts (a missing middle part shifts the rest — prefer `part: -1` for the last one).
- **A label or unit around the value** ("Rating: 4.5 out of 5", "1,234 comments"): `regex` with one capture group.
- **Text the page shortens** ("…主..." instead of "… 主演: …"): a pattern like `Director:(.+?)(?:Cast:|$)` runs to the end of the text when the label after it is cut off. `verify.mjs` prints a NOTE for values ending in "…"; look at the longest values of a regex column before delivering.
- **Counts as numbers**: `number: true` turns "1.2万" into 12000 and "3.4k" into 3400. Text without a number ("Reply", "discuss") becomes empty — add `default` if the user wants 0. Only set it on columns that are always counts or amounts; for prices keep the currency in another column if rows mix currencies.
- **A value split over several elements** (two italic parts of a journal title, several authors): `all: true` with a `join` string.
After cleaning, preview and look at the first and last rows in `verify.mjs`: a regex that matches only some formats shows up as a lower fill rate.
