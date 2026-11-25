import assert from 'node:assert/strict';
import { createRelayKeys, memoryStore, signerFromSpki, LABEL } from '../chat-staging/relay/relay-keys.mjs';
import { RSA_GEN, EC, seal } from '../chat-staging/relay/vendor/pki/v0.2.28/keys.js';
import { codeOf } from '../chat-staging/relay/vendor/pki/v0.2.28/message.js';
const s = crypto.subtle, gen = { ...RSA_GEN, modulusLength: 2048 }; // 2048 only to keep the test quick; the page uses RSA_GEN (4096)
const store = memoryStore(), rk = createRelayKeys({ store, label: LABEL('chat.google.tool.sovereignweb.site'), gen });
assert.equal(await rk.existing(), null);
const id = await rk.identity(); assert.equal((await rk.identity()).bundle.fingerprint, id.bundle.fingerprint, 'made once, then reused');
assert.equal(id.encrypt.extractable, false); assert.equal(id.sign.extractable, false);
await assert.rejects(() => s.exportKey('pkcs8', id.encrypt));
const info = await rk.publicInfo();
assert.match(info.k1, /^k1\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/); assert.match(info.encFp, /^sha256:[0-9a-f]{16}$/); assert.match(info.signFp, /^sha256:[0-9a-f]{16}$/);
assert.equal(Buffer.from(info.k1.split('.')[3], 'base64url').toString(), 'Chat relay, chat.google.tool.sovereignweb.site');
// the sender: a P-256 signing key like a.maestro's, and a signed m1 code sealed to this page
const sk = await s.generateKey(EC, true, ['sign', 'verify']); const spki = new Uint8Array(await s.exportKey('spki', sk.publicKey));
const spkiB64u = Buffer.from(spki).toString('base64url'), keyId = 'p256:' + Buffer.from(await s.digest('SHA-256', spki)).toString('hex');
const signer = await signerFromSpki(spkiB64u, keyId); await assert.rejects(() => signerFromSpki(spkiB64u, 'p256:' + '0'.repeat(64)), /does not match/);
const secret = { kind: 'lane-read-key', lane: 'for-dinis', vault_id: 'testvault1', enum_key: 'aa'.repeat(32) };
const pk8 = new Uint8Array(await s.exportKey('pkcs8', sk.privateKey));
const mk = async (text, { signKey = pk8, fp = signer.signing_fingerprint, to = id.bundle } = {}) => codeOf(await seal(to, text, signKey ? { sign: signKey, fingerprint: fp } : null), to.signing_fingerprint);
const good = await mk(JSON.stringify(secret));
assert.deepEqual(await rk.openReadKey(id, good, [signer], { lane: 'for-dinis' }), { lane: 'for-dinis', vault_id: 'testvault1' });
assert.deepEqual(await rk.readKey('for-dinis'), { vault_id: 'testvault1', enum_key: 'aa'.repeat(32) });
assert.ok(!JSON.stringify(await store.get('secret:read-key:for-dinis')).includes('aa'.repeat(32)), 'the read key is stored sealed, not in clear');
const fails = [
  [await mk(JSON.stringify(secret), { signKey: null }), /not signed/],                                             // unsigned
  [await mk(JSON.stringify(secret), { fp: 'sha256:' + '1'.repeat(16) }), /not signed by a signer/],                // signed by someone unknown
  [await mk(JSON.stringify({ ...secret, kind: 'other' })), /not a read-key/],
  [await mk(JSON.stringify({ ...secret, lane: 'elsewhere' })), /another lane/],
  [await mk('not json'), /not a read-key/],
  ['m1.garbage', /not a sealed m1/],
];
for (const [code, why] of fails) await assert.rejects(() => rk.openReadKey(id, code, [signer], { lane: 'for-dinis' }), why);
// signed with a different key than the trusted one, but claiming the trusted fingerprint: the signature does not check
const other = await s.generateKey(EC, true, ['sign', 'verify']);
const forged = await mk(JSON.stringify(secret), { signKey: new Uint8Array(await s.exportKey('pkcs8', other.privateKey)) });
await assert.rejects(() => rk.openReadKey(id, forged, [signer]), /signature does not check/);
// sealed to another page's key
const rk2 = createRelayKeys({ store: memoryStore(), label: 'x', gen }); const id2 = await rk2.identity();
const toOther = await mk(JSON.stringify(secret), { to: id2.bundle });
await assert.rejects(() => rk.openReadKey(id, toOther, [signer]), /another key/);
console.log('relay keys tests passed');
