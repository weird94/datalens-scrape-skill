// Helpers that only use Playwright's `page` API, shared by the CLI scripts and the extension.
// Self-contained functions: they are also sent as source into `playwright-cli run-code`.

/** Wait until the element count and text length stop changing for quietMs (bounded by maxMs). */
export async function settle(page, { quietMs = 1200, maxMs = 8000 } = {}) {
  await page
    .evaluate(
      async ({ quietMs, maxMs }) => {
        const started = performance.now()
        let last = ''
        let stableSince = performance.now()
        // On a page built from web components nearly everything is inside shadow roots, which the plain
        // counts do not reach: count through them, or content still arriving there looks like a quiet page.
        const helpers = window.__dlk
        const inShadow = Boolean(helpers && helpers.shadowRootCount())
        while (performance.now() - started < maxMs) {
          const body = document.body
          const now = inShadow
            ? `${helpers.count('*')}:${helpers.bodyText().length}`
            : `${document.getElementsByTagName('*').length}:${body ? body.textContent.length : 0}`
          if (now !== last) {
            last = now
            stableSince = performance.now()
          } else if (performance.now() - stableSince >= quietMs) {
            return
          }
          await new Promise(resolve => setTimeout(resolve, 200))
        }
      },
      { quietMs, maxMs }
    )
    .catch(() => undefined)
}

/** Returns the main document's HTTP status (null if unknown). */
export async function gotoAndSettle(page, url, { wait = 0 } = {}) {
  const response = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 45_000 })
  await page.waitForLoadState('load', { timeout: 15_000 }).catch(() => undefined)
  await settle(page)
  if (wait > 0) {
    await page.waitForTimeout(wait)
    await settle(page)
  }
  return response ? response.status() : null
}

/**
 * Run setup steps in order (open a dialog, switch a tab, change the sort, reach a page through
 * its parent). Selectors here are Playwright selectors: CSS plus `:has-text("...")`, `text=...`.
 * Returns { done: [...], error?: string } — error names the first required step that failed.
 *
 *   { "click": sel, "force"?: true }      click (waits until visible/enabled); force skips checks
 *   { "goto": url }                        absolute or relative to the current page
 *   { "gotoHref": sel }                    navigate to the href of an element (links that open a new tab)
 *   { "fill": sel, "text": "...", "submit"?: true }
 *   { "select": sel, "value": "..." }      <select> option by value or label
 *   { "press": "Enter" }                   key on the focused element
 *   { "hover": sel }  { "scrollTo": sel }
 *   { "waitFor": sel }  { "wait": ms }
 * Every step takes "optional": true (skip on failure) and "timeoutMs" (default 10000).
 */
export async function runSetup(page, steps = []) {
  const done = []
  for (const [i, step] of steps.entries()) {
    const timeout = Number(step.timeoutMs ?? 10_000)
    const label = `setup[${i}] ${JSON.stringify(step)}`
    const urlBefore = page.url()
    try {
      if (step.goto) {
        await gotoAndSettle(page, new URL(step.goto, page.url()).href)
      } else if (step.gotoHref) {
        // page.evaluate rather than a locator, so hosts without Playwright locators can run it too.
        const deadline = Date.now() + timeout
        let href = ''
        while (!href && Date.now() < deadline) {
          href = await page.evaluate(sel => {
            let el = null
            if (window.__dlk) el = window.__dlk.locate(sel)
            else {
              try {
                el = document.querySelector(sel)
              } catch {
                el = null
              }
            }
            if (!el) return ''
            const a = el.closest('a[href]') || el.querySelector('a[href]')
            return a ? a.href : el.href || ''
          }, step.gotoHref)
          if (!href) await page.waitForTimeout(300)
        }
        if (!href) throw new Error('no element with a link matches')
        await gotoAndSettle(page, href)
      } else if (step.click) {
        // Several matches (a carousel, cards that each have the button, the page under a dialog)? Click the one on
        // screen: first() is document order, which may be scrolled away or covered.
        const marked = await page.evaluate(sel => (window.__dlk ? window.__dlk.markOnScreen(sel) : false), step.click).catch(() => false)
        await page.locator(marked ? '[data-dlk-target]' : step.click).first().click({ timeout, force: !!step.force })
      } else if (step.fill) {
        const box = page.locator(step.fill).first()
        await box.fill(String(step.text ?? ''), { timeout })
        if (step.submit) await box.press('Enter')
      } else if (step.select) {
        const sel = page.locator(step.select).first()
        await sel.selectOption(String(step.value), { timeout }).catch(() => sel.selectOption({ label: String(step.value) }, { timeout }))
      } else if (step.press) {
        await page.keyboard.press(step.press)
      } else if (step.hover) {
        await page.locator(step.hover).first().hover({ timeout })
      } else if (step.scrollTo) {
        await page.locator(step.scrollTo).first().scrollIntoViewIfNeeded({ timeout })
      } else if (step.waitFor) {
        await page.locator(step.waitFor).first().waitFor({ state: 'attached', timeout })
      } else if (step.wait) {
        await page.waitForTimeout(Number(step.wait))
      } else {
        throw new Error('unknown step (use click/goto/gotoHref/fill/select/press/hover/scrollTo/waitFor/wait)')
      }
      if (!step.goto && !step.gotoHref && !step.wait) {
        if (page.url() !== urlBefore) await page.waitForLoadState('load', { timeout: 15_000 }).catch(() => undefined)
        await settle(page, { quietMs: 800, maxMs: 8000 })
      }
      done.push({ step: i, ok: true, navigated: page.url() !== urlBefore || undefined })
    } catch (error) {
      const message = String(error.message || error).split('\n')[0]
      if (step.optional) {
        done.push({ step: i, ok: false, skipped: true, message })
        continue
      }
      return { done, error: `${label} failed: ${message}` }
    }
  }
  return { done }
}

