// Sovereign Website Chat API, v0.1.0. One ES module, no dependencies, no telemetry. Pinned: never changes once released.
// Built on the shared Google base (api-src/base.mjs): the same sign-in, token sealing and errors as the Drive API.
// Uses the Google Chat API with the signed-in person's own authorisation. There is deliberately no webhook mode:
// a webhook address carries its secret in the URL.
export const VERSION = '0.1.0';
// The relay posts pointers only: it asks for nothing to read messages (security.b, 25 Nov).
export const RELAY_SCOPES = ['https://www.googleapis.com/auth/chat.spaces.readonly', 'https://www.googleapis.com/auth/chat.messages.create'];
export const SCOPES = { // the narrowest set for each job; check Google's current list before relying on a name
  spacesRead: 'https://www.googleapis.com/auth/chat.spaces.readonly',
  messagesRead: 'https://www.googleapis.com/auth/chat.messages.readonly',
  messagesCreate: 'https://www.googleapis.com/auth/chat.messages.create'
};
const API = 'https://chat.googleapis.com/v1/';
const SPACE = /^spaces\/[A-Za-z0-9_-]+$/, THREAD = /^spaces\/[A-Za-z0-9_-]+\/threads\/[A-Za-z0-9_-]+$/;
const MAX_TEXT = 4096;

// Shared base for the Sovereign Website Google tools (Drive, Chat). Inlined into each published module by tools/api-build.mjs,
// so every module stays one file with one SRI hash. Sign-in is Google's OAuth 2.0 token flow for web apps (a redirect, response_type=token).
// No Google script is loaded. The token is kept only for its hour, encrypted with a non-extractable key in IndexedDB (memory if that fails).
class GoogleError extends Error { constructor(m, status) { super(m); this.name = 'GoogleError'; this.status = status; } }
const b64 = (u8) => btoa(String.fromCharCode(...u8));
const unb64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

function idbOpen(idb, dbName) { return new Promise((ok, no) => { const r = idb.open(dbName, 1); r.onupgradeneeded = () => r.result.createObjectStore('kv'); r.onsuccess = () => ok(r.result); r.onerror = () => no(r.error); }); }
const idbGet = (db, k) => new Promise((ok, no) => { const r = db.transaction('kv').objectStore('kv').get(k); r.onsuccess = () => ok(r.result); r.onerror = () => no(r.error); });
const idbPut = (db, k, v) => new Promise((ok, no) => { const t = db.transaction('kv', 'readwrite'); t.objectStore('kv').put(v, k); t.oncomplete = ok; t.onerror = () => no(t.error); });
const idbDel = (db, k) => new Promise((ok, no) => { const t = db.transaction('kv', 'readwrite'); t.objectStore('kv').delete(k); t.oncomplete = ok; t.onerror = () => no(t.error); });

// Token vault: AES-GCM with a non-extractable key. Ciphertext and expiry only, never the plain token.
function vault(env, dbName) {
  let mem = null;
  const ready = async () => { try { return env.indexedDB ? await idbOpen(env.indexedDB, dbName) : null; } catch { return null; } };
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


// createGoogle({ clientId, redirectUri, scope, env, name, errorClass, exposeToken })
//   name         the module's own name ("drive", "chat"): its token store and sign-in state are namespaced by it, so two modules on one origin never share a token
//   exposeToken  false by default. token() then throws. Set it only for Google's own widgets (the Picker). The sealed token does not protect against script on
//                your own origin: any script there can call token() or use the stored key. Your page's CSP and the absence of XSS and third-party script are the real control.
function createGoogle(opts = {}) {
  const env = { fetch: (...a) => globalThis.fetch(...a), indexedDB: globalThis.indexedDB, crypto: globalThis.crypto, location: globalThis.location, history: globalThis.history, sessionStorage: globalThis.sessionStorage, ...(opts.env || {}) };
  const Err = opts.errorClass || GoogleError;
  const scope = [].concat(opts.scope).join(' ');
  const name = String(opts.name || 'google').replace(/[^a-z0-9_-]/gi, ''), tv = vault(env, 'sw-' + name), stateKey = 'sw-' + name + '-state';
  const need = async () => { const t = await tv.get(); if (!t) throw new Err('Not signed in, or the sign-in has ended.', 401); return t; };
  const g = {
    scope,
    signIn() {
      if (!opts.clientId) throw new Err('No clientId: pass your own Google OAuth client id.', 0);
      const state = b64(env.crypto.getRandomValues(new Uint8Array(16))).replace(/[^A-Za-z0-9]/g, '');
      env.sessionStorage.setItem(stateKey, state);
      const redirect = opts.redirectUri || env.location.origin + env.location.pathname;
      const q = new URLSearchParams({ client_id: opts.clientId, redirect_uri: redirect, response_type: 'token', scope, state }); // no include_granted_scopes: a token never carries more than was asked
      env.location.assign('https://accounts.google.com/o/oauth2/v2/auth?' + q);
    },
    async handleRedirect() {
      const h = new URLSearchParams((env.location.hash || '').replace(/^#/, ''));
      if (!h.has('access_token') && !h.has('error')) return { signedIn: !!(await tv.get()), fresh: false };
      const want = env.sessionStorage.getItem(stateKey); env.sessionStorage.removeItem(stateKey);
      env.history.replaceState(null, '', env.location.pathname + env.location.search);
      if (h.has('error')) throw new Err('Google said: ' + h.get('error'), 0);
      if (!want || h.get('state') !== want) throw new Err('The sign-in did not match the request that started it. Try again.', 0);
      // Refuse a token wider than asked (Google returns the granted scopes in the fragment).
      const asked = new Set(scope.split(' ')), got = (h.get('scope') || '').split(/\s+/).filter(Boolean);
      if (got.some((x) => !asked.has(x))) throw new Err('Google returned a token with more access than was asked for. It was refused.', 0);
      await tv.put(h.get('access_token'), h.get('expires_in'));
      return { signedIn: true, fresh: true };
    },
    isSignedIn: async () => !!(await tv.get()),
    token: async () => { if (!opts.exposeToken) throw new Err('token() is off: pass exposeToken: true only for Google widgets such as the Picker.', 0); return tv.get(); },
    async signOut() { const t = await tv.get(); await tv.clear(); if (t) { try { await env.fetch('https://oauth2.googleapis.com/revoke', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ token: t }).toString() }); } catch {} } },
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


export class ChatError extends GoogleError { constructor(m, status) { super(m); this.name = 'ChatError'; this.status = status; } }
const space = (s) => { s = String(s); if (!s.startsWith('spaces/')) s = 'spaces/' + s; if (!SPACE.test(s)) throw new ChatError('Not a space id: ' + s, 400); return s; };

// createChat({ clientId, redirectUri, scope, env })   scope defaults to read spaces + read messages + create messages.
export function createChat(opts = {}) {
  const g = createGoogle({ ...opts, name: 'chat', scope: opts.scope || Object.values(SCOPES), errorClass: ChatError });
  const q = (o) => { const p = new URLSearchParams(); for (const k in o) if (o[k] != null) p.set(k, String(o[k])); const s = p.toString(); return s ? '?' + s : ''; };
  const api = {
    version: VERSION, scope: g.scope,
    signIn: g.signIn, handleRedirect: g.handleRedirect, isSignedIn: g.isSignedIn, token: g.token, signOut: g.signOut,
    // listSpaces({ pageToken, pageSize }) -> { spaces, nextPageToken }: the spaces the signed-in person is in.
    listSpaces: ({ pageToken, pageSize = 100 } = {}) => g.json(API + 'spaces' + q({ pageSize, pageToken })),
    // listMessages(space, { thread, since, pageToken, pageSize }) -> { messages, nextPageToken }. Newest first.
    // thread is "spaces/X/threads/Y"; since is an ISO time (only messages created after it).
    listMessages(sp, { thread, since, pageToken, pageSize = 50 } = {}) {
      const f = []; if (thread) { if (!THREAD.test(thread)) throw new ChatError('Not a thread name: ' + thread, 400); f.push('thread.name = ' + thread); }
      if (since) { if (!/^\d{4}-\d\d-\d\dT[0-9:.]+Z$/.test(since)) throw new ChatError('since must be a UTC ISO time, like 2026-11-25T10:00:00Z', 400); f.push('createTime > "' + since + '"'); }
      return g.json(API + space(sp) + '/messages' + q({ pageSize, pageToken, orderBy: 'createTime desc', filter: f.join(' AND ') || null }));
    },
    // post(space, text, { thread }) posts plain text. With a thread it replies there, and starts a new thread if that one is gone.
    post(sp, text, { thread } = {}) {
      text = String(text ?? ''); if (!text.trim()) throw new ChatError('The message is empty.', 400);
      if (text.length > MAX_TEXT) throw new ChatError('The message is over ' + MAX_TEXT + ' characters.', 400);
      const body = { text }; let extra = {};
      if (thread) { if (!THREAD.test(thread)) throw new ChatError('Not a thread name: ' + thread, 400); body.thread = { name: thread }; extra = { messageReplyOption: 'REPLY_MESSAGE_FALLBACK_TO_NEW_THREAD' }; }
      return g.json(API + space(sp) + '/messages' + q(extra), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    },
    reply: (sp, thread, text) => api.post(sp, text, { thread })
  };
  return api;
}
export default createChat;
