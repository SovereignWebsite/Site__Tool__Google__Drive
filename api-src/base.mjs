// Shared base for the Sovereign Website Google tools (Drive, Chat). Inlined into each published module by tools/api-build.mjs,
// so every module stays one file with one SRI hash. Sign-in is Google's OAuth 2.0 token flow for web apps (a redirect, response_type=token).
// No Google script is loaded. The token is kept only for its hour, encrypted with a non-extractable key in IndexedDB (memory if that fails).
class GoogleError extends Error { constructor(m, status) { super(m); this.name = 'GoogleError'; this.status = status; } }
const b64 = (u8) => btoa(String.fromCharCode(...u8));
const unb64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

function idbOpen(idb) { return new Promise((ok, no) => { const r = idb.open('sw-drive', 1); r.onupgradeneeded = () => r.result.createObjectStore('kv'); r.onsuccess = () => ok(r.result); r.onerror = () => no(r.error); }); }
const idbGet = (db, k) => new Promise((ok, no) => { const r = db.transaction('kv').objectStore('kv').get(k); r.onsuccess = () => ok(r.result); r.onerror = () => no(r.error); });
const idbPut = (db, k, v) => new Promise((ok, no) => { const t = db.transaction('kv', 'readwrite'); t.objectStore('kv').put(v, k); t.oncomplete = ok; t.onerror = () => no(t.error); });
const idbDel = (db, k) => new Promise((ok, no) => { const t = db.transaction('kv', 'readwrite'); t.objectStore('kv').delete(k); t.oncomplete = ok; t.onerror = () => no(t.error); });

// Token vault: AES-GCM with a non-extractable key. Ciphertext and expiry only, never the plain token.
function vault(env) {
  let mem = null;
  const ready = async () => { try { return env.indexedDB ? await idbOpen(env.indexedDB) : null; } catch { return null; } };
  return {
    async put(token, expiresInSec) {
      const exp = Date.now() + Math.min(Number(expiresInSec) || 3600, 3600) * 1000;
      const db = await ready();
      if (!db || !env.crypto?.subtle) { mem = { token, exp }; return; }
      let key = await idbGet(db, 'key');
      if (!key) { key = await env.crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']); await idbPut(db, 'key', key); }
      const iv = env.crypto.getRandomValues(new Uint8Array(12));
      const ct = new Uint8Array(await env.crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, new TextEncoder().encode(token)));
      await idbPut(db, 'token', { iv: b64(iv), ct: b64(ct), exp }); mem = null;
    },
    async get() {
      if (mem) return mem.exp > Date.now() + 30000 ? mem.token : null;
      const db = await ready(); if (!db || !env.crypto?.subtle) return null;
      const rec = await idbGet(db, 'token'), key = await idbGet(db, 'key');
      if (!rec || !key || rec.exp <= Date.now() + 30000) return null;
      try { return new TextDecoder().decode(await env.crypto.subtle.decrypt({ name: 'AES-GCM', iv: unb64(rec.iv) }, key, unb64(rec.ct))); } catch { return null; }
    },
    async clear() { mem = null; const db = await ready(); if (db) { await idbDel(db, 'token'); } }
  };
}


// createGoogle({ clientId, redirectUri, scope, env, name, errorClass })
function createGoogle(opts = {}) {
  const env = { fetch: (...a) => globalThis.fetch(...a), indexedDB: globalThis.indexedDB, crypto: globalThis.crypto, location: globalThis.location, history: globalThis.history, sessionStorage: globalThis.sessionStorage, ...(opts.env || {}) };
  const Err = opts.errorClass || GoogleError;
  const scope = [].concat(opts.scope).join(' ');
  const tv = vault(env);
  const need = async () => { const t = await tv.get(); if (!t) throw new Err('Not signed in, or the sign-in has ended.', 401); return t; };
  const g = {
    scope,
    signIn() {
      if (!opts.clientId) throw new Err('No clientId: pass your own Google OAuth client id.', 0);
      const state = b64(env.crypto.getRandomValues(new Uint8Array(16))).replace(/[^A-Za-z0-9]/g, '');
      env.sessionStorage.setItem('sw-google-state', state);
      const redirect = opts.redirectUri || env.location.origin + env.location.pathname;
      const q = new URLSearchParams({ client_id: opts.clientId, redirect_uri: redirect, response_type: 'token', scope, state, include_granted_scopes: 'true' });
      env.location.assign('https://accounts.google.com/o/oauth2/v2/auth?' + q);
    },
    async handleRedirect() {
      const h = new URLSearchParams((env.location.hash || '').replace(/^#/, ''));
      if (!h.has('access_token') && !h.has('error')) return { signedIn: !!(await tv.get()), fresh: false };
      const want = env.sessionStorage.getItem('sw-google-state'); env.sessionStorage.removeItem('sw-google-state');
      env.history.replaceState(null, '', env.location.pathname + env.location.search);
      if (h.has('error')) throw new Err('Google said: ' + h.get('error'), 0);
      if (!want || h.get('state') !== want) throw new Err('The sign-in did not match the request that started it. Try again.', 0);
      await tv.put(h.get('access_token'), h.get('expires_in'));
      return { signedIn: true, fresh: true };
    },
    isSignedIn: async () => !!(await tv.get()),
    token: () => tv.get(), // for Google's own widgets. Do not store it.
    async signOut() { const t = await tv.get(); await tv.clear(); if (t) { try { await env.fetch('https://oauth2.googleapis.com/revoke?token=' + encodeURIComponent(t), { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' } }); } catch {} } },
    // call(url, init): an authorised fetch. Throws an error with .status and Google's own message.
    async call(url, init = {}) {
      const t = await need();
      const r = await env.fetch(url, { ...init, headers: { Authorization: 'Bearer ' + t, ...(init.headers || {}) } });
      if (r.ok) return r;
      let m = String(r.status); try { m = (await r.json()).error.message || m; } catch {}
      if (r.status === 401) await tv.clear();
      throw new Err(m, r.status);
    },
    json: async (url, init) => (await g.call(url, init)).json(),
    env
  };
  return g;
}
