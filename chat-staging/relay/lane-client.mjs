// Reads a sealed append lane from the vault server (sg-append/v1 as a.maestro described it, 25 Nov 2026):
//   list  POST {endpoint}/api/vault/append/list/{vault_id}   header x-sgraph-vault-enum-key, body {include_content:false, after_file_id?}
//   fetch POST {endpoint}/api/vault/append/fetch/{vault_id}  same header, body {inbox, file_ids:[up to 20]}; if files is empty, retry without inbox
// The read key is a secret: hold it in memory only, never log it, never put it in a URL. This module never writes to the lane.
const ID = /^[A-Za-z0-9_-]{1,64}$/;
export class LaneClientError extends Error { constructor(m, status) { super(m); this.name = 'LaneClientError'; this.status = status; } }
// createLaneClient({ endpoint, vaultId, readKey, fetch })
export function createLaneClient({ endpoint, vaultId, readKey, fetch: f = (...a) => globalThis.fetch(...a) }) {
  const url = new URL(endpoint); if (url.protocol !== 'https:' || url.username || url.password || url.pathname !== '/' || url.search || url.hash) throw new LaneClientError('endpoint must be a plain https origin', 0);
  if (!ID.test(vaultId)) throw new LaneClientError('bad vault id', 0);
  if (typeof readKey !== 'string' || !readKey) throw new LaneClientError('no read key', 0);
  const base = url.origin + '/api/vault/append/';
  const post = async (op, body) => {
    const r = await f(base + op + '/' + vaultId, { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-sgraph-vault-enum-key': readKey }, body: JSON.stringify(body) });
    if (!r.ok) throw new LaneClientError(op + ' failed: ' + r.status, r.status);
    return r.json();
  };
  let cursor = null, pending = null;
  return {
    // list(after) -> every entry after the file id, paging while truncated
    async list(after = cursor) {
      const out = []; let a = after;
      for (let page = 0; page < 1000; page++) {
        const r = await post('list', { include_content: false, ...(a ? { after_file_id: a } : {}) });
        const es = Array.isArray(r.entries) ? r.entries : []; out.push(...es);
        if (!r.truncated || !es.length) return out; a = es[es.length - 1].file_id;
      }
      throw new LaneClientError('too many pages', 0);
    },
    // fetch(entries) -> payload strings, in the order of the entries
    async fetch(entries) {
      const payloads = new Map();
      for (let i = 0; i < entries.length; i += 20) {
        const batch = entries.slice(i, i + 20), ids = batch.map((e) => e.file_id);
        let r = await post('fetch', { inbox: batch[0].inbox, file_ids: ids });
        if (!r.files || !r.files.length) r = await post('fetch', { file_ids: ids });
        for (const x of r.files || []) payloads.set(x.file_id, x.payload ?? x.content);
      }
      return entries.map((e) => payloads.get(e.file_id)).filter((p) => typeof p === 'string');
    },
    // read() -> payloads of the entries not yet committed. Call commit() after the relay has handled them.
    async read() { const es = await this.list(); pending = es.length ? es[es.length - 1].file_id : null; return this.fetch(es); },
    commit() { if (pending) cursor = pending; },
    get cursor() { return cursor }
  };
}
