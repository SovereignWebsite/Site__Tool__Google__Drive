// Tests for chat.mjs with a mocked Google Chat. Run: node tools/api-build.mjs chat 0.1.0 chat-staging && node tools/test-chat.mjs
import assert from 'node:assert/strict';
const { createChat, SCOPES, ChatError } = await import('../chat-staging/v0.1.0/chat.mjs');
const calls = [];
const ss = new Map(); const loc = { origin: 'https://c.example', pathname: '/cb/', search: '', hash: '', assign(u) { loc.went = u; } };
const env = { indexedDB: undefined, crypto: globalThis.crypto, location: loc, history: { replaceState() { loc.hash = ''; } },
  sessionStorage: { getItem: (k) => ss.get(k) ?? null, setItem: (k, v) => ss.set(k, v), removeItem: (k) => ss.delete(k) },
  fetch: async (url, init = {}) => { calls.push({ url: String(url), init }); const ok = !String(url).includes('forbidden'); return { ok, status: ok ? 200 : 403, json: async () => ok ? { spaces: [], messages: [], name: 'spaces/A/messages/1' } : { error: { message: 'no access' } } }; } };
const c = createChat({ clientId: 'cid', env });
assert.deepEqual(c.scope.split(' ').sort(), Object.values(SCOPES).sort());
await assert.rejects(() => c.listSpaces(), (e) => e instanceof ChatError && e.status === 401);
c.signIn(); const u = new URL(loc.went); assert.equal(u.searchParams.get('response_type'), 'token'); assert.equal(u.searchParams.get('scope'), c.scope);
loc.hash = `#access_token=T&expires_in=3599&state=${u.searchParams.get('state')}`; assert.equal((await c.handleRedirect()).fresh, true);
await c.listSpaces(); assert.match(calls.at(-1).url, /^https:\/\/chat\.googleapis\.com\/v1\/spaces\?pageSize=100$/); assert.equal(calls.at(-1).init.headers.Authorization, 'Bearer T');
await c.listMessages('spaces/AAA', { since: '2026-11-25T10:00:00Z', thread: 'spaces/AAA/threads/T1' });
const m = new URL(calls.at(-1).url); assert.equal(m.pathname, '/v1/spaces/AAA/messages'); assert.equal(m.searchParams.get('orderBy'), 'createTime desc');
assert.equal(m.searchParams.get('filter'), 'thread.name = spaces/AAA/threads/T1 AND createTime > "2026-11-25T10:00:00Z"');
await c.post('AAA', 'hello'); assert.equal(calls.at(-1).init.method, 'POST'); assert.deepEqual(JSON.parse(calls.at(-1).init.body), { text: 'hello' }); assert.ok(!calls.at(-1).url.includes('messageReplyOption'));
await c.reply('spaces/AAA', 'spaces/AAA/threads/T1', 'ok'); assert.deepEqual(JSON.parse(calls.at(-1).init.body), { text: 'ok', thread: { name: 'spaces/AAA/threads/T1' } }); assert.match(calls.at(-1).url, /messageReplyOption=REPLY_MESSAGE_FALLBACK_TO_NEW_THREAD/);
const n = calls.length;
for (const bad of [() => c.post('spaces/../x', 'a'), () => c.post('AAA', '  '), () => c.post('AAA', 'x'.repeat(4097)), () => c.post('AAA', 'a', { thread: 'spaces/AAA/threads/T?x' }), () => c.listMessages('AAA', { since: '2026-11-25"' }), () => c.listMessages('AAA', { thread: 'x or y' })])
  assert.throws(bad, (e) => e instanceof ChatError && e.status === 400);
assert.equal(calls.length, n, 'a bad input never reaches Google');
await assert.rejects(() => c.listMessages('forbidden'), (e) => e.status === 403 && e.message === 'no access');
console.log('chat tests passed');
