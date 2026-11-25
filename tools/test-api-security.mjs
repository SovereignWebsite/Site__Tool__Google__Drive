// security.b's conditions on the Drive and Chat modules (25 Nov 2026): node tools/test-api-security.mjs
import assert from 'node:assert/strict';
const { createDrive, SCOPES, DriveError } = await import('../site/api/v0.3.0/drive.mjs');
const { createChat, RELAY_SCOPES } = await import('../chat-staging/v0.1.0/chat.mjs');
const calls = [];
const mk = (create, opts = {}, hash = '') => {
  const ss = new Map(); const loc = { origin: 'https://x.example', pathname: '/cb/', search: '', hash, assign(u) { loc.went = u; } };
  const env = { indexedDB: undefined, crypto: globalThis.crypto, location: loc, history: { replaceState() { loc.hash = ''; } }, sessionStorage: { getItem: (k) => ss.get(k) ?? null, setItem: (k, v) => ss.set(k, v), removeItem: (k) => ss.delete(k), keys: () => [...ss.keys()] },
    fetch: async (url, init = {}) => { calls.push({ url: String(url), init }); return { ok: true, status: 200, json: async () => ({ files: [], id: 'n' }), arrayBuffer: async () => new ArrayBuffer(0) }; } };
  return { d: create({ clientId: 'cid', env, ...opts }), loc, ss };
};
const signIn = async ({ d, loc }, extra = '') => { d.signIn(); const st = new URL(loc.went).searchParams.get('state'); loc.hash = `#access_token=T&expires_in=3599&state=${st}${extra}`; return d.handleRedirect(); };
// 2. no include_granted_scopes in the request
{ const m = mk(createDrive); m.d.signIn(); assert.equal(new URL(m.loc.went).searchParams.has('include_granted_scopes'), false); }
// 2. a token wider than asked is refused and not stored
{ const m = mk(createDrive, { scope: SCOPES.file }); await assert.rejects(() => signIn(m, '&scope=' + encodeURIComponent(SCOPES.file + ' ' + SCOPES.full)), /more access than was asked/); assert.equal(await m.d.isSignedIn(), false); }
{ const m = mk(createDrive, { scope: SCOPES.file }); assert.equal((await signIn(m, '&scope=' + encodeURIComponent(SCOPES.file))).fresh, true); }
// 1. token() is off unless exposeToken is set
{ const m = mk(createDrive); await signIn(m); await assert.rejects(() => m.d.token(), /token\(\) is off/); }
{ const m = mk(createDrive, { exposeToken: true }); await signIn(m); assert.equal(await m.d.token(), 'T'); }
// 7. upload type: no line breaks, must be type/subtype
{ const m = mk(createDrive); await signIn(m);
  for (const bad of ['text/plain\r\nX-Evil: 1', 'text\nplain', 'nonsense', 'a/b\r\n', '/x', 'text/']) await assert.rejects(() => m.d.upload('x', { name: 'n', type: bad }), (e) => e instanceof DriveError && e.status === 400, bad);
  await m.d.upload('x', { name: 'n', type: 'text/plain; charset=utf-8' }); await m.d.upload('x', { name: 'n' }); }
// 10. revoke: the token is in the body, never in the URL
{ const m = mk(createDrive); await signIn(m); await m.d.signOut(); const c = calls.at(-1); assert.equal(c.url, 'https://oauth2.googleapis.com/revoke'); assert.equal(c.init.body, 'token=T'); assert.ok(!c.url.includes('T=') && !c.url.includes('token')); }
// 9. namespaced by module: the sign-in state of Drive is not Chat's
{ const a = mk(createDrive), b = mk(createChat); a.d.signIn(); b.d.signIn(); assert.deepEqual([...a.ss.keys()], ['sw-drive-state']); assert.deepEqual([...b.ss.keys()], ['sw-chat-state']); }
// relay scopes: create and find a space only, nothing to read messages
assert.deepEqual(RELAY_SCOPES.map((s) => s.split('/').pop()).sort(), ['chat.messages.create', 'chat.spaces.readonly']);
{ const m = mk(createChat, { scope: RELAY_SCOPES }); m.d.signIn(); assert.ok(!new URL(m.loc.went).searchParams.get('scope').includes('messages.readonly')); }
console.log('security tests passed');
