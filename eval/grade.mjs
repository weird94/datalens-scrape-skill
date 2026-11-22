// Grade agent CSVs against the playground answer keys. Usage: node grade.mjs <outDir>
import fs from 'node:fs'
import path from 'node:path'
const C = new URL('./playground/cases', import.meta.url).pathname
const outDir = process.argv[2]
const aliases = JSON.parse(fs.readFileSync(new URL('./aliases.json', import.meta.url), 'utf8'))
const parse = text => {
  const out = []; let row = []; let cell = ''; let q = false
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i]
    if (q) { if (ch === '"' && text[i + 1] === '"') { cell += '"'; i += 1 } else if (ch === '"') q = false; else cell += ch }
    else if (ch === '"') q = true
    else if (ch === ',') { row.push(cell); cell = '' }
    else if (ch === '\n' || ch === '\r') { if (ch === '\r' && text[i + 1] === '\n') i += 1; row.push(cell); out.push(row); row = []; cell = '' }
    else cell += ch
  }
  if (cell || row.length) { row.push(cell); out.push(row) }
  return out.filter(r => r.some(Boolean))
}
const results = []
const skipped = []
for (const [token, { id }] of Object.entries(aliases)) {
  const exp = JSON.parse(fs.readFileSync(path.join(C, id, 'expected.json'), 'utf8'))
  const file = [path.join(outDir, `${token}.csv`), path.join(outDir, `${id}.csv`)].find(f => fs.existsSync(f)) ?? path.join(outDir, `${token}.csv`)
  // An alias whose blind run has not been saved as a config yet (blind/<token>.json) has nothing to rerun.
  if (!fs.existsSync(file) && !fs.existsSync(new URL(`./blind/${token}.json`, import.meta.url))) { skipped.push(id); continue }
  if (!fs.existsSync(file)) { results.push({ id, expected: exp.expectedRows, rows: null, ok: false, note: 'no csv' }); continue }
  const [header, ...rows] = parse(fs.readFileSync(file, 'utf8').replace(/^﻿/, ''))
  const prefix = (exp.rowMatch?.textPrefix ?? '').trim()
  const matching = rows.filter(r => r.some(c => c.trim().startsWith(prefix) || c.includes(prefix))).length
  const distinct = new Set(rows.map(r => r.join('\u0001'))).size
  results.push({ id, expected: exp.expectedRows, rows: rows.length, matching, distinct, columns: header.length, ok: rows.length === exp.expectedRows && matching === exp.expectedRows && distinct === rows.length })
}
for (const r of results) console.log(`${r.ok ? 'OK ' : '-- '}${r.id.padEnd(16)} ${String(r.rows ?? '-').padStart(4)}/${String(r.expected).padEnd(4)} match=${r.matching ?? '-'} distinct=${r.distinct ?? '-'} cols=${r.columns ?? '-'} ${r.note ?? ''}`)
console.log(`\n${results.filter(r => r.ok).length}/${results.length} ok`)
if (skipped.length) console.log(`no saved blind config yet (not graded): ${skipped.join(', ')}`)
fs.writeFileSync(path.join(outDir, 'grade.json'), JSON.stringify(results, null, 2))
