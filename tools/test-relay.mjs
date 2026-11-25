// node tools/test-relay.mjs : relay core against a test lane
import assert from 'node:assert/strict';
const { cleanItem, createRelay, memorySeen } = await import('../chat-staging/relay/relay-core.mjs');
const ok = { id: 'i1', title: 'Decide the Drive scope', link: 'https://example.org/decisions/1' };
assert.equal(cleanItem(ok).text, 'Needs you: Decide the Drive scope https://example.org/decisions/1');
// only id, title and link are read: extra fields never reach the text
assert.equal(cleanItem({ ...ok, body: 'private', contact: 'a@b.co' }).text.includes('private'), false);
for (const [item, why] of [
  [{ ...ok, link: 'http://example.org/x' }, /https/], [{ ...ok, link: 'https://u:p@example.org/' }, /https/], [{ ...ok, link: 'javascript:alert(1)' }, /bad link|https/],
  [{ ...ok, title: 'mail a@b.co now' }, /contact/], [{ ...ok, title: 'call +44 7700 900123' }, /contact/], [{ ...ok, title: 'key ya29.' + 'a'.repeat(30) }, /secret/],
  [{ ...ok, title: '-----BEGIN PRIVATE KEY-----' }, /secret/], [{ ...ok, title: 'x'.repeat(141) }, /too long/], [{ ...ok, title: '  ' }, /no title/], [{ ...ok, id: '' }, /no id/],
  [{ ...ok, link: 'https://example.org/?t=sgit_vk1_abcdefgh' }, /secret/]
]) assert.match(cleanItem(item).reason || 'POSTED', why, JSON.stringify(item));
assert.equal(cleanItem({ ...ok, link: 'https://evil.example/x' }, { hosts: ['example.org'] }).reason, 'link host not allowed');
assert.equal(cleanItem({ ...ok, title: 'line1\nline2 x' }).text, 'Needs you: line1 line2 x https://example.org/decisions/1');
// relay: dedup, refusals not retried, rate limit leaves items for the next tick, failure keeps them unseen, pause
let t = 0; const posted = []; const lane = Array.from({ length: 7 }, (_, i) => ({ n: i }));
const items = lane.map((e) => ({ id: 'id' + e.n, title: 'Item ' + e.n, link: 'https://example.org/' + e.n }));
items[2] = { id: 'bad', title: 'mail me a@b.co', link: 'https://example.org/b' };
const r = createRelay({ post: async (x) => { posted.push(x); }, read: async () => lane, open: async (e) => items[e.n], seen: memorySeen(), maxPerMinute: 3, now: () => t });
let o = await r.tick(); assert.equal(posted.length, 3); assert.equal(o.stopped, 'rate limit'); assert.equal(o.skipped[0].reason, 'looks like a contact detail');
o = await r.tick(); assert.equal(posted.length, 3, 'still limited within the minute'); t += 61000;
o = await r.tick(); assert.equal(posted.length, 6); assert.equal(posted.filter((x) => x.includes('Item 0')).length, 1, 'no repeat'); assert.equal(posted.some((x) => x.includes('a@b.co')), false);
t += 61000; o = await r.tick(); assert.equal(posted.length, 6); assert.equal(o.stopped, null);
let fail = true; const p2 = []; const r2 = createRelay({ post: async (x) => { if (fail) { const e = new Error('x'); e.status = 403; throw e; } p2.push(x); }, read: async () => [{ n: 0 }], open: async (e) => items[e.n], seen: memorySeen() });
o = await r2.tick(); assert.match(o.stopped, /403/); fail = false; o = await r2.tick(); assert.equal(p2.length, 1, 'a failed post is retried, not lost');
r2.pause(); assert.equal((await r2.tick()).stopped, 'paused');
const r3 = createRelay({ post: async () => {}, read: async () => [{ n: 0 }, { n: 1 }], open: async () => { throw new Error('bad sig'); }, seen: memorySeen() });
assert.equal((await r3.tick()).skipped[0].reason, 'not openable');
console.log('relay tests passed');
