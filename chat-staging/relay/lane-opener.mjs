// The relay's opener: turns one sealed lane payload into { id, title, link } for the relay core, or null.
// Entry type "needs-you" (proposed; the lane's readers and writers agree it): body { title, link }, nothing else.
// The item id is the entry's hash, so the same entry is never posted twice. The body is read for title and link only.
import { openPayload, readEntry, LaneError } from './lane-entry-v2.mjs';
export const NEEDS_YOU = 'needs-you';
// createOpener({ rsaPrivateKey, trusted, lane, chains, onRefuse })
//   rsaPrivateKey the page's RSA-OAEP key (a CryptoKey; kept non-extractable by the page)
//   trusted       Set of author key ids this page trusts to ask for Dinis's attention
//   lane          the lane's name; entries for another lane are refused
//   chains        { get(key), set(key, last) }: the last entry seen per author, kept by the reader
export function createOpener({ rsaPrivateKey, trusted, lane, chains, onRefuse = () => {} }) {
  return async function open(payload) {
    try {
      const bytes = await openPayload(typeof payload === 'string' ? payload : payload?.payload, rsaPrivateKey);
      const { entry, hash } = await readEntry(bytes, { trusted, lastFor: (e) => chains.get(e.author.key + '|' + e.lane) });
      // The chain advances on any entry that verifies, so a signed entry of another type or lane never blocks the author's later ones.
      await chains.set(entry.author.key + '|' + entry.lane, { seq: entry.seq, hash, key: entry.author.key });
      if (entry.lane !== lane) throw new LaneError('E_FIELD', 'another lane');
      if (entry.type !== NEEDS_YOU) throw new LaneError('E_FIELD', 'not a needs-you entry');
      const b = entry.body;
      if (!b || typeof b !== 'object' || Array.isArray(b) || Object.keys(b).sort().join(',') !== 'link,title' || typeof b.title !== 'string' || typeof b.link !== 'string') throw new LaneError('E_FIELD', 'body must be exactly title and link');
      return { id: hash, title: b.title, link: b.link };
    } catch (e) { onRefuse(e instanceof LaneError ? e.code : 'E_OTHER', e.message); return null; }
  };
}
export const memoryChains = () => { const m = new Map(); return { get: async (k) => m.get(k) || null, set: async (k, v) => { m.set(k, v); } }; };
