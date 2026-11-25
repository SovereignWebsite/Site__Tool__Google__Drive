// Tests for site/api/*/drive.mjs with a mocked Google. Run: node tools/test-api.mjs
import assert from 'node:assert/strict';
const { createDrive, SCOPES } = await import('../site/api/v' + (process.argv[2] || '0.1.0') + '/drive.mjs');
const calls = [];
const mk = (extra = {}) => {
  const ss = new Map(); let loc = { origin: 'https://x.example', pathname: '/cb/', search: '', hash: '', assign(u) { loc.went = u; } };
  const env = { indexedDB: undefined, crypto: globalThis.crypto, location: loc, history: { replaceState(_, __, u) { loc.hash = ''; loc.cleaned = u; } },
    sessionStorage: { getItem: (k) => ss.get(k) ?? null, setItem: (k, v) => ss.set(k, v), removeItem: (k) => ss.delete(k) },
    fetch: async (url, init = {}) => { calls.push({ url: String(url), init }); const j = (o, s = 200) => ({ ok: s < 400, status: s, json: async () => o, arrayBuffer: async () => new TextEncoder().encode('hi').buffer }); 
      if (String(url).includes('/files/f1?') && !String(url).includes('alt=media') && init.method !== 'PATCH') return j({ id: 'f1', name: 'a.txt', mimeType: 'text/plain', parents: ['p'] });
      if (String(url).includes('/files/g1?')) return j({ id: 'g1', mimeType: 'application/vnd.google-apps.spreadsheet' });
      if (String(url).includes('bad')) return j({ error: { message: 'nope' } }, 403);
      return j({ files: [], id: 'n' }); }, ...extra };
  return { d: createDrive({ clientId: 'cid', scope: SCOPES.file, env }), loc, ss };
};
let { d, loc, ss } = mk();
assert.equal(await d.isSignedIn(), false);
await assert.rejects(() => d.list(), /Not signed in/);
d.signIn(); const u = new URL(loc.went); assert.equal(u.searchParams.get('response_type'), 'token'); assert.equal(u.searchParams.get('client_id'), 'cid');
assert.equal(u.searchParams.get('redirect_uri'), 'https://x.example/cb/'); assert.equal(u.searchParams.get('scope'), SCOPES.file);
const state = u.searchParams.get('state');
loc.hash = '#access_token=T&expires_in=3599&state=WRONG'; await assert.rejects(() => d.handleRedirect(), /did not match/);
assert.equal(await d.isSignedIn(), false, 'forged state stores nothing');
d.signIn(); const st = new URL(loc.went).searchParams.get('state');
loc.hash = `#access_token=T&expires_in=3599&state=${st}`; assert.deepEqual(await d.handleRedirect(), { signedIn: true, fresh: true }); assert.equal(loc.cleaned, '/cb/');
await d.list({ parent: "a'b", q: 'mimeType="x"' }); const q = new URL(calls.at(-1).url).searchParams.get('q');
assert.equal(q, "trashed=false and 'a\\'b' in parents and (mimeType=\"x\")"); assert.equal(calls.at(-1).init.headers.Authorization, 'Bearer T');
await d.search("it's"); assert.match(new URL(calls.at(-1).url).searchParams.get('q'), /name contains 'it\\'s' or fullText contains/);
assert.equal((await d.download('f1')).type, 'text/plain'); assert.match(calls.at(-1).url, /alt=media/);
const g = await d.download('g1'); assert.equal(g.type, 'text/csv'); assert.match(calls.at(-1).url, /export\?mimeType=text%2Fcsv/);
await d.upload('hello', { name: 'n.txt', type: 'text/plain', parent: 'p' }); assert.match(calls.at(-1).init.headers['Content-Type'], /^multipart\/related; boundary=sw/);
await d.createFolder('F', 'p'); assert.deepEqual(JSON.parse(calls.at(-1).init.body), { name: 'F', mimeType: 'application/vnd.google-apps.folder', parents: ['p'] });
await d.move('f1', 'q'); assert.match(calls.at(-1).url, /addParents=q&removeParents=p/);
await d.trash('f1'); assert.equal(calls.at(-1).init.method, 'PATCH'); assert.deepEqual(JSON.parse(calls.at(-1).init.body), { trashed: true });
await assert.rejects(() => d.get('bad'), (e) => e.status === 403 && e.message === 'nope');
await d.signOut(); assert.equal(await d.isSignedIn(), false); assert.match(calls.at(-1).url, /oauth2\.googleapis\.com\/revoke/);
assert.throws(() => createDrive({ env: mk().d && { location: {}, sessionStorage: {}, crypto: globalThis.crypto } }).signIn(), /clientId/);
console.log('drive v' + (process.argv[2] || '0.1.0') + ' tests passed');
