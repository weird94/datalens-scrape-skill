# Getting more rows

Pick `next.type` from what the page offers, then prove it on page 2 with `inspect.mjs --click`.

| the page has | use |
|---|---|
| "Next" link/button, arrow icon, numbered pager | `click` with a selector that means *next* |
| "Load more" / "Show more" / "View all" button at the end of the list | `load-more` |
| more items appear when you scroll (no button) | omit `next` — scrolling is the default (see Scroll) |
| page number in the URL (`?page=2`, `/p/2`) and links you can't click reliably | `url` with `{page}` |
| everything is already there | omit `next` (scrolling that brings nothing ends as `single-page`), or `{type:"none"}` to read the page as it is without scrolling |

## Choosing the click target
- Make the selector mean *next*, not *any pager link*: `a[rel=next]`, `[aria-label*=next i]`, a `.next` class, or the pager's last link when that is always the next control (`nav.pagination li:last-child a`). Previous/next arrows often share a class — on page 2 the first match may be "previous". Run `--click` twice if unsure and check the page number moves forward.
- Icon-only arrows have no text; find them by class, `aria-label`, `rel` or `href`.
- Never use a link to another site as "next" (download banners, partner CTAs that say "See more").
- Full-page navigation and in-place updates both work; after a navigation the collector waits for the rows again.

## Look-alike controls that are not pagination
On busy pages several controls say "more" or show arrows, and most of them are not pagination — for example buttons that swap a side widget, or tab bars (`aria-pressed`/`aria-selected`) that switch to a different feed instead of continuing this one.
The right control sits at the end of the target list and, when clicked, keeps the old rows and adds new ones (or shows page 2 of the same list). Verify with `--click` + `--probe`.

## Load more
Clicks repeat until the button disappears or three clicks add nothing. Rows from one click can keep arriving for a while after the first ones appear; the collector waits for the DOM to go quiet (`quietMs`, default 1500) and harvests once more, waiting twice as long, after the button disappears. Raise `quietMs` on slow sites.

## Scroll
- Scrolling is the default, with or without `next`: each round scrolls the last row on screen to the top. The browser finds what scrolls — the window, a box inside the page, nested boxes, boxes inside shadow roots — so you don't pick a scroller. Every row passes through view, and whatever follows the list (the trigger that loads the next batch) shows when the last row does. At the last row it also scrolls everything around the rows to the very bottom.
- Virtual lists (rows recycled while you scroll; the row count in `--probe` stays small) are noticed and read at every stop. A row read more than once is kept once, also when its counts or pictures changed in between.
- No `next` and two rounds at the end bring nothing: the run ends as `single-page`. Pages reached by `click` or `url` are scrolled to the end of their rows before they are read.
- `{type:"scroll", scroller, step}` forces one element and a fixed number of pixels per round. Use it only when the default visibly misses rows.
- If scrolling doesn't move (stop reason `scroll-blocked`, or SCROLL says BODY SCROLL LOCKED), a popup is probably locking the page: add its close button to `dismiss`.

## The wrapper changes after page 1
Sites often render page 1 on the server and later pages in the browser, or wrap page 1 in a landing layout. A class or id may embed the page number, or a wrapper may exist only on page 1. Check page 2 and write a selector that holds on both: a partial attribute match (`[class*=…]`), the container identified by what it holds (`:has(> …item…)`), or the item class alone with `:not()` to exclude look-alike lists elsewhere on the page.

## Dead controls at the end
On the last page some sites keep the next arrow clickable; clicking does nothing or reloads the same page. The collector stops after repeated clicks with no new rows (`next-click-no-effect` / `no-new-rows`). That's a normal end if the page numbers agree.

## How far to go
`maxPages` defaults to 50. Ask or raise it when the user wants everything and the pager shows more pages. Be considerate: don't hammer small sites.
