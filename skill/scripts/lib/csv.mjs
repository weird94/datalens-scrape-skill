// CSV in and out, shared by collect.mjs (writes the list) and detail.mjs (reads it back, writes it wider).
// Pure string functions (no file system), so hosts without one can use them too.
// Output: UTF-8 with a BOM (so Excel opens it as UTF-8), quoted only where needed, "\n" line ends.
const BOM = '\uFEFF'

/** One cell: quoted when it holds a comma, a quote or a line break. */
export function csvCell(value) {
  const s = String(value ?? '')
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

/**
 * The whole file: header line, one line per row (rows are objects keyed by column), BOM in front. In a
 * one-column file an empty cell is written as "" (as Python's csv module does), so the row is not a blank line.
 */
export function toCsv(columns, rows) {
  const line = r => (columns.length === 1 && String(r[columns[0]] ?? '') === '' ? '""' : columns.map(c => csvCell(r[c])).join(','))
  return BOM + [columns.map(csvCell).join(','), ...rows.map(line)].join('\n') + '\n'
}

/**
 * Parse CSV text (RFC 4180): a leading BOM is dropped; quoted cells may hold commas, line breaks and
 * doubled quotes; lines end in \n, \r\n or \r. The first non-blank line is the header. Blank lines are no
 * rows, except in a one-column file, where a blank line between rows is a row with an empty cell (only
 * blank lines at the end are dropped); a line holding a quoted "" is always a row.
 * Returns { columns, rows } with rows as objects keyed by column (a short line leaves its last cells "").
 * Throws on an unterminated quote or a duplicate / empty column name.
 */
export function parseCsv(text) {
  const src = text.startsWith(BOM) ? text.slice(1) : text
  const lines = []
  let line = []
  let cell = ''
  let quoted = false
  /** Did the line being read have a quoted cell (then `""` alone is a row, not a blank line)? */
  let hadQuote = false
  let i = 0
  const endCell = () => {
    line.push(cell)
    cell = ''
  }
  const endLine = () => {
    endCell()
    lines.push({ cells: line, blank: line.length === 1 && line[0] === '' && !hadQuote })
    line = []
    hadQuote = false
  }
  while (i < src.length) {
    const ch = src[i]
    if (quoted) {
      if (ch === '"') {
        if (src[i + 1] === '"') {
          cell += '"'
          i += 2
          continue
        }
        quoted = false
      } else cell += ch
      i += 1
      continue
    }
    if (ch === '"' && cell === '') {
      quoted = true
      hadQuote = true
    } else if (ch === ',') endCell()
    else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && src[i + 1] === '\n') i += 1
      endLine()
    } else cell += ch
    i += 1
  }
  if (quoted) throw new Error('CSV: a quoted cell is never closed')
  if (cell !== '' || line.length || hadQuote) endLine()
  while (lines.length && lines[0].blank) lines.shift()
  while (lines.length && lines[lines.length - 1].blank) lines.pop()
  const [header = { cells: [] }, ...rest] = lines
  const columns = header.cells.map(c => c.trim())
  const body = (columns.length === 1 ? rest : rest.filter(l => !l.blank)).map(l => l.cells)
  const seen = new Set()
  for (const c of columns) {
    if (!c) throw new Error('CSV: the header has an empty column name')
    if (seen.has(c)) throw new Error(`CSV: the header names column "${c}" twice`)
    seen.add(c)
  }
  const rows = body.map(cells => Object.fromEntries(columns.map((c, k) => [c, cells[k] ?? ''])))
  return { columns, rows }
}
