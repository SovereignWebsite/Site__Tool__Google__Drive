// Sovereign Website Drive API, v0.2.0. One ES module, no dependencies, no telemetry.
// Pinned: this file never changes once released. Import it from https://drive.google.tool.sovereignweb.site/api/v0.1.0/drive.mjs
// The importing site brings its own Google OAuth client id and registers its own origin and redirect URI in Google Cloud.
// Built on the shared Google base (api-src/base.mjs). Sign-in is Google's OAuth 2.0 token flow for web apps (a redirect, response_type=token). No Google script is loaded.
// The token is kept only for its hour, encrypted with a non-extractable key held in IndexedDB (memory if IndexedDB fails).
export const VERSION = '0.2.0';
export const SCOPES = {
  file: 'https://www.googleapis.com/auth/drive.file',            // files this site creates or the person picks. No restricted review.
  readonly: 'https://www.googleapis.com/auth/drive.readonly',    // RESTRICTED: read the whole Drive
  full: 'https://www.googleapis.com/auth/drive'                  // RESTRICTED: read and change the whole Drive
};
const API = 'https://www.googleapis.com/drive/v3/';
const UPLOAD = 'https://www.googleapis.com/upload/drive/v3/files';
const AUTH = 'https://accounts.google.com/o/oauth2/v2/auth';
export const FOLDER = 'application/vnd.google-apps.folder';
export const EXPORTS = { // default export type for Google's own formats
  'application/vnd.google-apps.document': 'application/pdf',
  'application/vnd.google-apps.spreadsheet': 'text/csv',
  'application/vnd.google-apps.presentation': 'application/pdf',
  'application/vnd.google-apps.drawing': 'image/png'
};
const quote = (s) => "'" + String(s).replace(/\\/g, '\\\\').replace(/'/g, "\\'") + "'";
const FIELDS = 'id,name,mimeType,size,modifiedTime,parents,webViewLink,trashed';

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


export function createDrive(opts = {}) {
  const g = createGoogle({ ...opts, scope: opts.scope || SCOPES.file, errorClass: DriveError });
  const env = g.env, json = g.json, call = g.call;

  const api = {
    version: VERSION, scope: g.scope,
    // ----- sign-in (from the shared base) -----
    signIn: g.signIn, handleRedirect: g.handleRedirect, isSignedIn: g.isSignedIn, token: g.token, signOut: g.signOut,

    // ----- read -----
    // list({ parent, q, pageToken, pageSize }) -> { files, nextPageToken }. q is a Drive query; parent adds "'id' in parents".
    async list({ parent, q, pageToken, pageSize = 100 } = {}) {
      const parts = ['trashed=false']; if (parent) parts.push(quote(parent) + ' in parents'); if (q) parts.push('(' + q + ')');
      const p = new URLSearchParams({ q: parts.join(' and '), pageSize: String(pageSize), orderBy: 'folder,name', supportsAllDrives: 'true', includeItemsFromAllDrives: 'true', fields: 'nextPageToken,files(' + FIELDS + ')' });
      if (pageToken) p.set('pageToken', pageToken);
      return json(API + 'files?' + p);
    },
    // search(text) -> files whose name or content contains the text.
    search(text, o = {}) { const t = quote(text); return api.list({ ...o, q: 'name contains ' + t + ' or fullText contains ' + t }); },
    get: (id) => json(API + 'files/' + encodeURIComponent(id) + '?supportsAllDrives=true&fields=' + FIELDS),
    // download(id) -> { bytes: ArrayBuffer, type }. Google's own formats are exported (see EXPORTS) unless you pass a type.
    async download(id, type) {
      const f = await api.get(id);
      if (f.mimeType === FOLDER) throw new DriveError('A folder has no content to download.', 400);
      if (EXPORTS[f.mimeType] || (f.mimeType.startsWith('application/vnd.google-apps.') && type)) return api.exportFile(id, type || EXPORTS[f.mimeType], f);
      const r = await call(API + 'files/' + encodeURIComponent(id) + '?alt=media&supportsAllDrives=true');
      return { bytes: await r.arrayBuffer(), type: f.mimeType, file: f };
    },
    // exportFile(id, mimeType): Docs, Sheets, Slides and Drawings to another format (pdf, docx, xlsx, csv, png and so on).
    async exportFile(id, type, file) {
      const r = await call(API + 'files/' + encodeURIComponent(id) + '/export?mimeType=' + encodeURIComponent(type));
      return { bytes: await r.arrayBuffer(), type, file: file || null };
    },
    async text(id) { const { bytes } = await api.download(id); return new TextDecoder().decode(bytes); },

    // ----- write -----
    // upload(data, { name, type, parent }): data is a Blob, File, string or ArrayBuffer. Multipart, for files up to a few MB.
    async upload(data, { name, type, parent } = {}) {
      const blob = data instanceof Blob ? data : new Blob([data], { type: type || 'application/octet-stream' });
      const meta = { name: name || data.name || 'untitled' }; if (parent) meta.parents = [parent];
      const b = 'sw' + [...env.crypto.getRandomValues(new Uint8Array(12))].map((x) => x.toString(16).padStart(2, '0')).join('');
      const body = new Blob(['--' + b + '\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n', JSON.stringify(meta), '\r\n--' + b + '\r\nContent-Type: ' + (type || blob.type || 'application/octet-stream') + '\r\n\r\n', blob, '\r\n--' + b + '--']);
      return json(UPLOAD + '?uploadType=multipart&supportsAllDrives=true&fields=' + FIELDS, { method: 'POST', headers: { 'Content-Type': 'multipart/related; boundary=' + b }, body });
    },
    createFolder(name, parent) { const m = { name, mimeType: FOLDER }; if (parent) m.parents = [parent]; return json(API + 'files?supportsAllDrives=true&fields=' + FIELDS, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(m) }); },
    async move(id, newParent) {
      const f = await json(API + 'files/' + encodeURIComponent(id) + '?supportsAllDrives=true&fields=parents');
      const p = new URLSearchParams({ addParents: newParent, removeParents: (f.parents || []).join(','), supportsAllDrives: 'true', fields: FIELDS });
      return json(API + 'files/' + encodeURIComponent(id) + '?' + p, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: '{}' });
    },
    // trash(id) moves to the Drive bin (recoverable). It never deletes for good.
    trash: (id) => json(API + 'files/' + encodeURIComponent(id) + '?supportsAllDrives=true&fields=' + FIELDS, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ trashed: true }) })
  };
  return api;
}
export class DriveError extends GoogleError { constructor(m, status) { super(m); this.name = 'DriveError'; this.status = status; } }
export default createDrive;
