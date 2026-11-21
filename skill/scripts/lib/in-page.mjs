// Page helpers for inspect / collect, installed into the page as window.__dlk.
//
// installDlk must stay self-contained (no imports, no module-level references): it is sent into the
// page as source — Playwright's page.evaluate(installDlk), an init script `(${installDlk})()`, or the
// extension's chrome.scripting.executeScript({ func: installDlk }).
export function installDlk() {
  if (window.__dlk) return
  const DOC_ID = Math.random().toString(36).slice(2)
  const SKIP = new Set(['SCRIPT', 'STYLE', 'NOSCRIPT', 'TEMPLATE', 'SVG', 'PATH', 'BR', 'HR', 'META', 'LINK', 'OPTION', 'HEAD', 'TITLE'])

  const clean = s => (s || '').replace(/\s+/g, ' ').trim()
  const clip = (s, n) => (s.length > n ? s.slice(0, n) + '…' : s)
  const textOf = el => clean(renderedText(el) || el.textContent || '')

  function isVisible(el) {
    if (!el || !el.getClientRects || el.getClientRects().length === 0) return false
    const style = getComputedStyle(el)
    return style.visibility !== 'hidden' && style.display !== 'none' && Number(style.opacity) !== 0
  }
  const isDisabled = el =>
    el.disabled === true ||
    el.getAttribute('aria-disabled') === 'true' ||
    /(^|[\s_-])disabled?($|[\s_-])/i.test(el.className && el.className.baseVal === undefined ? el.className : '')

  /** On screen and on top: its center is in the viewport and not covered (by a dialog, a sticky bar) or clipped
   *  (a carousel's other slides). `isVisible` only says the element is rendered. */
  const onScreen = el => !!hitInside(el)

  /** What a click at the element's center lands on — the element or one of its descendants — or null when the
   *  center is off screen or covered by something else. */
  function hitInside(el) {
    const r = el.getBoundingClientRect()
    const x = r.left + r.width / 2
    const y = r.top + r.height / 2
    if (!r.width || !r.height || x < 0 || y < 0 || x >= innerWidth || y >= innerHeight) return null
    let hit = document.elementFromPoint(x, y)
    // A hit in a shadow tree is reported as its host: follow it down.
    while (hit && hit.shadowRoot) {
      const inner = hit.shadowRoot.elementFromPoint(x, y)
      if (!inner || inner === hit) break
      hit = inner
    }
    return hit && containsDeep(el, hit) ? hit : null
  }

  /** Click the way a person does. A real click starts at the innermost element under the pointer (the label span
   *  inside a button) and bubbles up; `el.click()` starts at `el`, so a handler on an inner element never runs and
   *  nothing happens. People aim at the label: click the element holding the first visible text (not one inside a
   *  nested link or button); an icon-only control gets what is drawn at its center. */
  function clickLikeUser(el) {
    let target = null
    const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT)
    for (let t = walker.nextNode(); t && !target; t = walker.nextNode()) {
      const parent = t.parentElement
      if (!t.nodeValue.trim() || !parent || TEXTLESS.has(parent.tagName) || !isVisible(parent)) continue
      const owner = parent.closest('a, button, [role="button"]')
      if (owner && owner !== el && el.contains(owner)) continue
      target = parent
    }
    ;(target || hitInside(el) || el).click()
  }

  // ---------- element refs ----------
  // Reports name the elements they list by ref (`ref=kqx12`), so a later click or html request reaches exactly the
  // element the agent saw even when its selector matches several. A ref lives as long as this document; the
  // random three-letter tag keeps a ref from an earlier page from resolving to some element of this one.
  const REF_TAG = Array.from({ length: 3 }, () => String.fromCharCode(97 + Math.floor(Math.random() * 26))).join('')
  const refIds = new WeakMap()
  const refEls = new Map()
  function refOf(el) {
    let id = refIds.get(el)
    if (!id) {
      id = REF_TAG + (refEls.size + 1)
      refIds.set(el, id)
      refEls.set(id, new WeakRef(el))
    }
    return id
  }

  // ---------- open shadow roots (web components) ----------
  // querySelectorAll, innerText and closest() stop at shadow boundaries. When the page has open shadow roots,
  // queries run in every tree (the document and each shadow root; one selector never spans a boundary) and
  // text is read along the rendered tree: shadow content in place of the host's children, slotted children in
  // their slots. Pages without shadow roots keep the native calls. Closed shadow roots stay unreadable.
  const TEXTLESS = new Set(['SCRIPT', 'STYLE', 'NOSCRIPT', 'TEMPLATE'])
  const hostOf = node => (node && node.nodeType === 11 && node.host) || null
  /** DOM parent; a shadow root's top-level element steps to the host. */
  const composedParent = n => n.parentElement || hostOf(n.parentNode)
  /** Rendered parent: a slotted element sits in its slot. */
  const flatParent = n => n.assignedSlot || composedParent(n)

  let shadowMemo = null
  /** null when the page has no open shadow root. Otherwise `marks`: shadow hosts, slots inside shadow trees and all
   *  their ancestors; `scopes`: the document and every open shadow root; `counts` / `ids`: match-count caches.
   *  Built once per synchronous call (each __dlk call is one) and dropped on the next microtask. */
  function shadowState() {
    if (shadowMemo === null) {
      const marks = new Set()
      const scopes = [document]
      const mark = el => {
        for (let n = el; n && !marks.has(n); n = composedParent(n)) marks.add(n)
      }
      const visit = (scope, inShadow) => {
        const walker = document.createTreeWalker(scope, NodeFilter.SHOW_ELEMENT)
        for (let el = walker.nextNode(); el; el = walker.nextNode()) {
          if (el.shadowRoot) {
            mark(el)
            scopes.push(el.shadowRoot)
            visit(el.shadowRoot, true)
          } else if (inShadow && el.tagName === 'SLOT') mark(el)
        }
      }
      visit(document, false)
      shadowMemo = scopes.length > 1 ? { marks, scopes, counts: new Map(), ids: null } : false
      queueMicrotask(() => {
        shadowMemo = null
      })
    }
    return shadowMemo || null
  }
  const shadowMarks = () => shadowState()?.marks || null

  /** How many elements on the page match `css`, shadow roots included (unordered, so cheaper than qsa). */
  function countAll(css) {
    const shadow = shadowState()
    if (!shadow) return document.querySelectorAll(css).length
    let n = shadow.counts.get(css)
    if (n === undefined) {
      n = crossesTrees(css) ? qsa(css).length : shadow.scopes.reduce((sum, scope) => sum + scope.querySelectorAll(css).length, 0)
      shadow.counts.set(css, n)
    }
    return n
  }

  // ---------- selectors that reach into shadow roots ----------
  // A descendant combinator (a space) crosses open shadow roots, as in Playwright: "comment-card .author" finds
  // .author inside comment-card's shadow root, at any depth. ">", "+" and "~" stay inside one tree.
  const selectorMemo = new Map()
  /** The selector list split at top-level commas, each selector at its top-level descendant combinators. */
  function descendantParts(css) {
    let parsed = selectorMemo.get(css)
    if (parsed) return parsed
    parsed = []
    let segs = []
    let cur = ''
    let depth = 0
    let quote = ''
    const endSeg = () => {
      const t = cur.trim()
      if (t) segs.push(t)
      cur = ''
    }
    for (let i = 0; i < css.length; i += 1) {
      const c = css[i]
      if (c === '\\') {
        cur += c + (css[i + 1] ?? '')
        i += 1
      } else if (quote) {
        cur += c
        if (c === quote) quote = ''
      } else if (c === '"' || c === "'") {
        quote = c
        cur += c
      } else if (c === '(' || c === '[') {
        depth += 1
        cur += c
      } else if (c === ')' || c === ']') {
        depth -= 1
        cur += c
      } else if (depth === 0 && c === ',') {
        endSeg()
        if (segs.length) parsed.push(segs)
        segs = []
      } else if (depth === 0 && /\s/.test(c)) {
        let j = i
        while (j + 1 < css.length && /\s/.test(css[j + 1])) j += 1
        const next = css[j + 1]
        const before = cur.trimEnd().slice(-1)
        // Whitespace around > + ~ or before a comma is not a combinator of its own.
        if (cur.trim() && next !== undefined && !'>+~,'.includes(next) && !'>+~'.includes(before)) endSeg()
        else cur += ' '
        i = j
      } else {
        cur += c
      }
    }
    endSeg()
    if (segs.length) parsed.push(segs)
    selectorMemo.set(css, parsed)
    return parsed
  }
  const crossesTrees = css => descendantParts(css).some(segs => segs.length > 1)

  /** `segs` but the last match ancestors of `el` in that order, nearest first, stepping out of shadow roots. */
  function ancestorsMatch(el, segs) {
    let n = composedParent(el)
    for (let i = segs.length - 2; i >= 0; i -= 1) {
      while (n && !n.matches(segs[i])) n = composedParent(n)
      if (!n) return false
      n = composedParent(n)
    }
    return true
  }

  /** element.matches, with descendant combinators crossing shadow roots like qsa. */
  function deepMatches(el, css) {
    if (!shadowState() || !crossesTrees(css)) return el.matches(css)
    return descendantParts(css).some(segs => el.matches(segs[segs.length - 1]) && ancestorsMatch(el, segs))
  }

  /** How many elements on the page carry this id, shadow roots included (one pass builds the table). */
  function idCount(id) {
    const shadow = shadowState()
    if (!shadow) return document.querySelectorAll('#' + CSS.escape(id)).length
    if (!shadow.ids) {
      shadow.ids = new Map()
      for (const scope of shadow.scopes) for (const el of scope.querySelectorAll('[id]')) shadow.ids.set(el.id, (shadow.ids.get(el.id) || 0) + 1)
    }
    return shadow.ids.get(id) || 0
  }

  /** querySelectorAll on `root`, and inside the open shadow roots under it, in rendered order. A descendant
   *  combinator crosses shadow roots ("host .inner"). Throws on bad CSS. */
  function qsa(css, root = document) {
    const marks = shadowMarks()
    if (!marks) return [...root.querySelectorAll(css)]
    if (!crossesTrees(css)) return qsaTrees(css, root, marks)
    const parts = descendantParts(css)
    const hits = []
    for (const segs of parts) {
      for (const el of qsaTrees(segs[segs.length - 1], root, marks)) if (segs.length === 1 || ancestorsMatch(el, segs)) hits.push(el)
    }
    if (parts.length === 1) return hits
    const keep = new Set(hits)
    return qsaTrees('*', root, marks).filter(el => keep.has(el))
  }

  /** qsa where every selector matches inside one tree (the document or one shadow root). */
  function qsaTrees(css, root, marks) {
    if (root !== document && !marks.has(root)) return [...root.querySelectorAll(css)]
    const out = []
    const visit = scope => {
      const hits = new Set(scope.querySelectorAll(css))
      const walker = document.createTreeWalker(scope, NodeFilter.SHOW_ELEMENT)
      for (let el = walker.nextNode(); el; el = walker.nextNode()) {
        if (hits.has(el)) out.push(el)
        if (el.shadowRoot) visit(el.shadowRoot)
      }
    }
    if (root.shadowRoot) visit(root.shadowRoot)
    visit(root)
    return out
  }
  const qs = (css, root) => qsa(css, root)[0] || null

  function closestDeep(el, css) {
    for (let n = el; n; n = hostOf(n.getRootNode())) {
      const hit = n.closest(css)
      if (hit) return hit
    }
    return null
  }

  function containsDeep(a, b) {
    for (let n = b; n; n = hostOf(n.getRootNode())) if (a.contains(n)) return true
    return false
  }

  /** innerText along the rendered tree. With `limit`: null as soon as more than `limit` characters are read
   *  (for callers that only want short texts; the native path returns the whole text). */
  function renderedText(el, limit = Infinity) {
    const marks = shadowMarks()
    if (!marks || !marks.has(el)) return el.innerText || ''
    const parts = []
    let length = 0
    const push = s => {
      parts.push(s)
      length += s.length
    }
    const visit = node => {
      if (length > limit) return
      if (node.nodeType === 3) return push(node.data.replace(/\s+/g, ' '))
      if (node.nodeType !== 1 || TEXTLESS.has(node.tagName)) return
      if (node.tagName === 'BR') return push('\n')
      const style = getComputedStyle(node)
      if (style.display === 'none' || style.visibility === 'hidden') return
      const block = style.display !== 'contents' && !style.display.startsWith('inline')
      if (block) push('\n')
      if (!marks.has(node)) push(node.innerText || '')
      else if (node.shadowRoot) node.shadowRoot.childNodes.forEach(visit)
      else if (node.tagName === 'SLOT') {
        const assigned = node.assignedNodes({ flatten: true })
        ;(assigned.length ? assigned : [...node.childNodes]).forEach(visit)
      } else node.childNodes.forEach(visit)
      if (block) push('\n')
    }
    visit(el)
    if (length > limit) return null
    return parts.join('').replace(/[ \t]*\n[ \t]*/g, '\n').replace(/\n{3,}/g, '\n\n').trim()
  }

  function seg(el) {
    const id = el.id
    if (id && /^[A-Za-z][\w-]{0,40}$/.test(id) && !/\d{4,}/.test(id) && idCount(id) === 1) {
      return '#' + CSS.escape(id)
    }
    const tag = el.tagName.toLowerCase()
    const classes = [...el.classList].filter(c => c.length <= 40).slice(0, 3)
    return classes.length ? tag + classes.map(c => '.' + CSS.escape(c)).join('') : tag
  }

  function cssPath(el, maxDepth = 4) {
    const parts = []
    let cur = el
    while (cur && cur.nodeType === 1 && cur !== document.documentElement && cur !== document.body && parts.length < maxDepth) {
      const s = seg(cur)
      parts.unshift(s)
      if (s.startsWith('#')) break
      if (parts.length > 1 && countAll(parts.join(' > ')) === 1) break
      cur = cur.parentElement
    }
    return parts.join(' > ')
  }

  const landmark = el => !!closestDeep(el, 'nav, header, footer, aside, [role=navigation], [role=banner], [role=contentinfo]')

  /** Repeated structures that look like lists: sibling groups and same-class elements spread across parents. */
  function lists(limit = 10) {
    const parentIds = new WeakMap()
    let nextId = 0
    const pid = p => {
      if (!parentIds.has(p)) parentIds.set(p, ++nextId)
      return parentIds.get(p)
    }
    const sibling = new Map()
    const spread = new Map()
    for (const el of qsa('*', document.body)) {
      if (SKIP.has(el.tagName.toUpperCase())) continue
      // A shadow root's top-level elements are siblings under the root itself (selectors are per tree).
      const parent = el.parentElement || el.parentNode
      if (!parent) continue
      const sig = seg(el).startsWith('#') ? el.tagName.toLowerCase() + [...el.classList].map(c => '.' + CSS.escape(c)).join('') : seg(el)
      const tagOnly = el.tagName.toLowerCase()
      for (const key of new Set([pid(parent) + '|' + sig, pid(parent) + '|' + tagOnly])) {
        if (!sibling.has(key)) sibling.set(key, { parent, item: key.split('|')[1], els: [] })
        sibling.get(key).els.push(el)
      }
      if (el.classList.length) {
        if (!spread.has(sig)) spread.set(sig, { item: sig, els: [], parents: new Set() })
        const g = spread.get(sig)
        g.els.push(el)
        g.parents.add(parent)
      }
    }
    const out = []
    const describe = (selector, els, extra) => {
      const texts = els.map(textOf)
      const avg = texts.reduce((a, t) => a + t.length, 0) / els.length
      const links = els.filter(e => e.tagName === 'A' || qs('a[href]', e)).length / els.length
      const visible = els.filter(isVisible).length
      const nav = els.filter(landmark).length > els.length / 2
      const score = els.length * Math.log2(2 + Math.min(avg, 300)) * (1 + links) * (0.5 + (0.5 * visible) / els.length) * (nav ? 0.3 : 1)
      return { selector, count: els.length, visible, avgText: Math.round(avg), links: Math.round(links * 100), nav, score, els, samples: texts.filter(Boolean).slice(0, 2).map(t => clip(t, 100)), ...extra }
    }
    for (const g of sibling.values()) {
      if (g.els.length < 3) continue
      const d = describe(g.parent.nodeType === 11 ? g.item : `${cssPath(g.parent)} > ${g.item}`, g.els, {})
      if (d.avgText >= 4) out.push(d)
    }
    for (const g of spread.values()) {
      if (g.els.length < 3 || g.parents.size < 2) continue
      const d = describe(g.item, g.els, { spreadOver: g.parents.size })
      if (d.avgText >= 4) out.push(d)
    }
    // Drop groups that are just a field inside every row of a bigger-or-equal group (titles inside cards).
    out.sort((a, b) => b.score - a.score)
    const kept = []
    for (const c of out) {
      const isField = kept.some(p => p.count === c.count && p.els[0] !== c.els[0] && containsDeep(p.els[0], c.els[0]) && containsDeep(p.els[p.els.length - 1], c.els[c.els.length - 1]))
      const dup = kept.some(p => p.count === c.count && p.els[0] === c.els[0] && p.els[p.els.length - 1] === c.els[c.els.length - 1])
      if (!isField && !dup) kept.push(c)
      if (kept.length >= limit) break
    }
    return kept.map(({ els, score, ...rest }) => rest)
  }

  const PAGER_TEXT = /下一页|下页|下一頁|次へ|次のページ|next|more|更多|加载|載入|load|展开|展開|全部|show|view all|older|›|»|→|^>$|^\d{1,4}$|もっと|さらに|翻页/i
  const PAGER_HINT = /next|arrow|pag(er|ination)|more|load/i

  function controls(limit = 25) {
    const out = []
    const seen = new Set()
    for (const el of qsa('a[href], button, [role=button], [role=link], [onclick], input[type=button], input[type=submit], [tabindex]')) {
      if (seen.has(el)) continue
      const label = clean(renderedText(el) || el.value || '') || clean(el.getAttribute('aria-label') || el.getAttribute('title') || '')
      const hint = `${el.className && el.className.baseVal === undefined ? el.className : ''} ${el.getAttribute('aria-label') || ''} ${el.getAttribute('rel') || ''}`
      if (!(label.length <= 24 && PAGER_TEXT.test(label)) && !PAGER_HINT.test(hint)) continue
      seen.add(el)
      const selector = cssPath(el)
      out.push({
        ref: refOf(el),
        selector,
        matches: countSafe(selector),
        tag: el.tagName.toLowerCase(),
        text: clip(label, 30),
        aria: el.getAttribute('aria-label') || undefined,
        href: el.getAttribute('href') ? clip(el.getAttribute('href'), 80) : undefined,
        visible: isVisible(el),
        disabled: isDisabled(el) || undefined,
        pressed: el.getAttribute('aria-pressed') || el.getAttribute('aria-selected') || undefined,
      })
      if (out.length >= limit) break
    }
    const PAGER_CLASS = /(^|[\s_-])(pag(er|ination|inator)|page-?(nav|list|bar))($|[\s_-])/i
    const pagers = qsa('[class], [role=navigation], nav')
      .filter(e => (e.matches('[role=navigation], nav') || PAGER_CLASS.test(typeof e.className === 'string' ? e.className : '')) && isVisible(e) && textOf(e).length < 200 && /\d/.test(textOf(e)))
      .slice(0, 3)
      .map(e => ({ selector: cssPath(e), text: clip(textOf(e), 120) }))
    return { controls: out, pagers }
  }

  function scrollers() {
    const out = []
    for (const el of qsa('*', document.body)) {
      const style = getComputedStyle(el)
      if (!/(auto|scroll)/.test(style.overflowY)) continue
      if (el.scrollHeight <= el.clientHeight + 40 || el.clientHeight < 100) continue
      out.push({ selector: cssPath(el), clientHeight: el.clientHeight, scrollHeight: el.scrollHeight })
    }
    const se = document.scrollingElement
    return {
      window: { scrollHeight: se.scrollHeight, viewport: innerHeight, scrollTop: Math.round(se.scrollTop) },
      bodyScrollLocked: [document.body, document.documentElement].some(e => getComputedStyle(e).overflow === 'hidden' || getComputedStyle(e).overflowY === 'hidden'),
      containers: out.slice(0, 6),
    }
  }

  const CLOSE_TEXT = /^(×|✕|✖|x|关闭|關閉|close|閉じる|稍后|以后再说|不用了|no thanks|dismiss|skip|跳过|reject all|decline|necessary only|only necessary|拒绝|全部拒绝|仅必要|仅限必要)$/i
  function overlays() {
    const out = []
    for (const el of qsa('*', document.body)) {
      const style = getComputedStyle(el)
      if (style.position !== 'fixed' || !isVisible(el)) continue
      const r = el.getBoundingClientRect()
      if (r.width * r.height < innerWidth * innerHeight * 0.15) continue
      const closers = qsa('button, a, [role=button], span, i, div', el)
        .filter(c => isVisible(c) && (CLOSE_TEXT.test(clean(renderedText(c))) || /close|关闭|dismiss/i.test(`${c.getAttribute('aria-label') || ''} ${c.className && c.className.baseVal === undefined ? c.className : ''}`)))
        .slice(0, 3)
      out.push({ selector: cssPath(el), zIndex: style.zIndex, text: clip(textOf(el), 100), closers: closers.map(c => cssPath(c)), closerRefs: closers.map(refOf) })
    }
    return out.slice(0, 4)
  }

  /** Readable markup is cut here; the note says how to see the rest. */
  const HTML_LIMIT = 4000

  /** How many elements a selector matches, 0 for one the engine cannot parse. */
  function countSafe(css) {
    try {
      return countAll(css)
    } catch {
      return 0
    }
  }

  // ---------- readable markup ----------
  const VOID_TAGS = new Set(['AREA', 'BASE', 'BR', 'COL', 'EMBED', 'HR', 'IMG', 'INPUT', 'LINK', 'META', 'SOURCE', 'TRACK', 'WBR'])
  const DROPPED_TAGS = new Set(['SCRIPT', 'STYLE', 'NOSCRIPT', 'TEMPLATE', 'LINK', 'META'])
  const SVG_NS = 'http://www.w3.org/2000/svg'
  const attrValue = v => (v.length > 100 ? `${v.slice(0, 60)}…${v.slice(-20)}` : v).replace(/&/g, '&amp;').replace(/"/g, '&quot;')
  function attrsOf(el, only) {
    let out = ''
    for (const a of el.attributes) {
      if (only ? !only.includes(a.name) : a.name === 'style' || a.name === 'data-dlk-target' || (a.name.startsWith('data-v-') && !a.value)) continue
      out += a.value === '' ? ` ${a.name}` : ` ${a.name}="${attrValue(a.value)}"`
    }
    return out
  }
  const kindOf = el => el.tagName.toLowerCase() + [...el.classList].slice(0, 3).map(c => '.' + c).join('')
  /** The element's markup for writing selectors: open shadow roots as <template shadowrootmode="open"> (as
   *  getHTML writes them), without scripts, styles, comments, svg internals or inline styles, long attribute
   *  values shortened, and a run of 3+ alike siblings shown as its first two. */
  function htmlOf(root) {
    const parts = []
    let size = 0
    const push = text => {
      parts.push(text)
      size += text.length
    }
    const children = nodes => {
      const list = [...nodes].filter(n => (n.nodeType === 1 ? !DROPPED_TAGS.has(n.tagName) : n.nodeType === 3 && n.data.trim()))
      for (let i = 0; i < list.length && size < 200_000; ) {
        const node = list[i]
        if (node.nodeType === 3) {
          push(node.data.replace(/\s+/g, ' '))
          i += 1
          continue
        }
        const kind = kindOf(node)
        let j = i + 1
        while (j < list.length && list[j].nodeType === 1 && kindOf(list[j]) === kind) j += 1
        if (j - i >= 3) {
          visit(list[i])
          visit(list[i + 1])
          push(` …(${j - i - 2} more ${kind}) `)
          i = j
        } else {
          visit(node)
          i += 1
        }
      }
    }
    const visit = el => {
      if (el.namespaceURI === SVG_NS) return push(`<svg${attrsOf(el, ['class', 'aria-label', 'role'])}/>`)
      const tag = el.tagName.toLowerCase()
      push(`<${tag}${attrsOf(el)}>`)
      if (VOID_TAGS.has(el.tagName)) return
      if (el.shadowRoot) {
        push('<template shadowrootmode="open">')
        children(el.shadowRoot.childNodes)
        push('</template>')
      }
      children(el.childNodes)
      push(`</${tag}>`)
    }
    visit(root)
    return parts.join('').replace(/\s+/g, ' ')
  }

  // ---------- page tree ----------
  // The page as it renders, one element per line, for seeing where the data is and what one record holds before
  // writing selectors: open shadow roots and slotted content in place, hidden elements left out, a wrapper with one
  // child merged into its child's line, a run of 3+ alike siblings as its first two. Parts that don't fit the
  // budget stay closed with a ref; tree("ref=…") opens one.
  const TREE_BUDGET = 5000
  const TREE_PART_BUDGET = 8000
  const TREE_TEXT = 40
  const TREE_ATTRS = ['href', 'role', 'aria-label', 'title', 'alt', 'type', 'placeholder', 'data-testid']
  const TREE_SKIP = new Set(['SOURCE', 'TRACK', 'BR', 'WBR'])
  const shown = el => el.namespaceURI === SVG_NS || getComputedStyle(el).display === 'contents' || isVisible(el)
  /** Children in rendered order: a shadow host's shadow content, a slot's assigned nodes. */
  function viewChildren(el) {
    const out = []
    const add = nodes => {
      for (const n of nodes) {
        if (n.nodeType === 3) {
          if (n.data.trim()) out.push(n)
        } else if (n.nodeType !== 1 || DROPPED_TAGS.has(n.tagName) || NOT_SHOWN.has(n.tagName) || TREE_SKIP.has(n.tagName)) continue
        else if (n.tagName === 'SLOT') {
          const assigned = n.assignedNodes({ flatten: true })
          add(assigned.length ? assigned : n.childNodes)
        } else if (shown(n)) out.push(n)
      }
    }
    if (el.namespaceURI !== SVG_NS) add(el.shadowRoot ? el.shadowRoot.childNodes : el.childNodes)
    return out
  }
  const isCustom = el => el.tagName.includes('-')
  /** Siblings of one kind fold together. An id without digits names a one-off element (#header, #feed), not an item. */
  const treeKind = el => (isCustom(el) ? el.tagName.toLowerCase() : kindOf(el) + (el.id && !/\d/.test(el.id) ? '#' + el.id : ''))
  function treeHead(el) {
    if (el.namespaceURI === SVG_NS) return 'svg' + (el.getAttribute('aria-label') ? `(aria-label="${clip(clean(el.getAttribute('aria-label')), 50)}")` : '')
    const id = el.id && el.id.length <= 40 ? '#' + el.id : ''
    const classes = [...el.classList].filter(c => c.length <= 40).slice(0, 3).map(c => '.' + c).join('')
    const attrs = TREE_ATTRS.map(a => [a, el.getAttribute(a)]).filter(([, v]) => v).map(([a, v]) => `${a}="${clip(clean(v), 50)}"`)
    return el.tagName.toLowerCase() + id + classes + (attrs.length ? `(${attrs.join(' ')})` : '') + (el.shadowRoot ? ' (shadow)' : '')
  }
  /** A wrapper that says nothing on its own: merged into its only child's line. */
  const plainWrapper = el => !isCustom(el) && !el.shadowRoot && el.namespaceURI !== SVG_NS && !el.matches(CLICKABLE) && !TREE_ATTRS.some(a => el.hasAttribute(a))
  function buildTree(el) {
    const chain = []
    let cur = el
    let kids = viewChildren(cur)
    for (;;) {
      chain.push(treeHead(cur))
      const only = kids.length === 1 && kids[0].nodeType === 1 ? kids[0] : null
      if (!only || !plainWrapper(cur)) break
      cur = only
      kids = viewChildren(cur)
    }
    const line = chain.length > 3 ? '… > ' + chain.slice(-3).join(' > ') : chain.join(' > ')
    // `signal`: the part shows text, a link, a label or something to click. A big part without any (avatars,
    // icons, layout layers) stays closed.
    const node = { el: cur, line, kids: [], lines: 1, signal: cur.matches(CLICKABLE) || TREE_ATTRS.some(a => cur.hasAttribute(a)) }
    if (kids.every(k => k.nodeType === 3)) {
      const text = clip(clean(kids.map(k => k.data).join(' ')), TREE_TEXT)
      if (text) {
        node.line += ` "${text}"`
        node.signal = true
      }
      return node
    }
    const leaf = (text, signal) => ({ line: text, kids: [], lines: 1, signal })
    for (let i = 0; i < kids.length; ) {
      const kid = kids[i]
      if (kid.nodeType === 3) {
        node.kids.push(leaf(`| "${clip(clean(kid.data), TREE_TEXT)}"`, true))
        i += 1
        continue
      }
      const kind = treeKind(kid)
      let j = i + 1
      while (j < kids.length && kids[j].nodeType === 1 && treeKind(kids[j]) === kind) j += 1
      if (j - i >= 3) {
        node.kids.push(buildTree(kids[i]), buildTree(kids[i + 1]), leaf(`…(${j - i - 2} more ${kind})`, false))
        i = j
      } else {
        node.kids.push(buildTree(kid))
        i += 1
      }
    }
    node.lines += node.kids.reduce((sum, k) => sum + k.lines, 0)
    node.signal ||= node.kids.some(k => k.signal)
    return node
  }
  /** Opens the tree level by level while it fits `budget` characters; what doesn't fit stays closed. A part of a
   *  few lines always opens: its closed line would be no shorter. */
  const CLOSED_LINE = 50
  function renderTree(root, budget) {
    const open = new Set()
    let used = root.line.length + CLOSED_LINE
    const queue = [[root, 0]]
    while (queue.length) {
      const [node, depth] = queue.shift()
      const cost = node.kids.reduce((sum, k) => sum + (depth + 1) * 2 + k.line.length + (k.kids.length ? CLOSED_LINE : 1), 0) - CLOSED_LINE
      if (node !== root && node.lines > 4 && (!node.signal || used + cost > budget)) continue
      open.add(node)
      used += cost
      for (const k of node.kids) if (k.kids.length) queue.push([k, depth + 1])
    }
    const lines = []
    const write = (node, depth) => {
      const closed = node.kids.length && !open.has(node)
      let line = '  '.repeat(depth) + node.line
      if (node.el && (closed || node.el.matches(CLICKABLE))) line += ` [ref=${refOf(node.el)}]`
      if (closed) line += node.signal ? ` {+${node.lines - 1} lines: "${clip(textOf(node.el), TREE_TEXT)}"}` : ` {+${node.lines - 1} lines, no text}`
      lines.push(line)
      if (!closed) for (const k of node.kids) write(k, depth + 1)
    }
    write(root, 0)
    return lines.join('\n')
  }
  /** The tree of the page, or of the first element `sel` (a selector or a ref) matches. */
  function tree(sel) {
    let el = document.body
    let note
    if (sel) {
      const { els, why } = matchInfo(sel)
      if (!els.length) return { selector: sel, why }
      el = els[0]
      if (els.length > 1) note = `first of ${els.length}`
    }
    const root = buildTree(el)
    return { selector: sel || 'body', note, lines: root.lines, text: renderTree(root, sel ? TREE_PART_BUDGET : TREE_BUDGET) }
  }
  /** How many open shadow roots the page has. */
  const shadowRootCount = () => (shadowState()?.scopes.length ?? 1) - 1

  // ---------- find by text ----------
  const CLICKABLE ='a[href], button, [role=button], [role=link], [role=tab], [role=menuitem], [role=option], [onclick], summary, label, input[type=button], input[type=submit]'
  const LABEL_ATTRS = ['aria-label', 'title', 'alt', 'placeholder']
  const NOT_SHOWN = new Set([...TEXTLESS, 'TITLE', 'HEAD'])
  /** Elements that show `text` (case-insensitive, open shadow roots included): the element holding it in its own
   *  text or in aria-label / title / alt / placeholder, on-screen ones first, each with its ref, a selector, how many
   *  elements that selector matches, and the clickable element around it when that is another one. */
  function find(text, n = 6) {
    const t = clean(text).toLowerCase()
    if (!t) return { text, count: 0, hits: [] }
    const found = new Set()
    for (const scope of shadowState()?.scopes || [document]) {
      const walker = document.createTreeWalker(scope, NodeFilter.SHOW_TEXT)
      for (let node = walker.nextNode(); node; node = walker.nextNode()) {
        const parent = node.parentElement
        if (parent && !NOT_SHOWN.has(parent.tagName) && node.data.replace(/\s+/g, ' ').toLowerCase().includes(t)) found.add(parent)
      }
      for (const el of scope.querySelectorAll(LABEL_ATTRS.map(a => `[${a}]`).join(', '))) {
        if (LABEL_ATTRS.some(a => (el.getAttribute(a) || '').toLowerCase().includes(t))) found.add(el)
      }
    }
    // Text split over several nodes ("展开" <b>3</b> "条回复"): the smallest elements whose text holds it.
    if (!found.size) {
      const shows = el => (el.textContent || '').toLowerCase().includes(t) && clean(renderedText(el)).toLowerCase().includes(t)
      const holders = qsa('*').filter(el => !NOT_SHOWN.has(el.tagName) && shows(el))
      for (const el of holders) if (!holders.some(other => other !== el && containsDeep(el, other))) found.add(el)
    }
    const rank = el => (onScreen(el) ? 0 : isVisible(el) ? 1 : 2)
    const els = [...found].sort((a, b) => rank(a) - rank(b))
    const describe = el => {
      const selector = cssPath(el)
      return { ref: refOf(el), selector, matches: countSafe(selector), tag: el.tagName.toLowerCase(), text: clip(textOf(el) || LABEL_ATTRS.map(a => el.getAttribute(a)).find(Boolean) || '', 80), visible: isVisible(el), onScreen: onScreen(el) }
    }
    return {
      text,
      count: els.length,
      hits: els.slice(0, n).map(el => {
        const target = closestDeep(el, CLICKABLE)
        return { ...describe(el), click: target && target !== el ? describe(target) : undefined }
      }),
    }
  }

  // ---------- what a click changed ----------
  /** A cheap picture of the page, to say what an action changed. */
  // The page text at the last pageState, kept here (not sent back and forth) to tell what a click replaced.
  let stateText = null
  function pageState() {
    stateText = bodyText()
    return {
      url: location.href,
      elements: qsa('*', document.body).length,
      text: stateText.length,
      // Whole-page counts (a list's own count is one group's), each selector once.
      lists: [...new Set(lists(6).map(l => l.selector))].map(selector => ({ selector, count: countSafe(selector) })),
      overlays: overlays().map(o => o.selector),
    }
  }
  /** Differs after anything the page shows or holds changed (shadow roots included), or it went elsewhere. */
  function changeMark() {
    const text = bodyText()
    let hash = 5381
    for (let i = 0; i < text.length; i += 1) hash = ((hash << 5) + hash + text.charCodeAt(i)) | 0
    return `${location.href}|${countAll('*')}:${hash}`
  }
  const signed = n => (n > 0 ? `+${n}` : String(n))
  /** One line on what changed since `before` (a pageState). `waitedMs`: how long the caller waited for a change. */
  function stateChange(before, waitedMs = 0) {
    const was = stateText
    const now = pageState()
    const out = []
    if (now.url !== before.url) out.push(`URL is now ${now.url}`)
    for (const l of now.lists) if (!before.lists.some(b => b.selector === l.selector)) out.push(`new list ${l.selector} ×${l.count}`)
    for (const b of before.lists) {
      const count = countSafe(b.selector)
      if (count !== b.count) out.push(`${b.selector} ×${b.count} → ×${count}`)
    }
    for (const o of now.overlays) if (!before.overlays.includes(o)) out.push(`overlay appeared: ${o}`)
    for (const o of before.overlays) if (!now.overlays.includes(o)) out.push(`overlay closed: ${o}`)
    const elements = now.elements - before.elements
    const text = now.text - before.text
    // Same size, other content: a pager that swaps one page of items for the next changes neither count.
    const swapped = now.url === before.url && was !== null && was.length === before.text ? replacedSpan(was, stateText) : null
    if (swapped) out.push(`text replaced in place: ${swapped.removed} chars gave way to ${swapped.added}, now "${clip(swapped.sample, 60)}"`)
    if (!out.length && Math.abs(elements) < 3 && Math.abs(text) < 20) {
      return `no visible change${waitedMs ? ` within ${Math.round(waitedMs / 1000)}s` : ''} (same lists, overlays, element count and text)`
    }
    out.push(`elements ${signed(elements)}, visible text ${signed(text)} chars`)
    return out.join('; ')
  }
  /** What lies between the common start and the common end of two texts, when both sides are more than a label. */
  function replacedSpan(was, now) {
    const max = Math.min(was.length, now.length)
    let head = 0
    while (head < max && was[head] === now[head]) head += 1
    let tail = 0
    while (tail < max - head && was[was.length - 1 - tail] === now[now.length - 1 - tail]) tail += 1
    const removed = was.length - head - tail
    const added = now.length - head - tail
    return removed > 20 && added > 20 ? { removed, added, sample: now.slice(head, head + 80) } : null
  }

  function probe(css, n = 3, html = false) {
    const { els, why } = matchInfo(css)
    const sample = e => ({ ref: refOf(e), text: clip(textOf(e), 160) })
    let markupText
    if (html && els[0]) {
      const full = htmlOf(els[0])
      markupText =
        full.length > HTML_LIMIT
          ? `${full.slice(0, HTML_LIMIT)} …[cut at ${HTML_LIMIT} of ${full.length} chars. For the rest, ask for the html of an element inside this one: a deeper selector, or a ref from find]`
          : full
    }
    return {
      selector: css,
      count: els.length,
      why: els.length ? undefined : why,
      visible: els.filter(isVisible).length,
      onScreen: els.filter(onScreen).length,
      first: els.slice(0, n).map(sample),
      last: els.length > n ? els.slice(-Math.min(2, els.length - n)).map(sample) : [],
      html: markupText,
    }
  }

  // ---------- extraction ----------
  const PLACEHOLDER_NAME = /spacer|placeholder|blank\.(gif|png)|1x1|pixel\.(gif|png)/i
  const isPlaceholder = v => (v.startsWith('data:') ? v.length < 400 : PLACEHOLDER_NAME.test(v))
  function imageSrc(el) {
    const img = el.tagName === 'IMG' ? el : qs('img', el)
    if (!img) {
      const bg = getComputedStyle(el).backgroundImage.match(/url\(["']?(.+?)["']?\)/)
      return bg ? bg[1] : ''
    }
    const candidates = [img.currentSrc, img.getAttribute('src'), img.getAttribute('data-src'), img.getAttribute('data-original'), img.getAttribute('data-lazy-src'), img.getAttribute('data-url'), (img.getAttribute('srcset') || img.getAttribute('data-srcset') || '').split(',')[0].trim().split(' ')[0]]
    const hit = candidates.find(v => v && !isPlaceholder(v)) || ''
    try {
      return hit ? new URL(hit, location.href).href : ''
    } catch {
      return hit
    }
  }

  // ---------- field post-processing ----------
  const UNIT = { k: 1e3, K: 1e3, m: 1e6, M: 1e6, b: 1e9, B: 1e9, 千: 1e3, 万: 1e4, 萬: 1e4, 亿: 1e8, 億: 1e8 }
  /** First number in the text: thousands separators dropped, k/M/B and 千/万/亿 suffixes applied. '' if none. */
  function toNumber(text) {
    const s = String(text).replace(/(\d)[,，'’](?=\d{3}(?!\d))/g, '$1')
    const m = s.match(/(-?\d+(?:\.\d+)?)\s*([kKmMbB](?![a-zA-Z])|[千万萬亿億])?/)
    if (!m) return ''
    // No unit: keep the digits as written ("9.0" stays "9.0"); with a unit, compute the value.
    if (!m[2]) return m[1]
    return String(Math.round(parseFloat(m[1]) * UNIT[m[2]] * 100) / 100)
  }

  /** split/part → regex → replace → number → default, in that order. */
  function postProcess(value, spec) {
    let v = value
    if (spec.split !== undefined) {
      const parts = v.split(spec.split).map(s => s.replace(/\s+/g, ' ').trim()).filter(Boolean)
      let p = spec.part ?? 0
      if (p < 0) p += parts.length
      v = parts[p] ?? ''
    }
    if (spec.regex) {
      const flags = String(spec.flags || '').replace(/[gy]/g, '')
      const re = new RegExp(spec.regex, flags)
      // With capture groups, only group 1 counts: a match where group 1 did not take part is ''.
      const groups = new RegExp(`${re.source}|`, flags).exec('').length - 1
      const m = v.match(re)
      v = !m ? '' : groups ? m[1] ?? '' : m[0]
    }
    for (const [pattern, replacement] of spec.replace || []) v = v.replace(new RegExp(pattern, 'g'), replacement ?? '')
    v = v.trim()
    if (spec.number) v = toNumber(v)
    if (v === '' && spec.default !== undefined) v = String(spec.default)
    return v
  }

  /** Visible text; `exclude` drops descendants' text; with `split` the line breaks are kept. */
  function readText(el, spec) {
    let t = renderedText(el) || el.textContent || ''
    if (spec.exclude) {
      const excluded = qsa(spec.exclude, el)
      let missed = false
      for (const x of excluded) {
        const xt = (renderedText(x) || x.textContent || '').trim()
        if (!xt) continue
        if (t.includes(xt)) t = t.replace(xt, '')
        else missed = true
      }
      if (missed) {
        // Layout text didn't contain the child's text verbatim: fall back to a detached copy.
        const copy = el.cloneNode(true)
        for (const x of copy.querySelectorAll(spec.exclude)) x.remove()
        for (const br of copy.querySelectorAll('br')) br.replaceWith('\n')
        t = copy.textContent || ''
      }
    }
    if (spec.split !== undefined) return t.split('\n').map(line => line.replace(/\s+/g, ' ').trim()).filter(Boolean).join('\n')
    return clean(t)
  }

  function readOne(el, spec) {
    const attr = spec.attr || 'text'
    if (attr === 'text') return readText(el, spec)
    if (attr === 'html') return el.innerHTML.trim()
    if (attr === 'href') {
      const a = closestDeep(el, 'a[href]') || qs('a[href]', el)
      return a ? a.href : el.getAttribute('href') || ''
    }
    if (attr === 'src') return imageSrc(el)
    return clean(el.getAttribute(attr) || '')
  }

  /** The elements a field reads in one row: `base` is the row (or its n-th next sibling), `els` what `css` picks. */
  function fieldElements(row, spec) {
    if (typeof spec === 'string') spec = { css: spec }
    let base = row
    // Records split over sibling elements (dt/dd, two-row table records): read from the n-th next sibling.
    for (let i = 0; i < (spec.sibling || 0) && base; i += 1) base = base.nextElementSibling
    let els = []
    if (base) {
      const css = spec.css
      if (!css || css === '.' || css === ':scope') {
        els = [base]
      } else {
        const all = qsa(css, base)
        if (spec.all) {
          els = all
        } else {
          let i = spec.index || 0
          if (i < 0) i += all.length
          els = all[i] ? [all[i]] : []
        }
      }
    }
    return { base, els }
  }

  function readField(row, spec) {
    if (typeof spec === 'string') spec = { css: spec }
    const { base, els } = fieldElements(row, spec)
    // true / false, then replace / default like any value ("true" → "reply").
    if (spec.matches) {
      // Does the row itself match (selectors may include ancestors: ".replies .comment")?
      let hit
      try {
        hit = Boolean(base && deepMatches(base, spec.matches))
      } catch {
        return ''
      }
      return postProcess(hit ? 'true' : 'false', spec)
    }
    if (spec.exists) return postProcess(els.length ? 'true' : 'false', spec)
    const values = els.map(e => readOne(e, spec)).filter(v => v !== '')
    const raw = spec.all ? values.join(spec.join ?? ' | ') : values[0] ?? ''
    return postProcess(raw, spec)
  }

  function extract(rowsSel, fields) {
    return qsa(rowsSel).map(row => {
      const rec = {}
      for (const [key, spec] of Object.entries(fields)) rec[key] = readField(row, spec)
      return rec
    })
  }

  // Which element each row came from, so a row read again after an expand click (same element, more
  // text) updates the row it already is, while rows a click put in (new elements) are new rows.
  const rowIds = new WeakMap()
  let nextRowId = 1
  function extractTagged(rowsSel, fields) {
    return qsa(rowsSel).map(row => {
      let id = rowIds.get(row)
      if (!id) {
        // With the document's id: the collector keeps them across page loads, where counting starts again.
        id = `${DOC_ID}:${nextRowId++}`
        rowIds.set(row, id)
      }
      const rec = {}
      for (const [key, spec] of Object.entries(fields)) rec[key] = readField(row, spec)
      return { id, rec }
    })
  }

  /** Changes when content is added or removed, inside shadow roots too (sizes only: a ticking clock keeps it). */
  function contentMark(rowsSel) {
    const body = document.body
    if (!shadowState()) return `${document.getElementsByTagName('*').length}:${body ? body.textContent.length : 0}:${countAll(rowsSel)}`
    return `${countAll('*')}:${bodyText().length}:${countAll(rowsSel)}`
  }

  function signature(rowsSel) {
    const rows = qsa(rowsSel)
    return `${location.href}|${rows.length}|${rows[0] ? clip(textOf(rows[0]), 60) : ''}|${rows.length ? clip(textOf(rows[rows.length - 1]), 60) : ''}`
  }

  function markFirstClickable(css) {
    qsa('[data-dlk-target]').forEach(e => e.removeAttribute('data-dlk-target'))
    const { els, why } = matchInfo(css)
    if (!els.length) return { found: 0, why }
    // Several matches (a carousel, cards that each have the button, the page under a dialog): the one on screen.
    const candidates = els.filter(e => isVisible(e) && !isDisabled(e))
    const usable = candidates.find(onScreen) || candidates[0]
    if (!usable) return { found: els.length, usable: false, why: `${els.length} element${els.length > 1 ? 's match' : ' matches'}, none visible and enabled` }
    usable.setAttribute('data-dlk-target', '1')
    return { found: els.length, usable: true, text: clip(textOf(usable), 30) }
  }

  // Scrolling the way a person does. Jumping straight to the bottom of the document is not that: a list that
  // loads more when its end comes into view (a sentinel after the last row) never sees its end on screen when
  // the page is taller than the list (a long sidebar, a footer), and once at the bottom there is nowhere to go.
  // So: move in stretches shorter than the view, first to the end of the rows, then on to the bottom.
  /** One frame and a little more: observers and scroll handlers run before the next move. */
  const nextFrame = () =>
    new Promise(resolve => {
      let done = false
      const end = () => {
        if (!done) {
          done = true
          resolve()
        }
      }
      requestAnimationFrame(() => setTimeout(end, 40))
      setTimeout(end, 250) // a tab that is not drawn has no frames
    })
  /** `whole`: cover the whole way in steps (where the list ends is not known), not just the last three views.
   *  `stopIf`: checked after every move; true ends the glide there. → whether it was stopped. */
  async function glide(el, isWindow, to, whole = false, stopIf = null) {
    const view = el.clientHeight || innerHeight
    // 'instant': a page styled with scroll-behavior: smooth would otherwise still be where it was when read back.
    const go = top => (isWindow ? window.scrollTo({ top, behavior: 'instant' }) : el.scrollTo({ top, behavior: 'instant' }))
    let pos = el.scrollTop
    // Far away: skip ahead, then cover the last three views in steps.
    if (!whole && Math.abs(to - pos) > view * 3) {
      pos = to - Math.sign(to - pos) * view * 3
      go(pos)
      await nextFrame()
    }
    // At most 60 moves; each stays shorter than the view until the way is longer than 60 views.
    const stride = Math.max(view * 0.8, Math.abs(to - pos) / 60)
    for (let i = 0; i < 60 && Math.abs(to - pos) > 1; i += 1) {
      pos += Math.sign(to - pos) * Math.min(stride, Math.abs(to - pos))
      go(pos)
      await nextFrame()
      if (stopIf && stopIf()) return true
    }
    return false
  }
  /** What can scroll the rows: the nearest scrollable box around them first, the ones further out, the window last. */
  function scrollersOf(rowsSel) {
    let first = null
    try {
      first = rowsSel ? qs(rowsSel) : null
    } catch {
      first = null
    }
    const out = []
    for (let el = first && flatParent(first); el && el !== document.body && el !== document.documentElement; el = flatParent(el)) {
      if (/(auto|scroll|overlay)/.test(getComputedStyle(el).overflowY) && el.scrollHeight > el.clientHeight + 20) out.push(el)
    }
    if (document.scrollingElement) out.push(document.scrollingElement)
    return out
  }

  // ---------- advancing a list by its own rows ----------
  // Ported from the extension's collector (copilot-services/src/execution/scroll-animation.ts), where it has
  // run on real sites for a long time. Instead of working out what scrolls and how far, it scrolls a row into
  // view: the last row on screen goes to the top. That moves on by about one view and keeps that row as
  // overlap, so no row is skipped (virtual lists included); the browser finds the scroller itself (window, a box
  // inside the page, nested ones, across shadow roots); and at the last row, what follows the list — a
  // "load more" sentinel — comes into view.
  /** The element that carries a row's box: the row, or for a `display: contents` wrapper the first descendant with one. */
  function layoutBox(el) {
    const rect = el.getBoundingClientRect()
    if (rect.width > 0 || rect.height > 0) return el
    if (getComputedStyle(el).display !== 'contents') return null
    for (const child of [...(el.shadowRoot ? el.shadowRoot.children : []), ...el.children]) {
      const box = layoutBox(child)
      if (box) return box
    }
    return null
  }
  /** sticky / fixed rows stay on screen while the list moves under them: they say nothing about how far it has moved. */
  const pinned = el => /^(sticky|fixed)$/.test(getComputedStyle(el).position)
  /** The part of the window a row can show in: the window, cut down to the scrollable boxes around the row. */
  function visibleBand(row) {
    let top = 0
    let bottom = innerHeight
    for (let el = flatParent(row); el && el !== document.body && el !== document.documentElement; el = flatParent(el)) {
      if (!/(auto|scroll|overlay|hidden|clip)/.test(getComputedStyle(el).overflowY)) continue
      const rect = el.getBoundingClientRect()
      top = Math.max(top, rect.top)
      bottom = Math.min(bottom, rect.bottom)
    }
    return { top, bottom }
  }
  /** rows selector → the row the last advance put at the top. */
  const lastAnchors = new Map()
  /** One move: → { didMove, reachedBottom, anchor }. */
  function advanceByRow(rows, previous) {
    const items = rows.filter(row => !pinned(row))
    const boxOf = item => layoutBox(item) || item
    if (!items.length) return { didMove: false, reachedBottom: true, anchor: null }
    const toTop = box => {
      const before = box.getBoundingClientRect().top
      // 'instant': on a page styled with scroll-behavior: smooth the row would still be where it was when read back.
      box.scrollIntoView({ block: 'start', behavior: 'instant' })
      return Math.abs(before - box.getBoundingClientRect().top) >= 1
    }
    // Start after the row the last move anchored on, so every move goes forward.
    const at = previous ? items.indexOf(previous) : -1
    const from = at >= 0 ? at + 1 : 0
    const band = visibleBand(items[Math.min(from, items.length - 1)])
    let lastInView = -1
    let lastWhole = -1
    let whole = 0
    for (let i = from; i < items.length; i += 1) {
      const rect = boxOf(items[i]).getBoundingClientRect()
      if (rect.bottom > band.top && rect.top < band.bottom) {
        lastInView = i
        if (rect.top >= band.top && rect.bottom <= band.bottom) {
          lastWhole = i
          whole += 1
        }
      } else if (lastInView >= 0) break
    }
    if (lastInView === -1) {
      // Nothing on screen after the last anchor: it was the last row, or the next rows are further on.
      if (from >= items.length) return { didMove: false, reachedBottom: true, anchor: previous }
      let next = from
      while (next < items.length && !layoutBox(items[next])) next += 1
      if (next >= items.length) return { didMove: false, reachedBottom: true, anchor: previous }
      // A row with a box that does not come into view: the page itself cannot scroll (a dialog holds it).
      if (!toTop(boxOf(items[next]))) return { didMove: false, reachedBottom: false, anchor: previous }
      return { didMove: true, reachedBottom: false, anchor: items[next] }
    }
    // The last row wholly on screen is the last one of this screen; one cut off at the edge belongs to the next.
    const index = whole > 1 && lastWhole !== -1 ? lastWhole : lastInView
    const didMove = toTop(boxOf(items[index]))
    return { didMove, reachedBottom: index === items.length - 1, anchor: items[index] }
  }
  /** Lists that drop the rows above the view (virtual lists): one move per round there, each one read. */
  const virtualLists = new Set()
  function recycleWatch(rows) {
    const seen = rows.slice(0, 20).map(el => ({ el, text: (el.textContent || '').slice(0, 80) }))
    return () => seen.some(row => !row.el.isConnected || (row.el.textContent || '').slice(0, 80) !== row.text)
  }
  /**
   * One round of scrolling for more rows. Default: move on row by row (see above) until the last row is at
   * the top, rows arrive, or rows above are dropped (a virtual list: read before going on); a round that
   * starts at the last row also goes to the bottom of whatever scrolls (lists that load at the page's end).
   * `scrollerSel` + `step`: scroll that element exactly that far. Without rows: the window, all the way down.
   */
  async function scrollStep(scrollerSel, step, rowsSel) {
    if (scrollerSel || step) {
      const el = scrollerSel ? qs(scrollerSel) : document.scrollingElement
      if (!el) return { error: `scroller not found: ${scrollerSel}` }
      const isWindow = el === document.scrollingElement
      const before = el.scrollTop
      if (step) {
        if (isWindow) window.scrollTo({ top: before + step, behavior: 'instant' })
        else el.scrollTo({ top: before + step, behavior: 'instant' })
      } else {
        await glide(el, isWindow, el.scrollHeight - el.clientHeight, true)
      }
      const after = el.scrollTop
      return { before: Math.round(before), after: Math.round(after), moved: after !== before, atBottom: after + el.clientHeight >= el.scrollHeight - 4 }
    }
    let rows = []
    try {
      rows = rowsSel ? qsa(rowsSel) : []
    } catch {
      rows = []
    }
    const doc = document.scrollingElement
    const before = doc ? doc.scrollTop : 0
    if (!rows.length) {
      // No rows to go by (looking at a page): the window, passing over everything on the way down.
      if (doc) await glide(doc, true, doc.scrollHeight - doc.clientHeight, true)
      const after = doc ? doc.scrollTop : 0
      return { before: Math.round(before), after: Math.round(after), moved: after !== before, atBottom: !doc || after + doc.clientHeight >= doc.scrollHeight - 4 }
    }
    const previous = lastAnchors.get(rowsSel)
    const startedAtEnd = Boolean(previous) && previous === rows.filter(row => !pinned(row)).at(-1)
    const recycled = recycleWatch(rows)
    const count = rows.length
    let moved = false
    let atBottom = false
    let anchor = previous && previous.isConnected ? previous : null
    for (let i = 0; i < 25; i += 1) {
      const result = advanceByRow(qsa(rowsSel), anchor)
      anchor = result.anchor
      moved = moved || result.didMove
      await nextFrame()
      if (result.reachedBottom) {
        atBottom = true
        break
      }
      if (!result.didMove) break
      if (virtualLists.has(rowsSel) || recycled()) {
        virtualLists.add(rowsSel)
        break
      }
      if (qsa(rowsSel).length !== count) break
    }
    lastAnchors.set(rowsSel, anchor)
    // Already at the last row when this round began and still there: some lists load when the page (or their
    // box) is scrolled to its very end, not when their last row shows.
    if (atBottom && startedAtEnd) {
      for (const el of scrollersOf(rowsSel)) {
        const top = el.scrollTop
        await glide(el, el === doc, el.scrollHeight - el.clientHeight)
        moved = moved || el.scrollTop !== top
      }
    }
    const after = doc ? doc.scrollTop : 0
    return { before: Math.round(before), after: Math.round(after), moved, atBottom, ...(virtualLists.has(rowsSel) ? { virtual: true } : {}) }
  }

  function dismiss(selectors, auto, protect) {
    let clicked = 0
    for (const css of selectors || []) {
      try {
        for (const el of qsa(css)) {
          if (isVisible(el)) {
            clickLikeUser(el)
            clicked += 1
          }
        }
      } catch {
        // bad selector: ignore here, inspect reports it
      }
    }
    if (auto) {
      for (const o of overlays()) {
        const overlay = qs(o.selector)
        // Never close the overlay that holds the list being collected (reviews in a dialog, etc.).
        if (protect && overlay) {
          try {
            if (qs(protect, overlay)) continue
          } catch {
            // invalid protect selector: fall through and treat as unprotected
          }
        }
        const closer = o.closers[0] && qs(o.closers[0])
        if (closer) {
          clickLikeUser(closer)
          clicked += 1
        }
      }
    }
    return clicked
  }

  /** Click every visible match (e.g. per-item "show replies" / "read more"), at most `limit` clicks.
   *  Selectors are CSS, `text=…` or CSS with one `:has-text("…")`. */
  // An expander is clicked again only when it still reads the same and what its last click asked for has
  // arrived (what surrounds it changed): a per-record "next page" or "show more" the page kept as the same
  // element. One whose request is still on its way is left alone — a second click then would skip a page —
  // and a toggle whose text changed ("展开" → "收起") is never clicked back.
  /** Expanders on screen that can't be clicked yet: disabled or busy while what they asked for loads, or
   *  clicked in the last few seconds with nothing around them changed so far (the request is on its way). */
  function expandBusy(selectors, rowsSel) {
    let busy = 0
    const holders = rowHolders(rowsSel)
    for (const sel of selectors || []) {
      for (const el of matchAll(sel)) {
        if (!isVisible(el)) continue
        const clicked = clickCtx.get(el)
        const waiting = clicked && Date.now() - clicked.at < CLICK_PENDING_MS && clickDidNothing(el, holders)
        if (isDisabled(el) || el.getAttribute('aria-busy') === 'true' || waiting) busy += 1
      }
    }
    return busy
  }

  // Whether an expand click did anything is read off the record the control belongs to, not off the page: the
  // rest of the page keeps changing (the next batch of a list arriving, another record's replies opening).
  // That record is the nearest element around the control that holds a row — the row itself, the box of one
  // comment's replies, one card — however shallow or deep the control sits in it.
  /** el → { mark, at, pass }: what its record showed right before its last expand click, when, and in which pass. */
  const clickCtx = new WeakMap()
  /** How long a click with no effect yet counts as a request on its way. */
  const CLICK_PENDING_MS = 10_000
  let clickPass = 0
  /** selector → elements clicked in the last pass. */
  let passClicks = new Map()
  /** The rows and everything above them: an element in here holds a row. */
  function rowHolders(rowsSel) {
    const holders = new Set()
    for (const row of qsa(rowsSel)) for (let n = row; n && !holders.has(n); n = composedParent(n)) holders.add(n)
    return holders
  }
  function localMark(el, holders) {
    let box = el
    while (!holders.has(box)) {
      const parent = composedParent(box)
      if (!parent) break
      box = parent
    }
    const text = renderedText(box) || box.textContent || ''
    let hash = 5381
    for (let i = 0; i < text.length; i += 1) hash = ((hash << 5) + hash + text.charCodeAt(i)) | 0
    // The control's own state too: a toggle may only flip a class or aria-expanded.
    return `${typeof el.className === 'string' ? el.className : ''}[${el.getAttribute('aria-expanded') ?? ''}]|${qsa('*', box).length}:${hash}`
  }
  const expandLabel = el => clip(textOf(el), 40) || '·'
  /** Clicked by expand, still on the page reading the same, and its record shows what it showed: the click did nothing (yet). */
  const clickDidNothing = (el, holders) => el.dataset.dlkExpanded === expandLabel(el) && clickCtx.get(el)?.mark === localMark(el, holders)
  /** Clicked by expand, still reading the same, and its record changed since: what the click asked for arrived. */
  const clickLanded = (el, holders) => {
    const clicked = clickCtx.get(el)
    return el.dataset.dlkExpanded === expandLabel(el) && Boolean(clicked) && clicked.mark !== localMark(el, holders)
  }

  // `inner`: after a pass of clicks. Where none of a selector's clicks did anything, an element that is not a
  // control itself but wraps exactly one (a "12 replies, view" line whose button is the part that listens) is
  // clicked on that control. Where some did, the others are slow, not misplaced: they are left alone.
  /** `within`: only controls inside the first match of this CSS are clicked (a detail page's record). */
  function clickAll(selectors, rowsSel, limit = 60, inner = false, within = null) {
    let clicked = 0
    const box = within ? qs(within) : null
    if (within && !box) return 0
    const holders = rowHolders(rowsSel)
    if (!inner) {
      clickPass += 1
      passClicks = new Map()
    }
    for (const sel of selectors || []) {
      const els = matchAll(sel).filter(el => isVisible(el) && !isDisabled(el) && (!box || containsDeep(box, el)))
      if (inner) {
        const stale = els.filter(el => clickCtx.get(el)?.pass === clickPass && clickDidNothing(el, holders))
        if (!stale.length || stale.length < (passClicks.get(sel) || 0)) continue
        for (const el of stale) {
          if (clicked >= limit) return clicked
          if (el.dataset.dlkInner === el.dataset.dlkExpanded) continue
          const control = soleControl(el)
          if (!control) continue
          el.dataset.dlkInner = el.dataset.dlkExpanded
          clickLikeUser(control)
          clicked += 1
        }
        continue
      }
      let count = 0
      for (const el of els) {
        if (clicked >= limit) break
        if (el.dataset.dlkExpanded && !clickLanded(el, holders)) continue
        el.dataset.dlkExpanded = expandLabel(el)
        clickCtx.set(el, { mark: localMark(el, holders), at: Date.now(), pass: clickPass })
        noteExpandClick(sel, el.dataset.dlkExpanded)
        clickLikeUser(el)
        clicked += 1
        count += 1
      }
      passClicks.set(sel, count)
    }
    return clicked
  }

  /** selector → label shape → { label, clicks }: what expand clicked since the last takeExpandClicks(). */
  let expandClicks = new Map()
  /** A label's shape: its numbers left out, so "12 replies" and "3 replies" are one kind of control. */
  const labelShape = label => label.replace(/\d[\d,.]*/g, '#')
  function noteExpandClick(sel, label) {
    let shapes = expandClicks.get(sel)
    if (!shapes) expandClicks.set(sel, (shapes = new Map()))
    const shape = labelShape(label)
    const seen = shapes.get(shape)
    if (seen) seen.clicks += 1
    else shapes.set(shape, { label, clicks: 1 })
  }
  /** The expand clicks noted since the last call, per selector and label shape; clears them. */
  function takeExpandClicks() {
    const taken = [...expandClicks].map(([selector, shapes]) => ({
      selector,
      labels: [...shapes].map(([shape, { label, clicks }]) => ({ shape, label, clicks })),
    }))
    expandClicks = new Map()
    return taken
  }

  const CONTROL = 'button, [role=button], summary, a, input[type=button], input[type=submit]'
  /** The one control inside an element that is not a control itself; null when there is none or several, or it is a link that leaves the page. */
  function soleControl(el) {
    if (el.matches(CONTROL)) return null
    const found = qsa(CONTROL, el).filter(c => isVisible(c) && !isDisabled(c))
    const outer = found.filter(c => !found.some(other => other !== c && containsDeep(other, c)))
    if (outer.length !== 1) return null
    const link = outer[0].closest('a[href]')
    return link && !/^(#|javascript:|$)/i.test(link.getAttribute('href') || '') ? null : outer[0]
  }

  /** Elements the expand selectors clicked whose click did nothing: { count, sample: [{ text, selector }] }. */
  function expandLeft(selectors, rowsSel, limit = 2) {
    const sample = []
    let count = 0
    const holders = rowHolders(rowsSel)
    for (const sel of selectors || []) {
      for (const el of matchAll(sel)) {
        if (!el.dataset.dlkExpanded || !isVisible(el) || !clickDidNothing(el, holders)) continue
        count += 1
        if (sample.length < limit) sample.push({ text: clip(textOf(el), 40), selector: sel })
      }
    }
    return { count, sample }
  }

  const MORE_TEXT = /下一页|下页|下一頁|次へ|もっと|next|more|更多|展开|展開|查看|view|show|load|加载|載入/i
  const HIDE_TEXT = /收起|折叠|摺疊|hide|less|collapse|閉じる/i
  const PREV_TEXT = /上一页|上页|上一頁|前へ|前のページ|previous|\bprev\b/i
  /**
   * Controls sitting among the rows that say "more" / "next" and that nothing in `skip` (the expand and
   * next selectors) clicked or would click: a record's own pager that showed up once its replies were open,
   * a "read more" the config does not open. Links that leave the page are not counted.
   * → [{ text, count, selector, after }], at most `limit` kinds.
   */
  function unclickedAmongRows(rowsSel, skip, limit = 3, kind = 'more') {
    // 'prev': "previous" controls instead — a record whose own pager is past its first page.
    const wantedText = kind === 'prev' ? PREV_TEXT : MORE_TEXT
    const rows = new Set(qsa(rowsSel))
    if (rows.size < 2) return []
    const covered = new Set()
    for (const sel of skip || []) for (const el of matchAll(sel)) covered.add(el)
    const wanted = new Set()
    for (const el of qsa('button, [role=button], a, [onclick], summary')) {
      if (covered.has(el) || !isVisible(el) || isDisabled(el)) continue
      if (closestDeep(el, '[data-dlk-expanded]') || [...covered].some(c => containsDeep(c, el) || containsDeep(el, c))) continue
      const link = el.closest('a[href]')
      if (link && !/^(#|javascript:|$)/i.test(link.getAttribute('href') || '')) continue
      const label = clean(renderedText(el) || el.getAttribute('aria-label') || '')
      if (!label || label.length > 24 || !wantedText.test(label) || (kind !== 'prev' && HIDE_TEXT.test(label))) continue
      wanted.add(el)
    }
    if (!wanted.size) return []
    // One walk in rendered order: only what lies between the first and the last row is among the records.
    const marks = shadowMarks()
    const all = marks ? qsaTrees('*', document, marks) : [...document.querySelectorAll('*')]
    let first = -1
    let last = -1
    let row = null
    const at = new Map()
    all.forEach((el, i) => {
      if (rows.has(el)) {
        if (first < 0) first = i
        last = i
        row = el
      } else if (wanted.has(el)) at.set(el, { i, row })
    })
    const kinds = new Map()
    for (const [el, { i, row: before }] of at) {
      if (i < first || i > last) continue
      const text = clip(clean(renderedText(el) || el.getAttribute('aria-label') || ''), 24)
      const kind = kinds.get(text)
      if (kind) kind.count += 1
      // `after`: the row just before it, so the reader can tell whose control it is.
      else kinds.set(text, { text, count: 1, selector: cssPath(el), after: before ? clip(textOf(before), 40) : undefined })
    }
    const out = [...kinds.values()].sort((a, b) => b.count - a.count).slice(0, limit)
    // A path shared with other controls (page numbers, "hide") says which ones only with their text.
    for (const kind of out) if (countSafe(kind.selector) > kind.count) kind.selector = `${kind.selector}:has-text("${kind.text}")`
    return out
  }

  // ---------- block / login walls ----------
  // Generic signals only: challenge widgets, block wording, HTTP status, and how much content is left.
  const WALL_TEXT = [
    /\b(re|h)?captcha\b|turnstile|geetest|arkose|funcaptcha/i,
    /verify (that )?you('| a)re (a )?human|are you a robot|not a robot|human verification|checking (if the site connection is secure|your browser)|just a moment\.\.\.|attention required|enable javascript and cookies to continue|press (and|&) hold/i,
    /unusual traffic|automated (queries|requests|access)|access (is |has been )?denied|request (was |has been )?blocked|you('ve| have) been blocked|\bforbidden\b|too many requests|rate limit(ed)?|network security|security (check|verification)|blocked by/i,
    /人机验证|安全验证|滑动验证|拖动滑块|请完成验证|输入验证码|请求异常|访问异常|访问被拒绝|被.{0,8}拦截|安全策略|异常流量|访问过于频繁|操作过于频繁/,
  ]
  const LOGIN_TEXT = /(log|sign) ?in to (continue|view|see|read)|please (log|sign) ?in|login required|登录后(查看|继续|可见|才能)|请先登录|登录以(查看|继续)|需要登录/i
  const CHALLENGE_SEL =
    'iframe[src*=captcha i], iframe[src*=challenge i], iframe[src*=turnstile i], iframe[title*=captcha i], iframe[title*=challenge i], #challenge-form, #challenge-running, .cf-turnstile, [id*=captcha i], [class*=captcha i], [class*=geetest i]'

  /** Is this a block / bot check / login wall rather than the content? status = main document HTTP status. */
  function wall(status) {
    const text = clean(document.body ? renderedText(document.body) : '')
    const head = `${document.title} ${text.slice(0, 4000)}`
    const challenge = qsa(CHALLENGE_SEL).find(isVisible)
    const hit = WALL_TEXT.map(re => head.match(re)).find(Boolean)
    const login = head.match(LOGIN_TEXT)
    const small = text.length < 3000
    const evidence = []
    if (challenge) evidence.push(`challenge element ${cssPath(challenge)}`)
    if (hit) evidence.push(`text "${hit[0]}"`)
    if (status >= 400) evidence.push(`HTTP ${status}`)
    evidence.push(`${text.length} chars of text`)
    let kind = null
    if (challenge || (hit && small) || (status >= 400 && text.length < 500)) kind = 'blocked'
    else if (login && small) kind = 'login'
    if (kind === 'blocked' && login && !challenge && !hit) kind = 'login'
    if (login && kind) evidence.push(`text "${login[0]}"`)
    // What was seen apart from the status, for callers that weigh it against a page that read fine (detail pages).
    const signals = { challenge: Boolean(challenge), text: hit ? hit[0] : null, login: login ? login[0] : null }
    return { kind, evidence: evidence.join(', '), title: document.title, textHead: clip(text, 200), signals }
  }

  // ---------- totals the page claims ("评论 160", "共 250 条", "1–20 of 300 results") ----------
  const NUM = '(\\d[\\d,，.]*\\s*[万千kK]?)'
  const CLAIM_PATTERNS = [
    new RegExp(`(?:共|总共|全部|合计|总计|已加载)\\s*${NUM}\\s*(?:条|个|项|篇|件|部|家|位|首|款|人|则)`),
    new RegExp(`${NUM}\\s*(?:条评论|条回复|条结果|个结果|条数据|条记录|条讨论|条评价|个回答)`),
    new RegExp(`(?:评论|回复|评价|讨论|答案|结果)\\s*[（(]?\\s*${NUM}\\s*[)）]?(?![\\d万千])`),
    new RegExp(`${NUM}\\s+(?:results|reviews|comments|ratings|items|products|jobs|listings|answers|replies|videos|posts|courses|albums|songs|tracks|episodes|entries)\\b`, 'i'),
    new RegExp(`\\b(?:of|out of|about|over)\\s+(?:about\\s+)?${NUM}\\s*(?:results|items|products|entries|reviews|comments)?\\b`, 'i'),
  ]
  /** Count claims in the page text outside the rows (per-row "12 comments" are not totals). */
  function claims(rowsSel) {
    const inRow = node => {
      try {
        return !!(rowsSel && closestDeep(node, rowsSel))
      } catch {
        return false
      }
    }
    const hits = []
    const seen = new Set()
    for (const el of [document.body, ...qsa('*', document.body)]) {
      if (SKIP.has(el.tagName) || el.children.length > 3 || !isVisible(el) || inRow(el)) continue
      const text = clean(renderedText(el, 240))
      if (!text || text.length > 120) continue
      // "Page 1 of 10" / "共 12 页" count pages, not items.
      const pageWords = /\bpages?\b|第\s*\d+\s*页|\d+\s*页|ページ/i.test(text)
      for (const [kind, re] of CLAIM_PATTERNS.entries()) {
        if (pageWords && kind === CLAIM_PATTERNS.length - 1) continue
        const m = text.match(re)
        if (!m) continue
        const n = Number(toNumber(m[1]))
        const said = clean(m[0])
        if (!n || seen.has(`${n}|${said.replace(/\s/g, '')}`)) continue
        seen.add(`${n}|${said.replace(/\s/g, '')}`)
        hits.push({ kind, text: clip(said, 40), n })
        break
      }
    }
    // The same wording with 3+ different numbers is a per-item count ("65 comments" on every row), not a total.
    const perItem = new Set()
    for (const kind of new Set(hits.map(h => h.kind))) {
      if (new Set(hits.filter(h => h.kind === kind).map(h => h.n)).size >= 3) perItem.add(kind)
    }
    return hits.filter(h => !perItem.has(h.kind)).slice(0, 8).map(({ text, n }) => ({ text, n }))
  }

  /** Elements around the rows that can scroll (the list's real scroller is usually one of them). */
  function scrollCandidates(rowsSel, configured) {
    let first = null
    try {
      first = qs(rowsSel)
    } catch {
      first = null
    }
    if (!first) return []
    let current = null
    try {
      current = configured ? qs(configured) : null
    } catch {
      current = null
    }
    const out = []
    for (let el = flatParent(first); el && el !== document.body && el !== document.documentElement; el = flatParent(el)) {
      const style = getComputedStyle(el)
      if (!/(auto|scroll|overlay)/.test(style.overflowY) || el.scrollHeight <= el.clientHeight + 20) continue
      out.push({ selector: cssPath(el), clientHeight: el.clientHeight, scrollHeight: el.scrollHeight, scrollTop: Math.round(el.scrollTop), configured: el === current })
    }
    const doc = document.scrollingElement
    if (doc && doc.scrollHeight > doc.clientHeight + 20) out.push({ selector: '(window)', clientHeight: doc.clientHeight, scrollHeight: doc.scrollHeight, scrollTop: Math.round(doc.scrollTop), configured: !configured })
    return out.slice(0, 5)
  }

  /** Why a selector with ">" may match nothing on a page with shadow roots: the hint to add, or ''. */
  function childAcrossShadow(css) {
    if (!shadowState() || !css.includes('>')) return ''
    const loose = css.replace(/\s*>\s*/g, ' ')
    let n = 0
    try {
      n = qsa(loose).length
    } catch {
      return ''
    }
    return n ? ` — ">" does not cross a shadow root; with spaces instead ("${loose}") it matches ${n}` : ''
  }

  // ---------- setup actions for hosts without Playwright locators (the extension) ----------
  /** What `sel` matches — CSS, Playwright's `text=…`, one `:has-text("…")`, or a `ref=…` from a report — and,
   *  when nothing does, why (`why`), so a bad selector is not reported like an empty page. */
  function matchInfo(sel) {
    const ref = sel.match(/^ref=(\S+)$/)
    if (ref) {
      const el = refEls.get(ref[1])?.deref()
      if (el && el.isConnected) return { els: [el] }
      return { els: [], why: `ref ${ref[1]} is not on the page any more (it was reloaded, navigated or re-rendered since the report that named it): inspect again for fresh refs` }
    }
    let base = sel
    let text = null
    const plain = sel.match(/^text=(.+)$/)
    const has = sel.match(/^(.*?):has-text\((["'])(.*?)\2\)(.*)$/)
    if (plain) {
      base = 'a, button, [role=button], [role=tab], [role=option], [role=menuitem], label, summary, li, span, div'
      text = plain[1].replace(/^["']|["']$/g, '')
    } else if (has) {
      base = `${has[1] || '*'}${has[4] || ''}`
      text = has[3]
    }
    let els
    try {
      els = qsa(base)
    } catch (error) {
      const message = clip(String(error.message || error).replace(/^.*?: /, ''), 100)
      return { els: [], why: `not a selector the engine understands (${message}). Use CSS, text=…, one :has-text("…"), or a ref=… from a report` }
    }
    if (text === null) return { els, why: els.length ? undefined : `nothing matches ${sel}${childAcrossShadow(base)}` }
    const t = text.toLowerCase()
    let hits = els.filter(el => (renderedText(el) || el.textContent || '').toLowerCase().includes(t))
    // The element closest to the text, not every ancestor that also contains it.
    hits = hits.filter(el => !hits.some(other => other !== el && containsDeep(el, other)))
    if (hits.length) return { els: hits }
    if (!els.length) return { els: [], why: `nothing matches ${base}${childAcrossShadow(base)}` }
    const texts = els.slice(0, 3).map(e => `"${clip(textOf(e), 30)}"`).join(', ')
    return { els: [], why: `${base} matches ${els.length} element${els.length > 1 ? 's' : ''} but none contains "${text}" (${texts}${els.length > 3 ? ', …' : ''})` }
  }
  const matchAll = sel => matchInfo(sel).els

  /** The element a setup step means: on screen first, then rendered, then any match. */
  function locate(sel) {
    const els = matchAll(sel)
    return els.find(onScreen) || els.find(isVisible) || els[0] || null
  }

  /** Several matches and one is on screen: mark it [data-dlk-target] for the host to click (Playwright's first() is document order). */
  function markOnScreen(sel) {
    qsa('[data-dlk-target]').forEach(e => e.removeAttribute('data-dlk-target'))
    const els = matchAll(sel)
    const el = els.length > 1 ? els.find(onScreen) : null
    if (!el) return false
    el.setAttribute('data-dlk-target', '1')
    return true
  }

  function fire(el, type) {
    el.dispatchEvent(new Event(type, { bubbles: true }))
  }

  function press(key, target) {
    const el = target || document.activeElement || document.body
    if (key === 'Enter' && el.form) {
      if (el.form.requestSubmit) el.form.requestSubmit()
      else el.form.submit()
      return { ok: true }
    }
    for (const type of ['keydown', 'keypress', 'keyup']) el.dispatchEvent(new KeyboardEvent(type, { key, bubbles: true }))
    return { ok: true }
  }

  /** One setup action on the element `sel` finds: click, fill, select, press, hover, scroll, exists, href. */
  function act(sel, action, payload) {
    const el = locate(sel)
    if (!el) return { ok: false, error: `nothing matches ${sel}` }
    if (action === 'exists') return { ok: true }
    if (action === 'href') {
      const a = closestDeep(el, 'a[href]') || qs('a[href]', el)
      return { ok: true, value: a ? a.href : el.href || '' }
    }
    el.scrollIntoView({ block: 'center', behavior: 'instant' })
    if (action === 'scroll') return { ok: true }
    if (action === 'click') {
      clickLikeUser(el)
      return { ok: true }
    }
    if (action === 'hover') {
      for (const type of ['pointerover', 'mouseover', 'mouseenter', 'pointermove', 'mousemove']) el.dispatchEvent(new MouseEvent(type, { bubbles: true }))
      return { ok: true }
    }
    if (action === 'fill') {
      el.focus()
      const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype
      const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set
      // The prototype setter, so frameworks that track the value (React) see the change.
      if (setter && (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement)) setter.call(el, String(payload ?? ''))
      else if (el.isContentEditable) el.textContent = String(payload ?? '')
      else el.value = String(payload ?? '')
      fire(el, 'input')
      fire(el, 'change')
      return { ok: true }
    }
    if (action === 'select') {
      const options = [...(el.options || [])]
      const option = options.find(o => o.value === payload) || options.find(o => clean(o.text) === payload)
      if (!option) return { ok: false, error: `no option "${payload}" in ${sel}` }
      el.value = option.value
      fire(el, 'input')
      fire(el, 'change')
      return { ok: true }
    }
    if (action === 'press') return press(String(payload), el)
    return { ok: false, error: `unknown action ${action}` }
  }

  // ---------- links no field reads ----------
  /** Rows that link to other pages of their own (detail page, author, source) while no field reads a link.
   *  Null when a field already reads `href`, there are too few rows, or the links are the same in every row
   *  (share / report / "more" buttons). */
  function unreadLinks(rowsSel, fields) {
    const specs = Object.values(fields || {}).map(s => (typeof s === 'string' ? { css: s } : s || {}))
    if (specs.some(s => s.attr === 'href')) return null
    let rows
    try {
      rows = qsa(rowsSel).slice(0, 30)
    } catch {
      return null
    }
    if (rows.length < 3) return null
    const here = location.href.split('#')[0]
    const perRow = rows.map(row => {
      const hrefs = new Set()
      // The row element itself may be the link (a whole card wrapped in <a>).
      for (const a of [...(row.matches('a[href]') ? [row] : []), ...qsa('a[href]', row)]) {
        const href = a.href
        if (/^https?:/i.test(href) && href.split('#')[0] !== here) hrefs.add(href)
      }
      return hrefs
    })
    const withLinks = perRow.filter(set => set.size).length
    if (withLinks < rows.length / 2) return null
    const seenIn = new Map()
    for (const set of perRow) for (const href of set) seenIn.set(href, (seenIn.get(href) || 0) + 1)
    const own = [...seenIn.entries()].filter(([, n]) => n <= Math.max(1, rows.length / 3)).map(([href]) => href)
    if (own.length < withLinks / 2) return null
    return { rows: rows.length, withLinks, example: own[0] }
  }

  // ---------- what the rows show that no field reads ----------
  const BUTTON_LIKE = 'button, [role=button], summary'
  const NEVER_DATA = 'input, select, textarea, svg'
  /** A number as a control shows it: a like or reply count ("37", "1.2万", "3k+"). */
  const COUNTER = /^\d[\d.,]*\s*(万|亿|千|k|m|w)?\+?$/i
  /** Where a part sits, short enough to read and usable as a field selector inside the row. */
  function partPath(el) {
    const piece = n =>
      n.id
        ? `#${CSS.escape(n.id)}`
        : n.classList.length
          ? `${n.tagName.toLowerCase()}.${[...n.classList].slice(0, 2).map(c => CSS.escape(c)).join('.')}`
          : n.tagName.toLowerCase()
    if (el.id) return piece(el)
    const parent = composedParent(el)
    return parent && parent !== document.body ? `${piece(parent)} ${piece(el)}` : piece(el)
  }
  /** Texts and images the first rows show that no field reads, by where they sit: what a column set left out.
   *  Not counted: controls (buttons), another row nested in the row, and what is the same in every row
   *  (labels, icons). → { of, parts: [{ kind: 'text' | 'image', selector, sample, rows }] } or null. */
  function unreadParts(rowsSel, fields, limit = 6) {
    let all
    try {
      all = qsa(rowsSel)
    } catch {
      return null
    }
    if (all.length < 3) return null
    const rowSet = new Set(all)
    const rows = all.slice(0, 12)
    const specs = Object.values(fields || {})
      .map(spec => (typeof spec === 'string' ? { css: spec } : spec || {}))
      .filter(spec => !spec.matches)
    const groups = new Map()
    rows.forEach((row, index) => {
      const read = []
      for (const spec of specs) {
        try {
          read.push(...fieldElements(row, spec).els)
        } catch {
          // a selector the engine cannot parse reads nothing
        }
      }
      const isRead = el => read.some(r => r === el || containsDeep(r, el))
      const add = (kind, el, sample) => {
        const selector = partPath(el)
        const key = `${kind}|${selector}`
        const group = groups.get(key) || { kind, selector, sample, rows: new Set(), values: new Set() }
        group.rows.add(index)
        group.values.add(sample)
        groups.set(key, group)
      }
      // `inControl`: inside a button, where a word is the button's label and only a number is data.
      const visit = (node, inControl = false) => {
        if (node.nodeType === 3) {
          const text = node.data.replace(/\s+/g, ' ').trim()
          const holder = node.parentElement || hostOf(node.parentNode)
          if (!text || !holder || isRead(holder)) return
          // A custom element named like a button holds its label as its own text.
          const control = inControl || /button|btn/i.test(holder.tagName)
          if (control ? !COUNTER.test(text) : text.length < 2) return
          return add('text', holder, clip(text, 30))
        }
        if (node.nodeType !== 1 || TEXTLESS.has(node.tagName)) return
        if (node !== row && rowSet.has(node)) return
        if (node.matches(NEVER_DATA)) return
        if (node.matches(BUTTON_LIKE)) inControl = true
        const style = getComputedStyle(node)
        if (style.display === 'none' || style.visibility === 'hidden') return
        if (node.tagName === 'IMG') {
          const box = node.getBoundingClientRect()
          const src = imageSrc(node)
          if (src && box.width >= 16 && box.height >= 16 && !isRead(node)) add('image', node, clip(src.split('?')[0].split('/').pop() || src, 40))
          return
        }
        const down = child => visit(child, inControl)
        if (node.shadowRoot) node.shadowRoot.childNodes.forEach(down)
        else if (node.tagName === 'SLOT') {
          const assigned = node.assignedNodes({ flatten: true })
          ;(assigned.length ? assigned : [...node.childNodes]).forEach(down)
        } else node.childNodes.forEach(down)
      }
      visit(row)
    })
    const parts = [...groups.values()]
      // In a few rows only: a one-off. The same in every row it is in: a label or an icon, not data.
      .filter(group => group.rows.size >= Math.max(2, rows.length / 4) && group.values.size > 1)
      .sort((a, b) => b.rows.size - a.rows.size)
      .slice(0, limit)
      .map(group => ({ kind: group.kind, selector: group.selector, sample: group.sample, rows: group.rows.size }))
    return parts.length ? { of: rows.length, parts } : null
  }

  // ---------- showing a person what a config reads (the extension's confirmation card) ----------
  const OUTLINE_ID = 'dlk-outline'
  const ACCENT = '#6366f1'
  let outlineRedraw = null

  function clearOutline() {
    document.getElementById(OUTLINE_ID)?.remove()
    if (!outlineRedraw) return
    removeEventListener('scroll', outlineRedraw, true)
    removeEventListener('resize', outlineRedraw)
    outlineRedraw = null
  }

  /** Outline what `spec` reads in every row; `spec` null outlines the rows, a `matches` field the rows that match.
   *  A fixed layer that ignores the pointer, redrawn on scroll. `label` tags the first box on screen. */
  function outline(rowsSel, spec, label) {
    clearOutline()
    let rows
    try {
      rows = qsa(rowsSel)
    } catch {
      return { rows: 0, marked: 0 }
    }
    const s = spec == null ? null : typeof spec === 'string' ? { css: spec } : spec
    const targets = []
    for (const row of rows) {
      if (!s) {
        targets.push(row)
        continue
      }
      if (s.matches) {
        const { base } = fieldElements(row, s)
        let hit = false
        try {
          hit = !!base && deepMatches(base, s.matches)
        } catch {
          hit = false
        }
        if (hit) targets.push(base)
        continue
      }
      try {
        targets.push(...fieldElements(row, s).els)
      } catch {
        // A selector the page rejects outlines nothing.
      }
    }
    drawOutline(targets, !s || !!s.matches, label)
    return { rows: rows.length, marked: targets.length }
  }

  /** Outline the controls the expand selectors find on the page now (solid, like a field); `label` tags the first. */
  function outlineControls(selectors, label) {
    clearOutline()
    const found = new Set()
    for (const sel of selectors || []) {
      try {
        for (const el of matchAll(sel)) if (isVisible(el)) found.add(el)
      } catch {
        // A selector the page rejects outlines nothing.
      }
    }
    drawOutline([...found], false, label)
    return { marked: found.size }
  }

  /** A fixed layer over `targets` that ignores the pointer, redrawn on scroll: dashed boxes for rows, filled for fields. */
  function drawOutline(targets, asRows, label) {
    const layer = document.createElement('div')
    layer.id = OUTLINE_ID
    layer.style.cssText = 'position:fixed;inset:0;pointer-events:none;z-index:2147483647;'
    const draw = () => {
      layer.replaceChildren()
      let tagged = false
      for (const el of targets.slice(0, 400)) {
        const r = el.getBoundingClientRect()
        if (!r.width || !r.height || r.bottom < 0 || r.top > innerHeight || r.right < 0 || r.left > innerWidth) continue
        const box = document.createElement('div')
        box.style.cssText =
          `position:fixed;left:${r.left - 2}px;top:${r.top - 2}px;width:${r.width + 4}px;height:${r.height + 4}px;box-sizing:border-box;border-radius:4px;` +
          (asRows ? `border:1.5px dashed ${ACCENT};` : `border:2px solid ${ACCENT};background:rgba(99,102,241,.12);`)
        layer.appendChild(box)
        if (label && !tagged) {
          tagged = true
          const tag = document.createElement('div')
          tag.textContent = label
          tag.style.cssText = `position:fixed;left:${Math.max(0, r.left - 2)}px;top:${Math.max(0, r.top - 20)}px;padding:0 6px;font:500 11px/17px -apple-system,BlinkMacSystemFont,"PingFang SC",sans-serif;color:#fff;background:${ACCENT};border-radius:3px;white-space:nowrap;`
          layer.appendChild(tag)
        }
      }
    }
    draw()
    document.documentElement.appendChild(layer)
    let frame = 0
    outlineRedraw = () => {
      if (frame) return
      frame = requestAnimationFrame(() => {
        frame = 0
        draw()
      })
    }
    addEventListener('scroll', outlineRedraw, true)
    addEventListener('resize', outlineRedraw)
  }

  /** Shortest CSS from `row` that finds `el`: its own tag and classes, then with classed ancestors, then the child
   *  path. One whose first match is `el` wins; otherwise the first that finds it, with its index. */
  function relativeCss(row, el) {
    if (el === row) return { css: '.' }
    const chain = []
    for (let n = el; n && n !== row; n = n.parentElement || hostOf(n.getRootNode())) chain.unshift(n)
    if (!chain.length) return null
    const segOf = n => {
      const tag = n.tagName.toLowerCase()
      const classes = [...n.classList].filter(c => c.length <= 40).slice(0, 3)
      return classes.length ? tag + classes.map(c => '.' + CSS.escape(c)).join('') : tag
    }
    const own = segOf(el)
    const qualified = []
    for (let i = chain.length - 2; i >= 0 && qualified.length < 3; i -= 1) {
      if (chain[i].classList.length) qualified.push(`${segOf(chain[i])} ${qualified[qualified.length - 1] ?? own}`)
    }
    // A bare tag ("span") matches too much on other pages: try it after the ones with a classed ancestor.
    const candidates = el.classList.length ? [own, ...qualified] : [...qualified, own]
    candidates.push(`:scope > ${chain.map(segOf).join(' > ')}`)
    let fallback = null
    for (const css of candidates) {
      let index = -1
      try {
        index = qsa(css, row).indexOf(el)
      } catch {
        index = -1
      }
      if (index === 0) return { css }
      if (index > 0 && !fallback) fallback = { css, index }
    }
    return fallback
  }

  /** A field for the element a person clicked: what it reads there and in the other rows. An image without text
   *  reads its `src`; a link whose text is empty or already a column reads its `href`; anything else its text. */
  function fieldFor(el, rowsSel, fields) {
    let rows
    try {
      rows = qsa(rowsSel)
    } catch {
      return { error: 'not-in-row' }
    }
    // The innermost row holding the element: replies are rows inside rows.
    const holding = rows.filter(row => containsDeep(row, el))
    const row = holding.find(r => !holding.some(other => other !== r && containsDeep(r, other)))
    if (!row) return { error: 'not-in-row' }
    const text = textOf(el)
    const img = el.tagName === 'IMG' ? el : text ? null : qs('img', el)
    const link = closestDeep(el, 'a[href]')
    const ownLink = (link && containsDeep(row, link) ? link : null) || (text ? null : qs('a[href]', el))
    const sameAsColumn = Object.values(fields || {}).some(spec => readField(row, spec) === text)
    let target = el
    let attr = 'text'
    if (img && !text) {
      target = img
      attr = 'src'
    } else if (ownLink && (!text || sameAsColumn)) {
      attr = 'href'
    }
    const found = relativeCss(row, target)
    if (!found) return { error: 'not-in-row' }
    const field = { css: found.css, ...(found.index ? { index: found.index } : {}), ...(attr !== 'text' ? { attr } : {}) }
    const filled = rows.filter(r => readField(r, field) !== '').length
    return { field, sample: readField(row, field), fill: Math.round((100 * filled) / rows.length) }
  }

  let picking = null

  /** End a pick in progress (resolves it with null). */
  function cancelPick() {
    if (picking) picking(null)
  }

  /** Let the person click one value inside a row. Resolves with `fieldFor`'s answer, or null on Escape / cancelPick.
   *  The page's own handlers don't see the click. */
  function pick(rowsSel, fields) {
    cancelPick()
    return new Promise(resolve => {
      const hover = document.createElement('div')
      hover.style.cssText = `position:fixed;display:none;pointer-events:none;z-index:2147483647;box-sizing:border-box;border:2px solid ${ACCENT};background:rgba(99,102,241,.12);border-radius:4px;`
      const cursor = document.createElement('style')
      cursor.textContent = '*{cursor:crosshair!important}'
      document.documentElement.append(hover, cursor)
      const targetOf = e => {
        const el = e.composedPath()[0]
        return el instanceof Element ? el : null
      }
      const swallow = e => {
        e.preventDefault()
        e.stopPropagation()
        e.stopImmediatePropagation()
      }
      const onMove = e => {
        const el = targetOf(e)
        if (!el) return
        const r = el.getBoundingClientRect()
        Object.assign(hover.style, { display: 'block', left: `${r.left - 2}px`, top: `${r.top - 2}px`, width: `${r.width + 4}px`, height: `${r.height + 4}px` })
      }
      const onClick = e => {
        swallow(e)
        const el = targetOf(e)
        done(el ? fieldFor(el, rowsSel, fields) : { error: 'not-in-row' })
      }
      const onKey = e => {
        if (e.key !== 'Escape') return
        swallow(e)
        done(null)
      }
      const blocked = ['pointerdown', 'mousedown', 'pointerup', 'mouseup', 'dblclick', 'auxclick', 'contextmenu']
      function done(value) {
        removeEventListener('mousemove', onMove, true)
        removeEventListener('click', onClick, true)
        removeEventListener('keydown', onKey, true)
        for (const type of blocked) removeEventListener(type, swallow, true)
        hover.remove()
        cursor.remove()
        picking = null
        resolve(value)
      }
      addEventListener('mousemove', onMove, true)
      addEventListener('click', onClick, true)
      addEventListener('keydown', onKey, true)
      for (const type of blocked) addEventListener(type, swallow, true)
      picking = done
    })
  }

  const bodyText = () => clean(document.body ? renderedText(document.body) : '')
  /**
   * A record's text on one line, cut to `max` characters (then it ends with "…"): the first match of `root`, else
   * the page's main. → { text, scope: 'root' | 'main' }, or null: the body alone is mostly header and navigation.
   */
  function recordText(root, max = 400) {
    let el = null
    try {
      el = root ? qs(root) : null
    } catch {
      el = null
    }
    const scope = el ? 'root' : 'main'
    el = el || document.querySelector('main, [role=main]')
    const text = el ? clip(clean(renderedText(el)), max) : ''
    return text ? { text, scope } : null
  }

  // ---------- evidence for a stop decision ----------
  // When the rules want to end a run, a host may ask an AI whether the list really ended. What it reads is the end
  // of the list and the controls that could bring more, written as an accessibility tree
  // (`- button "Next" [ref=e3]`) whatever engine collected; the e-refs stand for elements here, for stopRemedy.
  const STOP_TREE_MAX = 9000
  const STOP_SNIPPETS_MAX = 4000
  const STOP_LAST_ROWS = 2
  const STOP_HINT = /更多|没有了|没有更多|到底|已加载|加载中|全部|共\s*\d|第\s*\d+\s*页|\d+\s*页|下一页|登录|登錄|注册|验证|\b(more|no more|end of|loading|load more|next|page \d+|of \d+|results?|sign in|log in|verify|captcha)\b|次へ|もっと|ログイン/i
  /** Things that change the user's account, money or the search, or leave the list: never clicked to get more rows. */
  const STOP_UNSAFE_TEXT = /登录|登錄|注册|註冊|退出|删除|刪除|购买|購買|支付|付款|下单|订阅|訂閱|关注|關注|点赞|举报|檢舉|分享|收藏|下载|下載|发表|發表|发布|發佈|发送|關閉|关闭|投币|充电|打赏|拉黑|屏蔽|购物车|購物車|立即沟通|ログイン|購入|削除|フォロー|\b(log ?in|log ?out|sign ?(in|up|out)|delete|remove|buy|purchase|checkout|add to (cart|bag)|pay|order|un?subscribe|un?follow|(dis)?like|(up|down)?vote|report|share|download|post|send|close|block|mute|hide)\b/i
  /** Labels that act on a record when they are the whole label ("回复", "Reply"); inside a longer one ("查看更多回复")
   *  they are a way to more rows. */
  const STOP_UNSAFE_LABEL = /^(回复|回覆|评论|評論|取消|确认|確認|提交|申请|申請|领取|reply|comment|cancel|confirm|submit|apply|accept)$/i
  let stopRefs = new Map()
  /** Elements a remedy was done on; one whose remedy brought rows may be used again (a "show more" button). */
  const stopRemedied = new WeakSet()
  let lastRemedied = null
  function stopRole(el) {
    const role = el.getAttribute('role')
    if (role) return role
    if (el.tagName === 'A' && el.hasAttribute('href')) return 'link'
    if (el.tagName === 'BUTTON' || (el.tagName === 'INPUT' && /^(button|submit)$/i.test(el.type))) return 'button'
    if (/^H[1-6]$/.test(el.tagName)) return 'heading'
    if (el.tagName === 'NAV') return 'navigation'
    if (el.tagName === 'LI') return 'listitem'
    return el.matches(CLICKABLE) ? 'button' : 'generic'
  }
  /** Rows, the box around all of them and what follows; the pager-like controls on the page; the boxes that scroll
   *  the rows; and text that says how many there are or whether more come. */
  function stopEvidence(rowsSel) {
    stopRefs = new Map()
    let n = 0
    const refFor = el => {
      n += 1
      stopRefs.set(`e${n}`, new WeakRef(el))
      return `e${n}`
    }
    let rows = []
    try {
      rows = rowsSel ? qsa(rowsSel) : []
    } catch {
      rows = []
    }
    const rowSet = new Set(rows)
    const last = new Set(rows.slice(-STOP_LAST_ROWS))
    // Per ancestor: how many rows it holds, and whether one of the last rows is among them.
    const held = new Map()
    const holdsLast = new Set()
    let top = null
    for (const row of rows) {
      for (let el = flatParent(row); el && el !== document.documentElement; el = flatParent(el)) {
        held.set(el, (held.get(el) || 0) + 1)
        if (last.has(row)) holdsLast.add(el)
        if (held.get(el) === rows.length && !top) top = el
      }
    }
    // The box around all rows, two levels out: what follows the list (a "load more" button, "no more" text, a
    // spinner, the pager) sits next to it.
    let root = top || document.body
    for (let i = 0; i < 2 && root !== document.body && flatParent(root); i += 1) root = flatParent(root)

    const lines = []
    let size = 0
    let collapsed = 0
    const emitted = new Set()
    const write = line => {
      lines.push(line)
      size += line.length + 1
    }
    /** Rows passed over since the last line: one marker for all of them. */
    const flush = depth => {
      if (collapsed) write(`${'  '.repeat(depth)}- … ${collapsed} rows collapsed …`)
      collapsed = 0
    }
    const push = (depth, text) => {
      if (size > STOP_TREE_MAX) return
      flush(depth)
      write(`${'  '.repeat(depth)}- ${text}`)
    }
    const quote = s => clip(clean(s), 80).replace(/"/g, "'")
    const nameOf = el => quote(el.getAttribute('aria-label') || renderedText(el, 400) || el.getAttribute('title') || el.value || '')
    const walk = (el, depth) => {
      if (size > STOP_TREE_MAX) return
      if (rowSet.has(el)) {
        if (last.has(el)) {
          emitted.add(el)
          push(depth, `listitem "${quote(textOf(el))}" [ref=${refFor(el)}]`)
        } else collapsed += 1
        return
      }
      if (held.has(el) && !holdsLast.has(el)) {
        collapsed += held.get(el)
        return
      }
      const role = stopRole(el)
      if (role === 'button' || role === 'link' || role === 'tab' || role === 'menuitem') {
        emitted.add(el)
        const href = el.getAttribute('href')
        push(depth, `${role} "${nameOf(el)}"${href && !/^(#|javascript:)/i.test(href) ? ` (href="${clip(href, 60)}")` : ''}${isDisabled(el) ? ' (disabled)' : ''} [ref=${refFor(el)}]`)
        return
      }
      const kids = viewChildren(el)
      const own = clean(kids.filter(k => k.nodeType === 3).map(k => k.data).join(' '))
      let childDepth = depth
      if (own) push(depth, `text: "${quote(own)}"`)
      else if (role !== 'generic') {
        push(depth, role)
        childDepth = depth + 1
      }
      for (const kid of kids) if (kid.nodeType === 1) walk(kid, childDepth)
    }
    walk(root, 0)
    flush(0)
    // Pager-like controls elsewhere on the page (a pager outside the box, a "show more" under the fold).
    const others = controls(15).controls
      .map(c => refEls.get(c.ref)?.deref())
      .filter(el => el && !emitted.has(el) && isVisible(el) && !(root !== document.body && containsDeep(root, el)))
    if (others.length) {
      push(0, 'navigation "页面上其他翻页 / 加载类控件"')
      for (const el of others) push(1, `${stopRole(el) === 'link' ? 'link' : 'button'} "${nameOf(el)}"${isDisabled(el) ? ' (disabled)' : ''} [ref=${refFor(el)}]`)
    }
    const boxes = scrollersOf(rowsSel).filter(el => el !== document.scrollingElement)
    for (const box of boxes) push(0, `generic "列表所在的可滚动区域 (${Math.round(box.scrollTop)}/${box.scrollHeight - box.clientHeight}px)" [ref=${refFor(box)}]`)

    const snippets = []
    const se = document.scrollingElement
    if (se) snippets.push(`窗口滚动位置 ${Math.round(se.scrollTop)} / ${Math.max(0, se.scrollHeight - se.clientHeight)}px`)
    const counted = claims(rowsSel)
    if (counted.length) snippets.push(`页面上的总数：${counted.map(c => c.text).join(' | ')}`)
    // Text that says how many there are or whether more come: around the list first, then the rest of the page
    // (a header's "首页" or a nav "More" must not crowd out the line under the list).
    const near = clean(renderedText(root))
    const text = clean(document.body ? renderedText(document.body) : '')
    const seen = new Set()
    const take = source => {
      for (const m of source.matchAll(new RegExp(STOP_HINT.source, 'gi'))) {
        if (snippets.join('\n').length > STOP_SNIPPETS_MAX - 400) return
        const around = source.slice(Math.max(0, m.index - 30), m.index + m[0].length + 30).trim()
        if (seen.has(around)) continue
        seen.add(around)
        snippets.push(around)
      }
    }
    take(near)
    take(text)
    snippets.push(`列表区末尾的文字：${near.slice(-300)}`)
    return { tree: lines.join('\n'), snippets: clip(snippets.join('\n'), STOP_SNIPPETS_MAX - 1), listRootFound: rows.length > 0, rows: rows.length }
  }
  /** Do what the stop judge proposed on an element of the last stopEvidence: click it (a control that is safe and
   *  stays on this site, in this tab), or scroll to it / within it. Once per element, unless the last time brought
   *  rows (stopRemedyBrought). */
  function stopRemedy(ref, action) {
    const el = stopRefs.get(ref)?.deref()
    if (!el || !el.isConnected) return { done: false, why: 'element gone' }
    if (stopRemedied.has(el)) return { done: false, why: 'already tried without new rows' }
    lastRemedied = el
    if (action === 'scrollWithin') {
      stopRemedied.add(el)
      const before = el.scrollTop
      el.scrollTop = el.scrollHeight
      return el.scrollTop !== before ? { done: true } : { done: false, why: 'did not scroll' }
    }
    if (action === 'scrollTo') {
      stopRemedied.add(el)
      el.scrollIntoView({ block: 'end', behavior: 'instant' })
      return { done: true }
    }
    if (action !== 'click') return { done: false, why: `unknown action ${action}` }
    const target = el.matches(CLICKABLE) ? el : soleControl(el)
    if (!target || !isVisible(target) || isDisabled(target)) return { done: false, why: 'not a usable control' }
    const label = clean(`${renderedText(target, 200) || ''} ${target.getAttribute('aria-label') || ''} ${target.getAttribute('title') || ''}`)
    if (STOP_UNSAFE_TEXT.test(label) || STOP_UNSAFE_LABEL.test(label)) return { done: false, why: `unsafe control "${clip(label, 40)}"` }
    const link = target.closest('a[href]')
    if (link) {
      if ((link.getAttribute('target') || '').toLowerCase() === '_blank') return { done: false, why: 'opens a new tab' }
      try {
        const url = new URL(link.getAttribute('href'), location.href)
        if (/^https?:$/.test(url.protocol) && url.origin !== location.origin) return { done: false, why: 'leaves the site' }
      } catch {
        // an href that is not a URL (javascript:, #) stays on the page
      }
    }
    stopRemedied.add(el)
    target.scrollIntoView({ block: 'center', behavior: 'instant' })
    clickLikeUser(target)
    return { done: true }
  }
  /** Whether the last remedy brought new rows: if it did, its element may be used again. */
  function stopRemedyBrought(rowsCame) {
    if (rowsCame && lastRemedied) stopRemedied.delete(lastRemedied)
    lastRemedied = null
  }

  window.__dlk = { DOC_ID, stopEvidence, stopRemedy, stopRemedyBrought, count: countAll, find, tree, shadowRootCount, pageState, stateChange, changeMark, markOnScreen, lists, controls, scrollers, overlays, probe, extract, extractTagged, contentMark, recordText, signature, markFirstClickable, scrollStep, dismiss, clickAll, takeExpandClicks, expandBusy, expandLeft, unclickedAmongRows, bodyText, cssPath, postProcess, toNumber, wall, claims, scrollCandidates, locate, act, press, unreadLinks, unreadParts, outline, outlineControls, clearOutline, pick, cancelPick }
}
