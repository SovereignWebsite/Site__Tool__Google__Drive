import assert from 'node:assert/strict';
import { createRelayKeys, memoryStore, signerFromSpki, LABEL } from '../chat-staging/relay/relay-keys.mjs';
import { RSA_GEN, EC, seal, bundleOf, unpem } from '../chat-staging/relay/vendor/pki/v0.2.28/keys.js';
import { codeOf, compose, sealMessage, qrSealed, parseQrText } from '../chat-staging/relay/vendor/pki/v0.2.28/message.js';
const s = crypto.subtle, gen = { ...RSA_GEN, modulusLength: 2048 }; // 2048 only to keep the test quick; the page uses RSA_GEN (4096)
const fakeAuth = (avail = true) => { const log = []; return { log, available: async () => avail, create: async () => { log.push('create'); return new Uint8Array([1, 2, 3]); }, get: async () => { log.push('get'); } }; };
const wa = fakeAuth(), store = memoryStore(), rk = createRelayKeys({ store, label: LABEL('chat.google.tool.sovereignweb.site'), gen, webauthn: wa, rpId: 'x.example' });
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
  ['m1.garbage', /not a sealed/],
];
for (const [code, why] of fails) await assert.rejects(() => rk.openReadKey(id, code, [signer], { lane: 'for-dinis' }), why);
// signed with a different key than the trusted one, but claiming the trusted fingerprint: the signature does not check
const other = await s.generateKey(EC, true, ['sign', 'verify']);
const forged = await mk(JSON.stringify(secret), { signKey: new Uint8Array(await s.exportKey('pkcs8', other.privateKey)) });
await assert.rejects(() => rk.openReadKey(id, forged, [signer]), /signature does not check/);
// sealed to another page's key
const rk2 = createRelayKeys({ store: memoryStore(), label: 'x', gen, webauthn: fakeAuth(), rpId: 'x.example' }); const id2 = await rk2.identity();
const toOther = await mk(JSON.stringify(secret), { to: id2.bundle });
await assert.rejects(() => rk.openReadKey(id, toOther, [signer]), /another key/);
// a.maestro's way: compose + sealMessage (inner and envelope both signed), wrapped as pki.sgit.ai/qr/sealed/v1
const sbundle = await bundleOf(unpem(id.bundle.encrypt).der, spki, 'test signer'); assert.equal(sbundle.signing_fingerprint, signer.signing_fingerprint, 'same fingerprint rule');
const from = { bundle: sbundle, private: { sign: pk8 } };
const viaMessage = async (text, { f = from, to = id.bundle, at } = {}) => { const m = await compose({ to, from: f, text, ...(at ? { at } : {}) }); const { code } = await sealMessage(m, to, f); return qrSealed({ to: to.signing_fingerprint, from: f.bundle.signing_fingerprint, code }); };
const rk3 = createRelayKeys({ store: memoryStore(), label: 'x', gen, webauthn: fakeAuth(), rpId: 'x.example' }); const id3 = await rk3.identity();
assert.deepEqual(await rk3.openReadKey(id3, await viaMessage(JSON.stringify(secret), { to: id3.bundle }), [signer], { lane: 'for-dinis' }), { lane: 'for-dinis', vault_id: 'testvault1' });
assert.equal((await rk3.readKey('for-dinis')).enum_key, 'aa'.repeat(32));
const info3 = await rk3.publicInfo(); assert.equal(parseQrText(info3.qrText).kind, 'key'); assert.equal(parseQrText(info3.qrText).code, info3.k1);
const notJson = await viaMessage('not json', { to: id3.bundle });
await assert.rejects(() => rk3.openReadKey(id3, notJson, [signer]), /not a read-key/);
const imp = { bundle: { ...sbundle }, private: { sign: new Uint8Array(await s.exportKey('pkcs8', other.privateKey)) } }; // inner signature by another key, same claimed fingerprint
const innerBad = await (async () => { const m = await compose({ to: id3.bundle, from: imp, text: JSON.stringify(secret) }); const { code } = await sealMessage(m, id3.bundle, from); return qrSealed({ to: id3.bundle.signing_fingerprint, from: sbundle.signing_fingerprint, code }); })();
await assert.rejects(() => rk3.openReadKey(id3, innerBad, [signer]), /own signature does not check/);
await assert.rejects(() => rk3.openReadKey(id3, '{"v":1,"kind":"pki.sgit.ai/qr/sealed/v1","code":"x","extra":1}', [signer]), /not a sealed code/);
// the passkey lock: made on first use, asked once a session; no passkey on the device means no read key held
assert.deepEqual(wa.log, ['create'], 'one passkey made, then not asked again in the same session');
{ const w = fakeAuth(), st = memoryStore(), a = createRelayKeys({ store: st, label: 'x', gen, webauthn: w, rpId: 'x.example' }); await a.identity();
  assert.ok((await a.publicInfo()).k1, 'the public key shows without the passkey'); assert.deepEqual(w.log, []);
  assert.equal(await a.readKey('for-dinis'), null);
  assert.deepEqual(w.log, ['create'], 'reading the read key made the passkey first');
  const b = createRelayKeys({ store: st, label: 'x', gen, webauthn: w, rpId: 'x.example' }); await b.session(); assert.deepEqual(w.log, ['create', 'get'], 'a new session asks for it');
  const none = createRelayKeys({ store: memoryStore(), label: 'x', gen, webauthn: fakeAuth(false), rpId: 'x.example' }); await none.identity();
  await assert.rejects(() => none.readKey('for-dinis'), /no passkey/); await assert.rejects(() => none.session(), /no passkey/);
  const alone = createRelayKeys({ store: memoryStore(), label: 'x', gen, webauthn: fakeAuth(false), rpId: 'x.example', requirePasskey: false }); await alone.identity(); assert.equal(await alone.readKey('for-dinis'), null); }
console.log('relay keys tests passed');
