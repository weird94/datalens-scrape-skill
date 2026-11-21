// verify.mjs on the CSV of a run that did not finish: it must say so, not "OK  no warnings".
// Run with `node --test scripts/verifier-stop.test.mjs`.
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { verifyTable } from './lib/verifier.mjs'

const table = { header: ['title'], rows: [['A'], ['B'], ['C']] }

for (const stopReason of ['running', 'interrupted', 'error']) {
  test(`warns that the list is incomplete when the run ended "${stopReason}"`, () => {
    const { warnings, lines } = verifyTable({ ...table, summary: { stopReason, note: stopReason === 'error' ? 'page crashed' : undefined } })
    assert.equal(warnings.length, 1, lines.join('\n'))
    assert.match(warnings[0], /the CSV holds only the rows collected until then/)
    if (stopReason === 'error') assert.match(warnings[0], /page crashed/)
    assert.equal(lines.includes('OK  no warnings'), false)
  })
}

test('warns about an unfinished run with no rows too', () => {
  const { warnings } = verifyTable({ header: ['title'], rows: [], summary: { stopReason: 'interrupted' } })
  assert.equal(warnings.length, 1)
})

test('says nothing about the stop of a run that got to its end', () => {
  const { warnings } = verifyTable({ ...table, summary: { stopReason: 'scroll-end' } })
  assert.deepEqual(warnings, [])
})
