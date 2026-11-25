// The lane opener and relay together, with a test lane made here (test keys generated in memory, never stored).
import assert from 'node:assert/strict';
const { createOpener, memoryChains } = await import('../chat-staging/relay/lane-opener.mjs');
const { createRelay, memorySeen } = await import('../chat-staging/relay/relay-core.mjs');
const { canonical } = await import('../chat-staging/relay/lane-entry-v2.mjs');
const s = crypto.subtle, te = new TextEncoder();
const b64 = (u) => Buffer.from(u).toString('base64'), b64u = (u) => Buffer.from(u).toString('base64url'), hex = (b) => Buffer.from(b).toString('hex');
const rsa = await s.generateKey({ name: 'RSA-OAEP', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' }, false, ['encrypt', 'decrypt']);
const mkAuthor = async (id) => { const k = await s.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign']); const der = new Uint8Array(await s.exportKey('spki', k.publicKey)); return { id, k, der, key: 'p256:' + hex(await s.digest('SHA-256', der)) }; };
const sha = async (o) => 'sha256:' + hex(await s.digest('SHA-256', te.encode(canonical(o))));
const seal = async (entry) => { const aes = await s.generateKey({ name: 'AES-GCM', length: 256 }, true, ['encrypt']); const iv = crypto.getRandomValues(new Uint8Array(12));
  const c = new Uint8Array(await s.encrypt({ name: 'AES-GCM', iv }, aes, te.encode(canonical(entry)))); const w = new Uint8Array(await s.encrypt({ name: 'RSA-OAEP' }, rsa.publicKey, await s.exportKey('raw', aes)));
  return b64(te.encode(JSON.stringify({ v: 2, w: b64(w), i: b64(iv), c: b64(c) }))); };
const writer = (a, lane) => { let seq = 0, prev = null; return async (type, body, tweak = (e) => e) => { const e = { schema: 'lane.entry/2', lane, author: { id: a.id, key: a.key, spki: b64u(a.der) }, seq: ++seq, prev, at: '2026-11-25T16:30:00Z', type, body, refs: [], blobs: [] };
  tweak(e); e.proof = { alg: 'ES256', sig: b64u(new Uint8Array(await s.sign({ name: 'ECDSA', hash: 'SHA-256' }, a.k.privateKey, te.encode(canonical(e))))) }; prev = await sha(e); return seal(e); }; };
const agent = await mkAuthor('agent:a.test'), stranger = await mkAuthor('agent:stranger');
const w = writer(agent, 'for-dinis'), ws = writer(stranger, 'for-dinis'), wo = writer(agent, 'other-lane');
const lane = [
  await w('needs-you', { title: 'Decide the Drive scope', link: 'https://example.org/d/1' }),
  await ws('needs-you', { title: 'Send me your keys', link: 'https://evil.example/' }),          // not a trusted author
  await w('chat', { title: 'wrong type', link: 'https://example.org/x' }),                        // wrong type
  await w('needs-you', { title: 'extra field', link: 'https://example.org/y', secret: 'x' }),     // body not exactly title and link
  await w('needs-you', { title: 'Answer a.mail about the draft', link: 'https://example.org/d/2' }),
];
const refused = []; const posted = [];
const opener = createOpener({ rsaPrivateKey: rsa.privateKey, trusted: new Set([agent.key]), lane: 'for-dinis', chains: memoryChains(), onRefuse: (c) => refused.push(c) });
const relay = createRelay({ post: async (t) => { posted.push(t); }, read: async () => lane, open: opener, seen: memorySeen(), hosts: ['example.org'], maxPerMinute: 10 });
await relay.tick();
assert.deepEqual(posted, ['Needs you: Decide the Drive scope https://example.org/d/1', 'Needs you: Answer a.mail about the draft https://example.org/d/2']); // the wrong type and the extra field are refused but do not block the chain
assert.deepEqual(refused, ['E_KEY', 'E_FIELD', 'E_FIELD']);
// a clean lane: two good entries, a replayed copy, a wrong-lane entry, a wrong-recipient payload
const w2 = writer(agent, 'for-dinis'); const a1 = await w2('needs-you', { title: 'One', link: 'https://example.org/1' }), a2 = await w2('needs-you', { title: 'Two', link: 'https://example.org/2' });
const o2 = createOpener({ rsaPrivateKey: rsa.privateKey, trusted: new Set([agent.key]), lane: 'for-dinis', chains: memoryChains(), onRefuse: (c) => refused.push('2:' + c) });
const p2 = []; const r2 = createRelay({ post: async (t) => { p2.push(t); }, read: async () => [a1, a1, a2, await wo('needs-you', { title: 'Elsewhere', link: 'https://example.org/e' }), 'bm90IGFuIGVudmVsb3Bl'], open: o2, seen: memorySeen(), hosts: ['example.org'], maxPerMinute: 10 });
await r2.tick(); assert.deepEqual(p2, ['Needs you: One https://example.org/1', 'Needs you: Two https://example.org/2']);
assert.deepEqual(refused.slice(3), ['2:E_CHAIN', '2:E_FIELD', '2:E_PAYLOAD'], 'a replayed copy is refused by the chain; another lane and junk are refused');
const other = await s.generateKey({ name: 'RSA-OAEP', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' }, false, ['encrypt', 'decrypt']);
const o3 = createOpener({ rsaPrivateKey: other.privateKey, trusted: new Set([agent.key]), lane: 'for-dinis', chains: memoryChains(), onRefuse: (c) => refused.push('3:' + c) });
assert.equal(await o3(a1), null); assert.equal(refused.at(-1), '3:E_ENVELOPE');
console.log('opener tests passed');
