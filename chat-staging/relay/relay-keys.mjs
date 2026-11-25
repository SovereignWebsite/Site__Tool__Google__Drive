// The relay page's own browser key (option a, docs/chat-plan.md), and the lane's read key kept sealed to it.
// Shape and format follow the CRM's You page (Site__Tool__CRM site/app/pki.js and me.js, Apache-2.0, by crm.dev.a), using the
// same vendored sgit pki code, so the public half is the same k1 string and a sealed code is the same m1 code:
//   RSA-OAEP 4096 (opens things sealed to the page) and ECDSA P-256 (signs), both private halves NOT extractable, kept in IndexedDB.
// The private halves never leave the browser. The read key is kept only sealed to the page's own public key.
import { bundleOf, seal, parseEnvelope, unb64, verifyBytes, RSA_GEN, EC, fingerprint } from './vendor/pki/v0.2.28/keys.js';
import { keyCode, parseCode } from './vendor/pki/v0.2.28/message.js';

export const LABEL = (host) => 'Chat relay, ' + host;
const IDENTITY = 'page-identity', SECRET = 'secret:';

// Default store: this browser's IndexedDB (a { get, put, del } with async methods). Tests pass an in-memory one.
export function idbStore(name = 'chat-relay') {
  const open = () => new Promise((ok, no) => { const r = indexedDB.open(name, 1); r.onupgradeneeded = () => r.result.createObjectStore('kv'); r.onsuccess = () => ok(r.result); r.onerror = () => no(r.error); });
  const run = async (mode, fn) => { const d = await open(); return new Promise((ok, no) => { const tx = d.transaction('kv', mode), req = fn(tx.objectStore('kv')); tx.oncomplete = () => ok(req?.result); tx.onerror = () => no(tx.error); }); };
  return { get: (k) => run('readonly', (s) => s.get(k)), put: (k, v) => run('readwrite', (s) => s.put(v, k)), del: (k) => run('readwrite', (s) => s.delete(k)) };
}
export const memoryStore = () => { const m = new Map(); return { get: async (k) => m.get(k), put: async (k, v) => { m.set(k, v); }, del: async (k) => { m.delete(k); } }; };

// createRelayKeys({ store, label, gen, subtle })
export function createRelayKeys({ store, label, gen = RSA_GEN, subtle = globalThis.crypto.subtle } = {}) {
  const existing = async () => { const h = await store.get(IDENTITY).catch(() => null); return h?.bundle && h.encrypt && h.sign ? h : null; };
  async function identity() {
    const have = await existing(); if (have) return have;
    const enc = await subtle.generateKey(gen, false, ['encrypt', 'decrypt']), sig = await subtle.generateKey(EC, false, ['sign', 'verify']);
    const id = { bundle: await bundleOf(new Uint8Array(await subtle.exportKey('spki', enc.publicKey)), new Uint8Array(await subtle.exportKey('spki', sig.publicKey)), label),
      encrypt: enc.privateKey, sign: sig.privateKey, created: new Date().toISOString() };
    await store.put(IDENTITY, id); return id;
  }
  // unseal with the page's private key (a CryptoKey: it has no bytes to read). Mirrors keys.js unseal.
  async function unsealWith(privateKey, enc, signerBundles = []) {
    const env = parseEnvelope(enc); let raw;
    try { raw = await subtle.decrypt({ name: 'RSA-OAEP' }, privateKey, unb64(env.w)); } catch { throw new Error("not sealed to this page's key"); }
    const aes = await subtle.importKey('raw', raw, { name: 'AES-GCM' }, false, ['decrypt']); let bytes;
    try { bytes = new Uint8Array(await subtle.decrypt({ name: 'AES-GCM', iv: unb64(env.i), tagLength: 128 }, aes, unb64(env.c))); } catch { throw new Error('changed on the way: the ciphertext does not check'); }
    const out = { text: new TextDecoder('utf-8', { fatal: true }).decode(bytes), signed: !!(env.s && env.f), signer: env.f || null, verified: null };
    if (out.signed) { const b = signerBundles.find((x) => x && x.signing_fingerprint === env.f); if (b) out.verified = await verifyBytes(b.sign, unb64(env.s), unb64(env.c)); }
    return out;
  }
  const kept = {
    async keep(id, name, text) { await store.put(SECRET + name, { enc: await seal(id.bundle, String(text)), saved: new Date().toISOString() }); },
    async recall(id, name) { const s = await store.get(SECRET + name); return s ? (await unsealWith(id.encrypt, s.enc)).text : null; },
    forget: (name) => store.del(SECRET + name)
  };
  return {
    existing, identity, unsealWith, ...kept,
    // What Dinis sends to a.maestro: the k1 string, and both fingerprints written "sha256:xxxx" (first 16 hex of each SPKI hash).
    async publicInfo() { const id = await identity(); return { k1: keyCode(id.bundle).code, label: id.bundle.label, encFp: id.bundle.fingerprint, signFp: id.bundle.signing_fingerprint }; },
    // openReadKey(id, sealedText, signers): an m1 code sealed to this page and SIGNED by a trusted signer ({ sign: PEM, signing_fingerprint }).
    // The plaintext must be {"kind":"lane-read-key","lane","vault_id","enum_key"}. Returns { lane, vault_id, enum_key }; keeps it sealed under "read-key:<lane>".
    async openReadKey(id, sealedText, signers, { lane } = {}) {
      const c = parseCode(sealedText); if (!c) throw new Error('that is not a sealed m1 code');
      if (c.to !== id.bundle.signing_fingerprint && c.to !== id.bundle.fingerprint) throw new Error("sealed to another key, not this page's");
      const signer = signers.find((s) => s.signing_fingerprint === c.signer);
      if (!c.signer || !signer) throw new Error('not signed by a signer this page trusts');
      const opened = await unsealWith(id.encrypt, c.enc, [signer]);
      if (opened.verified !== true) throw new Error("the signature does not check");
      let g; try { g = JSON.parse(opened.text); } catch { throw new Error('not a read-key message'); }
      if (!g || g.kind !== 'lane-read-key' || typeof g.lane !== 'string' || typeof g.vault_id !== 'string' || typeof g.enum_key !== 'string' || !g.enum_key) throw new Error('not a read-key message');
      if (lane && g.lane !== lane) throw new Error('that read key is for another lane');
      await kept.keep(id, 'read-key:' + g.lane, JSON.stringify({ vault_id: g.vault_id, enum_key: g.enum_key }));
      return { lane: g.lane, vault_id: g.vault_id };
    },
    async readKey(lane) { const id = await existing(); if (!id) return null; const t = await kept.recall(id, 'read-key:' + lane); return t ? JSON.parse(t) : null; }
  };
}
// A trusted signer from a lane.entry/2-style author key: the base64url SPKI of a P-256 key. Its key id must match what the owner gave.
export async function signerFromSpki(spkiB64u, expectedKeyId, subtle = globalThis.crypto.subtle) {
  const der = Uint8Array.from(atob(spkiB64u.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((spkiB64u.length + 3) % 4)), (c) => c.charCodeAt(0));
  const id = 'p256:' + [...new Uint8Array(await subtle.digest('SHA-256', der))].map((b) => b.toString(16).padStart(2, '0')).join('');
  if (id !== expectedKeyId) throw new Error('the key does not match its id');
  const pem = '-----BEGIN PUBLIC KEY-----\n' + btoa(String.fromCharCode(...der)).match(/.{1,64}/g).join('\n') + '\n-----END PUBLIC KEY-----\n';
  return { sign: pem, signing_fingerprint: 'sha256:' + id.slice(5, 21), label: 'trusted author ' + id.slice(0, 17) };
}
