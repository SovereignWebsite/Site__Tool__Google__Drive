// node tools/test-relay.mjs : relay core against a test lane
import assert from 'node:assert/strict';
const { cleanItem, createRelay, memorySeen } = await import('../chat-staging/relay/relay-core.mjs');
const ok = { id: 'i1', title: 'Decide the Drive scope', link: 'https://example.org/decisions/1' };
const H = { hosts: ['example.org'] };
assert.throws(() => cleanItem(ok), /allow-list is required/); assert.throws(() => cleanItem(ok, { hosts: [] }), /allow-list is required/);
assert.equal(cleanItem(ok, H).text, 'Needs you: Decide the Drive scope https://example.org/decisions/1');
// only id, title and link are read: extra fields never reach the text
assert.equal(cleanItem({ ...ok, body: 'private', contact: 'a@b.co' }, H).text.includes('private'), false);
for (const [item, why] of [
  [{ ...ok, link: 'http://example.org/x' }, /https/], [{ ...ok, link: 'https://u:p@example.org/' }, /https/], [{ ...ok, link: 'javascript:alert(1)' }, /bad link|https/],
  [{ ...ok, title: 'mail a@b.co now' }, /contact/], [{ ...ok, title: 'call +44 7700 900123' }, /contact/], [{ ...ok, title: 'key ya29.' + 'a'.repeat(30) }, /secret/],
  [{ ...ok, title: '-----BEGIN PRIVATE KEY-----' }, /secret/], [{ ...ok, title: 'x'.repeat(141) }, /too long/], [{ ...ok, title: '  ' }, /no title/], [{ ...ok, id: '' }, /no id/],
  [{ ...ok, link: 'https://example.org/?t=sgit_vk1_abcdefgh' }, /query or fragment/], [{ ...ok, link: 'https://example.org/sgit_vk1_abcdefgh' }, /secret/]
]) assert.match(cleanItem(item, H).reason || 'POSTED', why, JSON.stringify(item));
assert.equal(cleanItem({ ...ok, link: 'https://evil.example/x' }, H).reason, 'link host not allowed');
assert.equal(cleanItem({ ...ok, link: 'https://example.org/d/1?token=abc' }, H).reason, 'link has a query or fragment');
assert.equal(cleanItem({ ...ok, link: 'https://example.org/d/1#k=abc' }, H).reason, 'link has a query or fragment');
assert.equal(cleanItem({ ...ok, link: 'https://example.org/d/1?id=7' }, { hosts: ['example.org'], queryOk: [{ host: 'example.org', pattern: /^\/d\/\d+\?id=\d+$/ }] }).text.endsWith('?id=7'), true);
assert.equal(cleanItem({ ...ok, link: 'https://example.org/d/1?id=7&x=y' }, { hosts: ['example.org'], queryOk: [{ host: 'example.org', pattern: /^\/d\/\d+\?id=\d+$/ }] }).reason, 'link has a query or fragment');
assert.equal(cleanItem({ ...ok, title: 'line1\nline2' + String.fromCharCode(0x2028) + 'x' }, H).text, 'Needs you: line1 line2 x https://example.org/decisions/1');
// relay: dedup, refusals not retried, rate limit leaves items for the next tick, failure keeps them unseen, pause
let t = 0; const posted = []; const lane = Array.from({ length: 7 }, (_, i) => ({ n: i }));
const items = lane.map((e) => ({ id: 'id' + e.n, title: 'Item ' + e.n, link: 'https://example.org/' + e.n }));
items[2] = { id: 'bad', title: 'mail me a@b.co', link: 'https://example.org/b' };
const r = createRelay({ post: async (x) => { posted.push(x); }, read: async () => lane, open: async (e) => items[e.n], seen: memorySeen(), hosts: ['example.org'], maxPerMinute: 3, now: () => t });
let o = await r.tick(); assert.equal(posted.length, 3); assert.equal(o.stopped, 'rate limit'); assert.equal(o.skipped[0].reason, 'looks like a contact detail');
o = await r.tick(); assert.equal(posted.length, 3, 'still limited within the minute'); t += 61000;
o = await r.tick(); assert.equal(posted.length, 6); assert.equal(posted.filter((x) => x.includes('Item 0')).length, 1, 'no repeat'); assert.equal(posted.some((x) => x.includes('a@b.co')), false);
t += 61000; o = await r.tick(); assert.equal(posted.length, 6); assert.equal(o.stopped, null);
let fail = true; const p2 = []; const r2 = createRelay({ post: async (x) => { if (fail) { const e = new Error('x'); e.status = 403; throw e; } p2.push(x); }, read: async () => [{ n: 0 }], open: async (e) => items[e.n], seen: memorySeen(), hosts: ['example.org'] });
o = await r2.tick(); assert.match(o.stopped, /403/); fail = false; o = await r2.tick(); assert.equal(p2.length, 1, 'a failed post is retried, not lost');
r2.pause(); assert.equal((await r2.tick()).stopped, 'paused');
const r3 = createRelay({ post: async () => {}, read: async () => [{ n: 0 }, { n: 1 }], open: async () => { throw new Error('bad sig'); }, seen: memorySeen(), hosts: ['example.org'] });
assert.equal((await r3.tick()).skipped[0].reason, 'not openable');
assert.throws(() => createRelay({ post: async () => {}, read: async () => [], open: async () => null, seen: memorySeen() }), /allow-list is required/);
// a first run (or a lost store) only baselines: nothing existing is posted, then new items post
{ const st = (() => { let i = false; return { isInitialised: async () => i, markInitialised: async () => { i = true; } }; })(); const sn = memorySeen(); const lane2 = [{ n: 0 }, { n: 1 }]; const pp = [];
  const rr = createRelay({ post: async (x) => { pp.push(x); }, read: async () => lane2, open: async (e) => ({ id: 'q' + e.n, title: 'T' + e.n, link: 'https://example.org/q' + e.n }), seen: sn, hosts: ['example.org'], state: st });
  const o1 = await rr.tick(); assert.equal(pp.length, 0); assert.equal(o1.baseline, 2); assert.match(o1.stopped, /baseline/);
  lane2.push({ n: 2 }); await rr.tick(); assert.deepEqual(pp, ['Needs you: T2 https://example.org/q2']); }
{ const { createRelayState } = await import('../chat-staging/relay/relay-state.mjs'); const { memoryStore } = await import('../chat-staging/relay/relay-keys.mjs');
  const st = memoryStore(), a = createRelayState(st); assert.equal(await a.state.isInitialised(), false); await a.state.markInitialised(); await a.seen.add('h1'); await a.chains.set('k', { seq: 2 });
  const b = createRelayState(st); assert.equal(await b.state.isInitialised(), true); assert.equal(await b.seen.has('h1'), true); assert.equal(await b.seen.has('h2'), false); assert.deepEqual(await b.chains.get('k'), { seq: 2 });
  const lost = createRelayState(memoryStore()); assert.equal(await lost.state.isInitialised(), false, 'a lost store starts over with a baseline, not a replay'); }
console.log('relay tests passed');
