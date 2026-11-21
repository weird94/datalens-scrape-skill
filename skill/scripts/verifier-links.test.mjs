import assert from 'node:assert/strict'
import { test } from 'node:test'
import { verifyTable } from './lib/verifier.mjs'

const table = { header: ['title'], rows: [['A'], ['B'], ['C']] }

test('notes rows that carry links of their own when no column reads one', () => {
  const { notes, warnings } = verifyTable({
    ...table,
    summary: { unreadLinks: { rows: 3, withLinks: 3, example: 'https://shop.example/item/1' } },
  })
  assert.equal(warnings.length, 0)
  assert.match(notes.join('\n'), /3 of the first 3 rows link to pages of their own \(e\.g\. https:\/\/shop\.example\/item\/1\) but no column reads a link — add a column with attr "href" for the row.s own page/)
})

test('says nothing about links when the collector found none unread', () => {
  const { notes } = verifyTable({ ...table, summary: {} })
  assert.equal(notes.some(note => /link/.test(note)), false)
})
