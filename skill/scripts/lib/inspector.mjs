// What inspect.mjs reports about a page, written against Playwright's `page` only so it also runs
// in the user's Chrome through run-code (see lib/chrome.mjs). Self-contained: everything comes in
// through `lib` ({ settle, gotoAndSettle, runSetup, installDlk }).
export async function inspectOnPage(page, opts, lib) {
  const { settle, gotoAndSettle, runSetup, installDlk } = lib
  const report = { url: opts.url }
  async function dlk(fn, arg) {
    if (!(await page.evaluate(() => !!window.__dlk))) await page.evaluate(installDlk)
    return page.evaluate(fn, arg)
  }
  // What a click or a scroll asks for is often a request: the page stays as it is until the answer comes,
  // which a wait for a quiet page alone takes for "nothing happened". Wait for the page to show something
  // new first (up to EFFECT_WAIT_MS), then for it to go quiet. Returns how long the first wait took.
  const EFFECT_WAIT_MS = 4000
  const changeMark = () => dlk(() => window.__dlk.changeMark()).catch(() => null)
  async function waitForEffect(shown) {
    const started = Date.now()
    while (Date.now() - started < EFFECT_WAIT_MS) {
      const now = await changeMark()
      if (now === null || now !== shown) break
      await page.waitForTimeout(250)
    }
    const waited = Date.now() - started
    await settle(page)
    return waited
  }
  try {
    report.status = await gotoAndSettle(page, opts.url, { wait: Number(opts.wait ?? 0) })
    const ticks = () => page.evaluate(() => new Promise(resolve => {
      requestAnimationFrame(() => resolve(true))
      setTimeout(() => resolve(false), 1500)
    }))
    if (!(await ticks())) {
      await page.bringToFront().catch(() => undefined)
      report.notRendering = !(await ticks())
    }
    // Clicks and scrolling wait for the page to be drawn; skip them on a hidden tab.
    if (!report.notRendering && opts.setup?.length) {
      await dlk(() => true)
      report.setup = await runSetup(page, opts.setup)
    }
    for (const css of report.notRendering ? [] : opts.clicks ?? []) {
      const state = await dlk(() => window.__dlk.pageState())
      const mark = await dlk(c => window.__dlk.markFirstClickable(c), css)
      if (!mark.usable) {
        report.clicks = [...(report.clicks ?? []), { css, result: mark.why || (mark.found ? 'found but not visible/enabled' : 'not found') }]
        continue
      }
      const before = page.url()
      const shown = await changeMark()
      await page.click('[data-dlk-target]', { timeout: 5000 }).catch(e => (report.clickError = String(e.message).split('\n')[0]))
      await page.waitForLoadState('load', { timeout: 10_000 }).catch(() => undefined)
      const waited = await waitForEffect(shown)
      const change = await dlk(([s, ms]) => window.__dlk.stateChange(s, ms), [state, waited]).catch(() => undefined)
      report.clicks = [...(report.clicks ?? []), { css, clicked: mark.text, navigated: page.url() !== before, change }]
    }
    if (opts.scroll && !report.notRendering) {
      const shown = await changeMark()
      await dlk(() => window.__dlk.scrollStep(null, 0, null))
      await waitForEffect(shown)
    }
    Object.assign(report, await dlk(() => ({ url: location.href, title: document.title, textLength: window.__dlk.bodyText().length, shadowRoots: window.__dlk.shadowRootCount() })))
    report.wall = await dlk(s => window.__dlk.wall(s), report.status)
    // A call that asks about particular elements gets those answers and the top lists, not the whole overview again.
    report.brief = !!(opts.probes?.length || opts.html?.length || opts.find?.length || opts.tree?.length)
    if (report.brief) {
      report.lists = await dlk(() => window.__dlk.lists(3))
    } else {
      report.lists = await dlk(() => window.__dlk.lists())
      report.tree = await dlk(() => window.__dlk.tree())
      const { controls, pagers } = await dlk(() => window.__dlk.controls())
      report.controls = controls
      report.pagers = pagers
      report.scroll = await dlk(() => window.__dlk.scrollers())
      report.overlays = await dlk(() => window.__dlk.overlays())
    }
    if (opts.tree?.length) report.trees = await dlk(sels => sels.map(s => window.__dlk.tree(s)), opts.tree)
    if (opts.find?.length) report.finds = await dlk(texts => texts.map(t => window.__dlk.find(t)), opts.find)
    const htmlSet = new Set(opts.html ?? [])
    report.probes = []
    for (const css of [...new Set([...(opts.probes ?? []), ...(opts.html ?? [])])]) {
      report.probes.push(await dlk(([c, h]) => window.__dlk.probe(c, 3, h), [css, htmlSet.has(css)]))
    }
    if (!report.brief || opts.text) {
      const text = await dlk(() => window.__dlk.bodyText())
      report.textHead = text.slice(0, opts.text ? 3000 : 300)
      report.textTail = text.slice(-300)
    }
  } catch (error) {
    report.error = String(error.message || error).split('\n')[0]
  }
  return report
}
