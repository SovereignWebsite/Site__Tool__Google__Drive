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

//#include base.mjs

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
