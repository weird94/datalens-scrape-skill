# Using the user's own Chrome

By default the scripts start their own headless browser: fast, invisible, no setup. Many sites block it — the browser has no history, no logins and looks automated — and some only show data to logged-in users. In those cases the scripts can run in the user's own Chrome instead, as the user, with their logins and cookies.

## When to switch

- `inspect` prints `BLOCKED` (bot check, "access denied", captcha, 403 page), or `collect` stops with `blocked`.
- `inspect` prints `LOGIN?` and there is no popup to close, or `collect` stops with `login-wall`, and the user wants data that needs their account.
- The page shows less than the user sees in their own browser (region or account-specific content).

**Ask the user first.** Their Chrome acts with their accounts, and the scripts drive a Chrome tab they can see. Don't switch silently, and don't use it to get around a captcha or a login on their behalf: if their Chrome also hits a check, ask them to solve it or log in themselves in that tab, then retry.

## What the user sets up (once)

1. Install the **Playwright Extension** in Chrome: https://chromewebstore.google.com/detail/playwright-extension/mmlmfjhmonkocbjadbfplnigmagldckm
2. Node.js 18+ (already needed for this skill). The scripts run the Playwright CLI with `npx -y @playwright/cli@latest`, so nothing else has to be installed. To use an installed copy instead, set `PLAYWRIGHT_CLI=playwright-cli`. It must be a recent version: old CLIs (e.g. 0.1.7) speak an older extension protocol and only time out.
3. Optional: the extension shows a token. With `PLAYWRIGHT_MCP_EXTENSION_TOKEN=<token>` set, connecting needs no click in Chrome.

## How it runs

Add `--browser chrome` (or set `SCRAPE_BROWSER=chrome`):

```
node scripts/inspect.mjs <url> --browser chrome
node scripts/collect.mjs cfg.json --out rows.csv --browser chrome
node scripts/detail.mjs rows.csv detail.json --out full.csv --browser chrome
```

- The first call connects to Chrome: Chrome opens a connect page; without a token the user approves it there (the script waits up to 3 minutes). That tab is then driven by the scripts. Later calls reuse it (session `scrape`, change with `--session` / `SCRAPE_SESSION`).
- Tell the user not to use that tab while a run is going, and to **keep that Chrome window visible** (not minimized, not covered by another app). Chrome stops drawing hidden tabs, and then clicks, scrolling and lazy loading stall. The scripts switch the window to the scraping tab when it is in the background; if the window itself is hidden they stop with `tab-not-rendering` (inspect prints `HIDDEN`). Other tabs are untouched.
- Same config, same output. `collect` runs the whole loop inside Chrome and only writes the CSV at the end, so there is no partial file during a run.
- `detail.mjs` reads detail pages in that one tab, a few per call, one at a time (`concurrency` is ignored); the checkpoint is written between calls, so a stopped run resumes with the same command.
- On macOS the scripts point the CLI at the standard Chrome location (`PLAYWRIGHT_MCP_EXECUTABLE_PATH`), because otherwise the CLI looks for the extension in Chrome's profile folder, which privacy protection can block ("Playwright Extension not found" although it is installed). Set the variable yourself for a non-standard install.

## When connecting fails

| message | meaning |
|---|---|
| `Playwright Extension not found` | extension missing, or the CLI couldn't read the profile folder — set `PLAYWRIGHT_MCP_EXECUTABLE_PATH` to Chrome's executable |
| `Extension connection timeout` / `did not connect within` | old CLI version, wrong token, or the approval wasn't clicked |
| `run-code failed` | the tab was closed or navigated by hand during the run, or the connection dropped — rerun; the session reconnects (one more connect tab in Chrome) |
| `tab-not-rendering` / `HIDDEN` | the Chrome window is minimized or covered — ask the user to bring it to the front |

Report the message to the user; don't keep retrying.
