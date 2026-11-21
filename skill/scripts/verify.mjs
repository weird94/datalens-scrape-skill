#!/usr/bin/env node
// Quality report for a collected CSV: fill rates, duplicates, rows whose shape differs from the
// majority (control / group-header / ad rows), columns that look broken.
//
//   node scripts/verify.mjs rows.csv
import fs from 'node:fs'
import { verifyTable } from './lib/verifier.mjs'

const file = process.argv[2]
if (!file) {
  console.error('usage: verify.mjs rows.csv')
  process.exit(2)
}

function parseCsv(text) {
  const out = []
  let row = []
  let cell = ''
  let quoted = false
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i]
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') {
        cell += '"'
        i += 1
      } else if (ch === '"') quoted = false
      else cell += ch
    } else if (ch === '"') quoted = true
    else if (ch === ',') {
      row.push(cell)
      cell = ''
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i += 1
      row.push(cell)
      out.push(row)
      row = []
      cell = ''
    } else cell += ch
  }
  if (cell || row.length) {
    row.push(cell)
    out.push(row)
  }
  return out
}

const [header, ...rows] = parseCsv(fs.readFileSync(file, 'utf8').replace(/^﻿/, ''))
// The collector's summary next to the CSV (rows.json, or rows.summary.json when that is the config's name)
const summaryFile = [file.replace(/\.csv$/i, '') + '.json', file.replace(/\.csv$/i, '') + '.summary.json'].find(f => {
  try {
    return 'stopReason' in JSON.parse(fs.readFileSync(f, 'utf8'))
  } catch {
    return false
  }
})
const summary = summaryFile ? JSON.parse(fs.readFileSync(summaryFile, 'utf8')) : null
console.log(verifyTable({ header: header ?? [], rows, summary }).lines.join('\n'))
