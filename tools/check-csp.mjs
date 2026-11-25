// CI-style check of every page's meta Content-Security-Policy (security.b, 25 Nov 2026): exact hosts, no wildcards, no bare https:,
// Google script only on the page that opens the Picker, no-referrer on the sign-in pages. node tools/check-csp.mjs
import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
const pages = execSync("git ls-files 'site/app/*.html' 'site/app/**/*.html' 'site/api/*.html' 'site/api/**/*.html'", { encoding: 'utf8' }).split('\n').filter(Boolean);
const bad = [];
for (const f of pages) {
  const h = readFileSync(f, 'utf8'), m = /http-equiv="Content-Security-Policy" content="([^"]*)"/.exec(h);
  if (!m) { bad.push(`${f}: no Content-Security-Policy`); continue; }
  const dirs = Object.fromEntries(m[1].split(';').map((d) => d.trim()).filter(Boolean).map((d) => { const [k, ...v] = d.split(/\s+/); return [k, v]; }));
  for (const [k, v] of Object.entries(dirs)) for (const s of v) {
    if (/^\*$|\*\./.test(s) || /^https?:$/.test(s)) bad.push(`${f}: ${k} allows ${s}`);
    if (k === 'default-src' && s !== "'none'") bad.push(`${f}: default-src must be 'none'`);
  }
  const isBrowse = f === 'site/app/browse/index.html';
  const gs = (dirs['script-src'] || []).filter((s) => /^https:/.test(s));
  if (!isBrowse && gs.length) bad.push(`${f}: a third-party script source (${gs.join(' ')}) outside the Picker page`);
  const conn = (dirs['connect-src'] || []).filter((s) => /^https:/.test(s));
  for (const c of conn) if (!['https://www.googleapis.com', 'https://oauth2.googleapis.com', 'https://content.googleapis.com', 'https://chat.googleapis.com', 'https://dev.send.sgraph.ai'].includes(c)) bad.push(`${f}: connect-src ${c} is not an expected host`);
  if (/\/app\//.test(f) && !/<meta name="referrer" content="no-referrer">/.test(h)) bad.push(`${f}: no Referrer-Policy no-referrer`);
}
if (bad.length) { console.error('CSP check failed:\n' + bad.join('\n')); process.exit(1); }
console.log(`CSP check: ${pages.length} pages ok`);
