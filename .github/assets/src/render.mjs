// Renders the README hero and the GitHub social preview from a real collect.mjs run.
// Usage: node .github/assets/src/render.mjs <run.csv> <run.summary.json>
// Needs playwright (npm install in skill/). Output: .github/assets/hero.png, social-preview.png
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const here = dirname(fileURLToPath(import.meta.url));
const out = join(here, '..');
const require = createRequire(join(here, '../../../skill/package.json'));
const { chromium } = require('playwright');

const [csvPath, summaryPath] = process.argv.slice(2);
if (!csvPath || !summaryPath) {
  console.error('usage: render.mjs <run.csv> <run.summary.json>');
  process.exit(1);
}

function parseCsv(text) {
  const rows = [];
  let row = [], cell = '', quoted = false;
  text = text.replace(/^﻿/, '');
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') { cell += '"'; i++; }
      else if (c === '"') quoted = false;
      else cell += c;
    } else if (c === '"') quoted = true;
    else if (c === ',') { row.push(cell); cell = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(cell); rows.push(row); row = []; cell = '';
    } else cell += c;
  }
  if (cell || row.length) { row.push(cell); rows.push(row); }
  return rows;
}

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
const [header, ...data] = parseCsv(readFileSync(csvPath, 'utf8')).filter((r) => r.length > 1);
const summary = JSON.parse(readFileSync(summaryPath, 'utf8'));
const col = (name) => header.indexOf(name);
const show = ['rank', 'title', 'site', 'points', 'author', 'comments'];
const rowsHtml = data.slice(0, 5).map((r) =>
  `<tr>${show.map((n) => `<td class="c-${n}">${esc(r[col(n)] ?? '')}</td>`).join('')}</tr>`).join('');
const more = data.length - 5;

const page = (body, w, h) => `<!doctype html><html><head><meta charset="utf-8"><style>
*{box-sizing:border-box;margin:0;padding:0}
html,body{width:${w}px;height:${h}px;background:transparent}
body{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Helvetica,Arial,sans-serif;-webkit-font-smoothing:antialiased}
.mono{font-family:"SF Mono",SFMono-Regular,Menlo,Consolas,monospace}
${body.css}</style></head><body>${body.html}</body></html>`;

const hero = {
  css: `
.win{width:1200px;border-radius:14px;overflow:hidden;background:#0f1115;border:1px solid #2a2f3a;box-shadow:0 18px 50px rgba(15,17,21,.28)}
.bar{height:38px;display:flex;align-items:center;gap:8px;padding:0 16px;background:#171a21;border-bottom:1px solid #232834}
.dot{width:12px;height:12px;border-radius:50%;background:#3a3f4b}
.bar .t{margin-left:12px;color:#7d8590;font-size:13px}
.term{padding:22px 26px 6px;font-size:15.5px;line-height:1.62;color:#c9d1d9}
.you{color:#e6edf3}.you b{color:#7ee787;font-weight:600;margin-right:10px}
.tool{color:#7d8590}.tool b{color:#d2a8ff;font-weight:600}
.ok{color:#e6edf3}.ok b{color:#7ee787}
.warn{color:#e3b341}
.dim{color:#7d8590}
.gap{height:10px}
.sheet{margin:14px 26px 24px;border:1px solid #2a2f3a;border-radius:10px;overflow:hidden;background:#fbfbfc}
.sheet .file{display:flex;justify-content:space-between;padding:9px 14px;font-size:13px;color:#57606a;background:#f0f2f5;border-bottom:1px solid #d8dee4}
table{width:100%;border-collapse:collapse;font-size:13.5px;color:#1f2328;table-layout:fixed}
th{font-weight:600;text-align:left;padding:7px 12px;background:#f6f8fa;border-bottom:1px solid #d8dee4;color:#57606a}
td{padding:7px 12px;border-bottom:1px solid #eaeef2;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.c-rank{width:58px;color:#57606a}.c-title{width:auto}.c-site{width:175px;color:#57606a}.c-points{width:118px}.c-author{width:165px}.c-comments{width:148px}
tr.more td{color:#8c959f;font-style:italic;border-bottom:0}`,
  html: `<div class="win">
  <div class="bar"><span class="dot"></span><span class="dot"></span><span class="dot"></span><span class="t mono">claude</span></div>
  <div class="term mono">
    <div class="you"><b>&gt;</b>Put the first 3 pages of Hacker News into a CSV: https://news.ycombinator.com</div>
    <div class="gap"></div>
    <div class="tool"><b>⏺ Skill</b>(datalens-scrape)  inspect → preview 2 pages → verify → collect</div>
    <div class="gap"></div>
    <div class="ok"><b>⏺</b> Saved hn.csv: ${summary.rows} rows, ${header.length} columns, ${summary.seconds} s.</div>
    <div class="warn">&nbsp;&nbsp;Stopped at the ${summary.rounds} pages you asked for. "More" was still there, so this is not the whole list:</div>
    <div class="warn">&nbsp;&nbsp;say "keep going" and it resumes from page ${summary.rounds + 1}.</div>
  </div>
  <div class="sheet">
    <div class="file mono"><span>hn.csv</span><span>${summary.rows} rows · ${header.join(', ').length > 90 ? header.slice(0, 7).join(', ') + ', …' : header.join(', ')}</span></div>
    <table class="mono"><thead><tr>${show.map((n) => `<th class="c-${n}">${n}</th>`).join('')}</tr></thead>
    <tbody>${rowsHtml}<tr class="more"><td></td><td colspan="5">… ${more} more rows</td></tr></tbody></table>
  </div>
</div>`,
};

const social = {
  css: `
body{background:#0f1115;color:#e6edf3;padding:64px 72px;display:flex;flex-direction:column;justify-content:space-between}
.k{font-size:22px;color:#7d8590;letter-spacing:.2px}
h1{font-size:66px;line-height:1.08;font-weight:700;letter-spacing:-1.2px;margin-top:18px}
h1 span{color:#7ee787}
.sub{font-size:27px;line-height:1.45;color:#adbac7;margin-top:22px;max-width:1000px}
.row{display:flex;gap:14px;flex-wrap:wrap}
.pill{font-size:20px;padding:9px 16px;border:1px solid #2f3542;border-radius:999px;color:#c9d1d9;background:#161a22}
.cmd{font-size:21px;color:#7d8590;margin-top:22px}.cmd b{color:#e6edf3;font-weight:500}`,
  html: `<div>
  <div class="k mono">weird94/datalens-scrape-skill</div>
  <h1>Any web list → <span>CSV</span>,<br>from your AI agent</h1>
  <div class="sub">A free Agent Skill: whole lists, tables and comment threads, across pagination, infinite scroll and "load more". Runs locally. No API key.</div>
</div>
<div>
  <div class="row"><span class="pill">Claude Code</span><span class="pill">Playwright</span><span class="pill">your own Chrome logins</span><span class="pill">honest stop reason</span><span class="pill">MIT</span></div>
  <div class="cmd mono">$ <b>npx skills add weird94/datalens-scrape-skill</b></div>
</div>`,
};

const browser = await chromium.launch();
try {
  const p1 = await browser.newPage({ viewport: { width: 1240, height: 800 }, deviceScaleFactor: 2 });
  await p1.setContent(page(hero, 1240, 800));
  await p1.locator('.win').screenshot({ path: join(out, 'hero.png'), omitBackground: true });
  const p2 = await browser.newPage({ viewport: { width: 1280, height: 640 }, deviceScaleFactor: 1 });
  await p2.setContent(page(social, 1280, 640));
  await p2.screenshot({ path: join(out, 'social-preview.png') });
  console.log('wrote', join(out, 'hero.png'), join(out, 'social-preview.png'));
} finally {
  await browser.close();
}
