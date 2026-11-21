import { NextRequest } from '../_lib/next-shim'
import { describe, expect, it } from 'vitest'

import { excerptPosts } from '../excerpt-cards/posts'
import { GET as excerptCards } from '../excerpt-cards/route'

const BASE = 'http://localhost:3008'
const PATH = '/dev-fixtures/playground/excerpt-cards'

async function fetchPage(query = ''): Promise<{ status: number; html: string }> {
  const response = await excerptCards(new NextRequest(`${BASE}${PATH}${query}`))
  return { status: response.status, html: await response.text() }
}

function scriptOf(html: string): string {
  return html.match(/<script>([\s\S]*?)<\/script>/)?.[1] ?? ''
}

/** The body of one function in the page script, up to the next top-level function. */
function functionBody(script: string, name: string): string {
  return script.match(new RegExp(`function ${name}\\([^)]*\\) \\{([\\s\\S]*?)\\n\\}`))?.[1] ?? ''
}

describe('playground excerpt-cards (C13)', () => {
  it('collapsed excerpts put the writer in front of the cut-off text; the whole text has no such label', () => {
    for (const lang of ['zh', 'en'] as const) {
      const posts = excerptPosts(24, lang)
      expect(posts).toHaveLength(24)
      for (const post of posts) {
        expect(post.excerpt.endsWith('…')).toBe(post.id % 10 !== 0)
        expect(post.excerpt.startsWith(post.writer)).toBe(true)
        expect(post.html.startsWith(post.writer)).toBe(false)
        // The excerpt, minus its label and the cut, is how the whole text starts (apart from a cut entity).
        const body = post.excerpt.slice(post.writer.length).replace(/^(：|: )/, '').replace(/…$/, '')
        expect(post.html.startsWith(body.replace(/&[a-z]*$/, ''))).toBe(true)
      }
    }
  })

  it('every fifth post is one short line, cut-marked all the same except every tenth', () => {
    for (const lang of ['zh', 'en'] as const) {
      for (const post of excerptPosts(24, lang).filter((p) => p.id % 5 === 0)) {
        const body = post.excerpt.slice(post.writer.length).replace(/^(：|: )/, '').replace(/…$/, '')
        expect(body).toBe(post.html)
      }
    }
  })

  it('every fourth excerpt (not a one-liner) is cut inside an escaped ampersand', () => {
    const posts = excerptPosts(24, 'zh')
    for (const post of posts.filter((p) => p.id % 4 === 0 && p.id % 5 !== 0)) {
      expect(post.excerpt).toMatch(/&a?m?p?…$/)
      expect(post.excerpt).not.toMatch(/&amp;…$/)
      expect(post.html).toContain('&amp;')
    }
  })

  it('only the opened card shows the byline and the date', async () => {
    const { status, html } = await fetchPage('?posts=12&batch=4')
    expect(status).toBe(200)
    const script = scriptOf(html)
    const collapsed = functionBody(script, 'collapsed')
    const opened = functionBody(script, 'opened')
    expect(collapsed).toContain('NAMES.open')
    expect(collapsed).not.toContain('NAMES.byline')
    expect(collapsed).not.toContain('NAMES.time')
    expect(opened).toContain('NAMES.byline')
    expect(opened).toContain('NAMES.writer')
    expect(opened).toContain('NAMES.time')
    expect(opened).toContain('NAMES.close')
  })

  it('hash class names replace every semantic one', async () => {
    const { html } = await fetchPage('?cls=hash&lang=en')
    const names = JSON.parse(scriptOf(html).match(/var NAMES = (\{.*?\});/)?.[1] ?? '{}') as Record<string, string>
    expect(Object.values(names)).toHaveLength(16)
    for (const value of Object.values(names)) expect(value).toMatch(/^[a-z]\d[a-z]\d[a-z]\d$/)
    expect(html).not.toMatch(/class="(feed|feed-status)"/)
    expect(html).toContain('Read more')
  })
})
