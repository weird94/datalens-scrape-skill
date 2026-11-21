# datalens-scrape

English | [中文](README.zh-CN.md)

An agent skill (for Claude Code and similar agents): tell it which data you want from a page, and it collects the whole list into a CSV.

- **Free.** No account, no API key, no per-result billing.
- **Uses your logins.** When a site blocks bots or needs an account, it can run in your own Chrome, with the sessions you already have (it asks you first).
- **Local and private.** The browser and scripts run on your computer, with no scraping service or proxy in between. Your cookies never leave your machine, page content goes only to the agent you already use, and the CSV stays on your disk.
- **The whole list, honestly.** Pagination, infinite scroll, "load more" and "show replies" are handled by scripts, and every run reports why it stopped. A partial result is never passed off as complete.
- **Any site, no templates.** The agent reads the page each time and writes a fresh config, so it isn't limited to a list of supported platforms and copes with redesigns.
- **Checked, not claimed.** On 10 real sites a separate agent verified the output field by field: 9 fully correct, 1 with 3 wrong cells (results below).

```
You:   Export all the comments on this article to CSV, replies too: https://news.qq.com/rain/a/...
Agent: Saved comments.csv: 160 rows (123 comments + 37 replies), 9 columns:
       nickname, reply_to, is_reply, content, picture, sticker, likes, location, location_date.
       Clicked "load more" until it ran out and opened every reply thread.
```

Good for search results, product listings, comments and replies, rankings, directories and tables. It does not try to beat captchas or bot checks.

## Install

**Claude Code, one step** (needs Claude Code 2.1.275 or later):

```
/plugin install datalens-scrape --marketplace weird94/scrape-skill
```

**Any agent:** send it this:

```text
Install the skill in the skill/ folder of https://github.com/weird94/scrape-skill and check that it works.
```

Requirements: Node.js 18 or later. The first run downloads Chromium for Playwright (one time).

So far it has only been tested in Claude Code. It is plain SKILL.md plus Node scripts, so other agents that load skills should work, but they have not been tested.

## Usage

Once installed, tell the agent what you want and give it the URL:

- "Collect the products from the first 5 pages of these search results: title, price, store, link. <url>"
- "Export this whole ranking to a spreadsheet: <url>"
- "Turn this article's references into a CSV: <url>"
- "Just 100 comments is enough: <url>"

The agent looks at the page first. It works out which part is your list, which fields each row has and how more rows appear, then test-collects two pages and checks them before collecting everything. At the end it tells you:

- where the file is, how many rows it has and which columns;
- **why it stopped**: it really reached the end, it got the number you asked for, it hit a page limit (and says plainly that it is not finished), the total the page shows does not match what was collected, or the site blocked it;
- which fields are missing, and why.

If you don't name fields, it collects everything visible in each row, including each row's own link. Saying which columns and how many rows you want gets you closer to what you need.

## When a site blocks it

By default the skill runs an invisible browser in the background. Many sites block that kind of browser, and some content only shows to logged-in users. In that case the agent **asks you first**, then switches to your own Chrome, with your logins.

One-time setup: install the extension following the [Playwright Chrome Extension setup guide](https://github.com/microsoft/playwright/tree/main/packages/extension#readme). You only need the extension; skip the MCP server configuration in that guide.

While it runs:

- don't use the tab it is driving;
- **don't minimize the Chrome window or cover it completely.** Hidden pages stop rendering, so scrolling and loading stall, and the scripts will stop and tell you;
- if it hits a captcha or a login page, the agent won't handle it for you. Solve it yourself in that tab, and it carries on.

Connection errors and fixes are in [`skill/references/browser.md`](skill/references/browser.md).

## Sites it has been tested on

Tested in November 2026. For each site a separate agent opened the page itself and checked the result field by field:

| Site | What was collected | Result |
|---|---|---|
| Hacker News | front page, first 3 pages | 90 rows, all correct |
| Douban Movie Top 250 | all | 250 rows, all correct |
| Baidu trending | all | 51 rows, all correct |
| YouTube | search results | 100 rows, all correct (Shorts and ads left out) |
| YouTube | video comments | 50 rows, all correct |
| Nature | article references | 62 rows, all correct |
| Tencent News | article comments with replies | 160 rows, all correct |
| Google Play | app reviews | 50 rows, all correct |
| Spotify | album tracks | 84 rows, all correct |
| Wikipedia | "largest companies" revenue table | 50 rows; 3 cells wrong, in the two rows with merged cells |

**Needs your own Chrome:** Reddit and Product Hunt (tried once each, both collected). Udemy, 10jqka (同花顺) and Xueqiu (雪球) also block the background browser. They open in your own Chrome, but have not been fully collected yet.

Site redesigns can break selectors. The agent reads the page and writes a fresh config every time instead of relying on saved templates, so this usually doesn't matter. If a site comes out wrong, please open an issue.

## Which model

Opus and Sonnet did best. Haiku works too: on the 10 sites above it got 7 fully right and 3 nearly right. It fell short in two ways:

- it tends to stop early, reporting done after collecting only part of the list;
- when data is spread across other views or tabs of the page, it rarely goes looking.

With a small model, check the "why it stopped" line in its report. If it says the list is not finished, or the totals don't match, ask it to keep going.

## Not supported yet

- Opening each row's detail page (it only collects what the list itself shows)
- Lists inside iframes
- Some embedded comment widgets (closed shadow roots)
- Files behind a download button
- Output formats other than CSV

## Where your data goes

The scripts run only on your computer and depend only on Playwright. They call no model and no outside service. Page content goes only to the agent you are using, and the CSV is saved where you say. The skill tells the agent to treat page text as data: if a page contains instructions, the agent reports them to you instead of following them.

## What else is in this repo

`skill/` is what gets installed for the agent, and it is all you need. `eval/` and `docs/` are for developing and evaluating the skill: 80 local mock pages, regression tests and the blind-test method. See [`eval/README.md`](eval/README.md).
