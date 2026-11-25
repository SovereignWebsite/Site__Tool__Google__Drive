// Builds the published single-file modules from api-src/: the shared base is inlined where a source says //#include base.mjs.
// node tools/api-build.mjs drive 0.2.0            -> site/api/v0.2.0/drive.mjs
// node tools/api-build.mjs chat 0.1.0 <outdir>    -> <outdir>/v0.1.0/chat.mjs   (Chat's own repository publishes it)
// Refuses to overwrite an existing version whose hash differs: pinned versions never change.
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
const [name, version, out] = process.argv.slice(2);
const here = new URL('../', import.meta.url).pathname;
if (!name || !/^\d+\.\d+\.\d+$/.test(version || '')) { console.error('usage: api-build.mjs <drive|chat> <x.y.z> [outdir]'); process.exit(2); }
let src = readFileSync(here + `api-src/${name}.mjs`, 'utf8');
if (!src.includes(`export const VERSION = '${version}'`)) { console.error(`api-src/${name}.mjs says a different VERSION than ${version}`); process.exit(1); }
src = src.replace('//#include base.mjs', readFileSync(here + 'api-src/base.mjs', 'utf8'));
const dir = (out || here + 'site/api') + `/v${version}`, file = `${dir}/${name}.mjs`;
if (existsSync(file) && readFileSync(file, 'utf8') !== src) { console.error(`${file} exists and differs: pinned versions never change. Bump the version.`); process.exit(1); }
mkdirSync(dir, { recursive: true }); writeFileSync(file, src); console.log('built ' + file);
