// Can a host without Node (the extension) bundle `entry`? Walks its relative imports and reads every module's
// source for anything that only works in Node: a non-relative import of any form (node: built-ins, bare built-in
// names, packages such as playwright — static, re-export, side-effect or dynamic), require(), and the process,
// Buffer, __dirname and __filename globals. A regex over the source, not a parser: prose in comments only trips it
// when it reads like code ("process.env"), and such a comment can be reworded.
import fs from 'node:fs'
import path from 'node:path'

const STATIC = /^\s*(?:import|export)\b[^'"]*?\bfrom\s*['"]([^'"]+)['"]/gm
const SIDE_EFFECT = /^\s*import\s*['"]([^'"]+)['"]/gm
const NODE_ONLY = [
  [/\bimport\s*\(/, 'dynamic import()'],
  [/\brequire\s*\(/, 'require()'],
  [/\bprocess(?:\??\.[A-Za-z_$]|\s*\[)/, 'the process global'],
  [/\bBuffer(?:\??\.[A-Za-z_$]|\s*\()|\bnew\s+Buffer\b/, 'the Buffer global'],
  [/\b__dirname\b|\b__filename\b/, '__dirname / __filename'],
]

/** Problems found in `entry` and every module it imports relatively, each as "<file>: <what>"; [] when it is browser-safe. */
export function browserSafetyProblems(entry) {
  const base = path.dirname(entry)
  const problems = []
  const seen = new Set()
  const visit = file => {
    if (seen.has(file)) return
    seen.add(file)
    const text = fs.readFileSync(file, 'utf8')
    const name = path.relative(base, file)
    for (const re of [STATIC, SIDE_EFFECT]) {
      for (const [, spec] of text.matchAll(re)) {
        if (spec.startsWith('.')) visit(path.resolve(path.dirname(file), spec))
        else problems.push(`${name}: imports '${spec}' (only relative modules bundle for the browser)`)
      }
    }
    for (const [re, what] of NODE_ONLY) if (re.test(text)) problems.push(`${name}: uses ${what}`)
  }
  visit(entry)
  return problems
}
