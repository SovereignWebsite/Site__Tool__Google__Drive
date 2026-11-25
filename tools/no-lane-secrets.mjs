// Fails when a file in this repository holds what looks like a real lane card value (a.maestro, 25 Nov 2026).
//  1. any bare 64-hex string (a token or key) that is not a hash written with its prefix (sha256: or p256:), in any tracked file except vendor/ and data we publish on purpose;
//  2. any vault id or other value on a deny list kept OUTSIDE the repository: ~/.sw-secret/lane-deny.txt (one value per line), or $LANE_DENY (comma separated).
// A line may carry the marker  lane-check: ok  when a 64-hex value is a test value on purpose.
import { execSync } from 'node:child_process';
import { readFileSync, existsSync } from 'node:fs';
import { homedir } from 'node:os';
const files = execSync('git ls-files', { encoding: 'utf8' }).split('\n').filter(Boolean)
  .filter((f) => !/(^|\/)vendor\//.test(f) && !/^site\/keys\//.test(f) && f !== 'site/api/versions.json' && !/\.(jpg|png|webp)$/.test(f));
const deny = [...(process.env.LANE_DENY || '').split(','), ...(existsSync(homedir() + '/.sw-secret/lane-deny.txt') ? readFileSync(homedir() + '/.sw-secret/lane-deny.txt', 'utf8').split('\n') : [])].map((s) => s.trim()).filter((s) => s.length >= 6);
const bad = [];
for (const f of files) {
  const lines = readFileSync(f, 'utf8').split('\n');
  lines.forEach((l, i) => {
    if (l.includes('lane-check: ok')) return;
    for (const m of l.matchAll(/(?<![0-9a-fA-F:])([0-9a-f]{64})(?![0-9a-f])/g)) { const before = l.slice(Math.max(0, m.index - 8), m.index); if (!/(sha256|p256):$/.test(before)) bad.push(`${f}:${i + 1}: a bare 64-hex value`); }
    for (const d of deny) if (l.includes(d)) bad.push(`${f}:${i + 1}: a value on the lane deny list`);
  });
}
if (bad.length) { console.error('lane card check failed:\n' + bad.join('\n')); process.exit(1); }
console.log(`lane card check: ${files.length} files clean (${deny.length} deny-list values)`);
