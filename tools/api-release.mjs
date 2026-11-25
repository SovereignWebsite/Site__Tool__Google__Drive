// Writes site/api/versions.json (SRI hash per pinned version) and checks that latest/ equals the newest version.
// node tools/api-release.mjs          write and check;   node tools/api-release.mjs --check   check only (exit 1 on a mismatch)
// A released version's file must never change: the recorded hash is kept, and a different hash for the same version fails.
import { readFileSync, writeFileSync, readdirSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
const root = new URL('../site/api/', import.meta.url).pathname, check = process.argv.includes('--check');
const sri = (f) => 'sha384-' + createHash('sha384').update(readFileSync(f)).digest('base64');
const vs = readdirSync(root).filter((d) => /^v\d+\.\d+\.\d+$/.test(d)).map((d) => d.slice(1)).sort((a, b) => a.localeCompare(b, 'en', { numeric: true }));
const prev = existsSync(root + 'versions.json') ? JSON.parse(readFileSync(root + 'versions.json', 'utf8')) : { versions: [] };
let bad = 0; const versions = vs.map((v) => {
  const path = `/api/v${v}/drive.mjs`, h = sri(root + `v${v}/drive.mjs`), old = prev.versions.find((x) => x.version === v);
  if (old && old.sri !== h) { console.error(`v${v} was released with ${old.sri} but the file now hashes to ${h}: pinned versions never change. Make a new version.`); bad++; }
  return { version: v, path, sri: old ? old.sri : h };
});
const newest = vs.at(-1);
if (sri(root + 'latest/drive.mjs') !== sri(root + `v${newest}/drive.mjs`)) { console.error(`latest/ is not v${newest}`); bad++; }
if (bad) process.exit(1);
if (!check) writeFileSync(root + 'versions.json', JSON.stringify({ latest: newest, latest_path: '/api/latest/drive.mjs', versions: versions.reverse() }, null, 2) + '\n');
console.log(`api ok: latest is v${newest}`);
