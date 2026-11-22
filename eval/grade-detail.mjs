// Grade detail.mjs outputs (eval/dev-detail configs run over the dev list CSVs) against the playground answer keys:
// status counts, and with a child list the child count of every item, the child table's size, and no warnings.
// Usage: node grade-detail.mjs <outDir>   (reads <outDir>/<id>.csv, <id>.children.csv, <id>.json)
import fs from 'node:fs'
import path from 'node:path'
import { parseCsv } from '../skill/scripts/lib/csv.mjs'

const CASES = new URL('./playground/cases', import.meta.url).pathname
const CONFIGS = new URL('./dev-detail', import.meta.url).pathname
const outDir = process.argv[2]
const results = []
for (const file of fs.readdirSync(CONFIGS).filter(f => f.endsWith('.json')).sort()) {
  const id = path.basename(file, '.json')
  const exp = JSON.parse(fs.readFileSync(path.join(CASES, id, 'expected.json'), 'utf8')).detail
  const csv = path.join(outDir, `${id}.csv`)
  const summaryFile = path.join(outDir, `${id}.json`)
  if (!fs.existsSync(csv) || !fs.existsSync(summaryFile)) {
    results.push({ id, ok: false, note: 'no output' })
    continue
  }
  const summary = JSON.parse(fs.readFileSync(summaryFile, 'utf8'))
  const problems = []
  if (JSON.stringify(summary.status) !== JSON.stringify(exp.expectedStatus)) problems.push(`status ${JSON.stringify(summary.status)}`)
  if (summary.warnings?.length) problems.push(`warnings: ${summary.warnings.map(w => w.slice(0, 80)).join(' | ')}`)
  let childNote = ''
  if (exp.children) {
    const main = parseCsv(fs.readFileSync(csv, 'utf8'))
    const kids = parseCsv(fs.readFileSync(path.join(outDir, `${id}.children.csv`), 'utf8'))
    const idOf = link => link.match(/\/(\d+)(\?|$)/)?.[1]
    const wrong = []
    for (const row of main.rows) {
      const item = idOf(row.link ?? '')
      if (!item || !(item in exp.children.countsById)) continue
      if (row.children_count !== String(exp.children.countsById[item])) wrong.push(`#${item} ${row.children_count || '-'}/${exp.children.countsById[item]}`)
    }
    if (wrong.length) problems.push(`counts ${wrong.join(', ')}`)
    if (kids.rows.length !== exp.children.totalRows) problems.push(`child rows ${kids.rows.length}/${exp.children.totalRows}`)
    // Every child row belongs to the item whose page it was read on ("Review k of product <id>").
    const strays = kids.rows.filter(k => !String(k.review ?? '').includes(`of product ${idOf(k.parent_link)}:`))
    if (strays.length) problems.push(`${strays.length} child rows of another item (e.g. ${JSON.stringify(strays[0].review)})`)
    childNote = ` children=${kids.rows.length}/${exp.children.totalRows}`
  }
  results.push({ id, ok: !problems.length, note: `${childNote} ${problems.join('; ')}`.trim() })
}
for (const r of results) console.log(`${r.ok ? 'OK ' : '-- '}${r.id.padEnd(16)} ${r.note}`)
console.log(`\n${results.filter(r => r.ok).length}/${results.length} ok`)
fs.writeFileSync(path.join(outDir, 'grade.json'), JSON.stringify(results, null, 2))
