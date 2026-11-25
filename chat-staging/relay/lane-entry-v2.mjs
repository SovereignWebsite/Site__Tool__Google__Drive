// lane.entry/2 reader (browser or Node 20+, WebCrypto only). Written against the final spec and vectors:
// https://github.com/VoiceDebrief/VoiceDebrief__App__iOS/blob/dc559079baf332c99e5451ac8f6677f9d3ef2048/website/lanes/entry-v2/index.md
// It reads: it never writes or signs. Order of checks follows the spec: E_PAYLOAD, E_ENVELOPE, E_CANONICAL, E_NUMBER, E_SCHEMA,
// E_FIELD, E_KEY, E_SIG, E_BLOB, E_CHAIN. An entry refused at any step is not acted on.
const subtle = globalThis.crypto.subtle, te = new TextEncoder(), td = new TextDecoder();
export class LaneError extends Error { constructor(code, why) { super(code + (why ? ': ' + why : '')); this.name = 'LaneError'; this.code = code; } }
const fail = (c, w) => { throw new LaneError(c, w); };
const hex = (b) => [...new Uint8Array(b)].map((x) => x.toString(16).padStart(2, '0')).join('');
const STD = /^[A-Za-z0-9+/]*={0,2}$/, URL64 = /^[A-Za-z0-9_-]*$/;
const fromB64 = (s) => { if (typeof s !== 'string' || s.length % 4 || !STD.test(s)) throw 0; return Uint8Array.from(atob(s), (c) => c.charCodeAt(0)); };
const fromB64u = (s) => { if (typeof s !== 'string' || !URL64.test(s)) throw 0; return Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((s.length + 3) % 4)), (c) => c.charCodeAt(0)); };
const sortKeys = (v) => Array.isArray(v) ? v.map(sortKeys) : v && typeof v === 'object' ? Object.fromEntries(Object.keys(v).sort().map((k) => [k, sortKeys(v[k])])) : v;
export const canonical = (v) => JSON.stringify(sortKeys(v));
export const hashOf = async (bytes) => 'sha256:' + hex(await subtle.digest('SHA-256', bytes));

// openPayload(payloadB64, rsaPrivateKey) -> the entry's bytes. rsaPrivateKey is a CryptoKey for RSA-OAEP SHA-256 (usage decrypt).
export async function openPayload(payload, rsaPrivateKey) {
  let text; try { text = td.decode(fromB64(payload)); } catch { return fail('E_PAYLOAD', 'not base64'); }
  let env; try { env = JSON.parse(text); } catch { return fail('E_PAYLOAD', 'not an envelope (a second base64 layer?)'); }
  if (!env || typeof env !== 'object' || Array.isArray(env)) return fail('E_PAYLOAD', 'not an envelope');
  const ks = Object.keys(env).sort().join(',');
  if (env.v !== 2 || ks !== 'c,i,v,w') return fail('E_ENVELOPE', 'v must be 2 with exactly v, w, i, c');
  try {
    const k = await subtle.importKey('raw', await subtle.decrypt({ name: 'RSA-OAEP' }, rsaPrivateKey, fromB64(env.w)), 'AES-GCM', false, ['decrypt']);
    return new Uint8Array(await subtle.decrypt({ name: 'AES-GCM', iv: fromB64(env.i) }, k, fromB64(env.c)));
  } catch { return fail('E_ENVELOPE', 'does not open with this key'); }
}

const isObj = (v) => v && typeof v === 'object' && !Array.isArray(v);
const only = (o, keys) => isObj(o) && Object.keys(o).sort().join(',') === [...keys].sort().join(',');
const noFloats = (v) => { if (typeof v === 'number') { if (!Number.isSafeInteger(v)) fail('E_NUMBER', String(v)); } else if (Array.isArray(v)) v.forEach(noFloats); else if (isObj(v)) Object.values(v).forEach(noFloats); };
const SHA = /^sha256:[0-9a-f]{64}$/, AT = /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ$/;
const nes = (s) => typeof s === 'string' && s.length > 0;

// checkEntry(entry, { trusted, last }) -> { entry, hash }.
//   trusted: a Set (or array) of author key ids ("p256:...") this reader trusts. Required for real use; trust never comes from the entry.
//   lastFor: async (entry) => { seq, hash, key } | null, the same, looked up per entry (use it when the author is not known beforehand).
//   last:    { seq, hash, key } of the same author's previous entry on this lane, or null/undefined for none.
export async function checkEntry(e, { trusted, last, lastFor } = {}) {
  noFloats(e);
  if (!isObj(e) || e.schema !== 'lane.entry/2') fail('E_SCHEMA', 'schema must be lane.entry/2');
  if (!only(e, ['schema', 'lane', 'author', 'seq', 'prev', 'at', 'type', 'body', 'refs', 'blobs', 'proof'])) fail('E_FIELD', 'exactly the eleven fields');
  if (!nes(e.lane) || !nes(e.type)) fail('E_FIELD', 'lane and type');
  if (!only(e.author, ['id', 'key', 'spki']) || !nes(e.author.id) || !nes(e.author.key) || !nes(e.author.spki)) fail('E_FIELD', 'author');
  if (!Number.isSafeInteger(e.seq) || e.seq < 1) fail('E_FIELD', 'seq');
  if (e.prev !== null && !(typeof e.prev === 'string' && SHA.test(e.prev))) fail('E_FIELD', 'prev');
  if (typeof e.at !== 'string' || !AT.test(e.at) || Number.isNaN(Date.parse(e.at))) fail('E_FIELD', 'at');
  if (!Array.isArray(e.refs) || !e.refs.every((r) => typeof r === 'string' && SHA.test(r))) fail('E_FIELD', 'refs');
  if (!Array.isArray(e.blobs)) fail('E_FIELD', 'blobs');
  if (!only(e.proof, ['alg', 'sig'])) fail('E_FIELD', 'proof');
  // The shape rule for seq and prev is checked here, before the signature: the owners' vector "first entry with a prev" is not re-signed.
  if ((e.seq === 1) !== (e.prev === null)) fail('E_CHAIN', 'seq 1 has no prev, later entries have one');
  // E_KEY
  let der, key;
  try { der = fromB64u(e.author.spki); key = await subtle.importKey('spki', der, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['verify']); } catch { return fail('E_KEY', 'spki is not a P-256 key'); }
  if (e.author.key !== 'p256:' + hex(await subtle.digest('SHA-256', der))) fail('E_KEY', 'key is not the hash of spki');
  if (trusted && !new Set(trusted).has(e.author.key)) fail('E_KEY', 'not a key this reader trusts');
  // E_SIG
  let sig; try { sig = fromB64u(e.proof.sig); } catch { return fail('E_SIG', 'sig is not base64url'); }
  if (e.proof.alg !== 'ES256' || sig.length !== 64) fail('E_SIG', 'ES256 with a raw 64-byte r||s');
  const { proof, ...unsigned } = e;
  if (!(await subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, key, sig, te.encode(canonical(unsigned))))) fail('E_SIG', 'does not verify');
  // E_BLOB
  for (const b of e.blobs) {
    if (!only(b, b.data !== undefined ? ['name', 'media', 'size', 'sha256', 'data'] : ['name', 'media', 'size', 'sha256', 'ref'])) fail('E_BLOB', 'shape');
    if (!nes(b.name) || !nes(b.media) || !Number.isSafeInteger(b.size) || b.size < 0 || !SHA.test(b.sha256)) fail('E_BLOB', 'fields');
    if (b.data !== undefined) {
      let bytes; try { bytes = fromB64(b.data); } catch { return fail('E_BLOB', 'data is not base64'); }
      if (bytes.length > 65536 || bytes.length !== b.size) fail('E_BLOB', 'size');
      if ((await hashOf(bytes)) !== b.sha256) fail('E_BLOB', 'hash');
    } else if (!nes(b.ref)) fail('E_BLOB', 'ref');
  }
  // E_CHAIN
  if (lastFor) last = await lastFor(e); // the previous entry of this author on this lane, looked up once the entry is known
  if (last && (e.author.key !== last.key || e.seq !== last.seq + 1 || e.prev !== last.hash)) fail('E_CHAIN', 'gap, fork or change of author key');
  return { entry: e, hash: await hashOf(te.encode(canonical(e))) };
}

// readEntry(bytes, opts): the opened bytes must be canonical JSON, then checkEntry.
export async function readEntry(bytes, opts) {
  const text = td.decode(bytes); let e;
  try { e = JSON.parse(text); } catch { return fail('E_CANONICAL', 'not JSON'); }
  if (canonical(e) !== text) fail('E_CANONICAL', 'not canonical JSON');
  return checkEntry(e, opts);
}
// readChain(entries, { trusted }): one author on one lane, oldest first. Stops at the first refusal.
export async function readChain(entries, { trusted } = {}) {
  let last = null; const out = [];
  for (const e of entries) { const r = await checkEntry(e, { trusted, last }); last = { seq: e.seq, hash: r.hash, key: e.author.key }; out.push(r); }
  return out;
}
