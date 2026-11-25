// lane.entry/2 reader against the owners' vectors. Fetch the vectors first (they hold throwaway keys, so they are not kept in this repository):
//   curl -sSo /tmp/entry-v2-vectors.json https://raw.githubusercontent.com/VoiceDebrief/VoiceDebrief__App__iOS/520cd834828c7447f1483e83e05ffc3b93afd0d1/website/lanes/entry-v2/vectors.json
//   node tools/test-lane.mjs /tmp/entry-v2-vectors.json
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const { checkEntry, readEntry, readChain, openPayload, canonical, hashOf, LaneError } = await import('../chat-staging/relay/lane-entry-v2.mjs');
const v = JSON.parse(readFileSync(process.argv[2], 'utf8')), te = new TextEncoder();
const b64 = (s) => Uint8Array.from(Buffer.from(s, 'base64'));
const rsa = await crypto.subtle.importKey('pkcs8', b64(v.keys.recipient_rsa_private_pkcs8_b64), { name: 'RSA-OAEP', hash: 'SHA-256' }, false, ['decrypt']);
const trusted = new Set([v.keys.author_key_id]);
let pos = 0, neg = 0;
for (const c of v.canonical) { assert.equal(canonical(c.value), c.text, c.why); pos++; }
for (const p of v.positive) {
  if (p.entry) { const r = await checkEntry(p.entry, { trusted }); assert.equal(r.hash, p.hash, p.name); }
  else if (p.chain) await readChain(p.chain, { trusted });
  else { const r = await (async () => readEntry(await openPayload(p.payload, rsa), { trusted }))(); assert.equal(r.hash, p.opens_to_hash, p.name); }
  pos++;
}
for (const n of v.negative) {
  const run = n.payload ? async () => readEntry(await openPayload(n.payload, rsa), { trusted }) : n.chain ? () => readChain(n.chain, { trusted: new Set(n.chain.map((e) => e.author.key)) }) : () => checkEntry(n.entry, { trusted });
  await assert.rejects(run, (e) => e instanceof LaneError && e.code === n.code, `${n.name}: expected ${n.code}`); neg++;
}
// extra: an author key this reader does not trust is refused even when everything verifies
await assert.rejects(() => checkEntry(v.positive[0].entry, { trusted: new Set(['p256:' + '0'.repeat(64)]) }), (e) => e.code === 'E_KEY');
console.log(`lane.entry/2 reader: ${pos} positive accepted, ${neg} negative refused with the right code`);
