// Relay core: turns "needs you" items from a lane into short Chat lines. Pure logic, no network of its own.
// The lane reader and the opener are plugged in, so this works against a test lane now and the real sealed lane later.
// What it will never do: post anything but a title and an https link, post twice for one item, or post faster than the limit.
export const LIMITS = { title: 140, link: 300 };
const LEAK = [
  /-----BEGIN [A-Z0-9 ]*PRIVATE KEY/, /\bya29\.[A-Za-z0-9_-]{20,}/, /\bgh[pousr]_[A-Za-z0-9]{20,}/, /\bgithub_pat_/, /\bAIza[0-9A-Za-z_-]{30,}/,
  /\bsk-(?:ant-)?[A-Za-z0-9_-]{20,}/, /\bxox[abprs]-/, /\beyJ[A-Za-z0-9_-]{8,}\.eyJ/, /\bsgit_(?:private|vk1|rk1)/, /\bAKIA[0-9A-Z]{16}\b/
];
const CONTACT = [/[^\s@]+@[^\s@]+\.[A-Za-z]{2,}/, /(?<![\w/.-])\+?\d[\d\s().-]{8,}\d(?![\w/.-])/]; // an email address or a phone number
const CTRL = new RegExp('[' + String.fromCharCode(0) + '-' + String.fromCharCode(31) + String.fromCharCode(127) + String.fromCharCode(0x2028) + String.fromCharCode(0x2029) + ']+', 'g');
const sha = async (s) => [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s)))].map((b) => b.toString(16).padStart(2, '0')).join('');

// cleanItem(item, { hosts, queryOk }) -> { text } or { reason }. Only item.id, item.title and item.link are ever read.
//   hosts    REQUIRED: the exact hostnames a link may point at (our own sites only). No list, no posting.
//   queryOk  optional: [{ host, pattern: RegExp }]; a link with a query string or fragment is refused unless its host and path+query match an entry.
//            A key or token can hide in a query or fragment, and Google's link previews fetch the link.
export function cleanItem(item, { hosts, queryOk = [] } = {}) {
  if (!Array.isArray(hosts) || !hosts.length) throw new Error('the link-host allow-list is required');
  if (!item || typeof item.id !== 'string' || !item.id || item.id.length > 200) return { reason: 'no id' };
  const title = typeof item.title === 'string' ? item.title.replace(CTRL, ' ').replace(/\s+/g, ' ').trim() : '';
  if (!title) return { reason: 'no title' }; if (title.length > LIMITS.title) return { reason: 'title too long' };
  let url; try { url = new URL(String(item.link)); } catch { return { reason: 'bad link' }; }
  if (url.protocol !== 'https:' || url.username || url.password) return { reason: 'link must be https with no credentials' };
  if (String(item.link).length > LIMITS.link) return { reason: 'link too long' };
  if (!hosts.includes(url.hostname)) return { reason: 'link host not allowed' };
  if ((url.search || url.hash) && !queryOk.some((q) => q.host === url.hostname && q.pattern.test(url.pathname + url.search + url.hash))) return { reason: 'link has a query or fragment' };
  for (const s of [title, url.href]) {
    if (LEAK.some((r) => r.test(s))) return { reason: 'looks like a secret' };
    if (CONTACT.some((r) => r.test(s))) return { reason: 'looks like a contact detail' };
  }
  return { text: 'Needs you: ' + title + ' ' + url.href };
}

// createRelay({ post(text), read(), open(entry), seen:{has,add}, hosts, queryOk, state, maxPerMinute, now })
//   state  { isInitialised(), markInitialised() }: with it, the FIRST run (or a run after the saved state was lost) only marks everything on the lane as seen
//          and posts nothing. A lost store never causes a silent replay.
//   read()  -> the lane's entries, oldest first (a test lane now, the sealed lane later)
//   open(e) -> { id, title, link } or null when the entry is not for this page or fails verification
export function createRelay({ post, read, open, seen, hosts, queryOk, state, maxPerMinute = 5, now = () => Date.now() }) {
  if (!Array.isArray(hosts) || !hosts.length) throw new Error('the link-host allow-list is required');
  let paused = false; const sent = [];
  return {
    pause: () => { paused = true; }, resume: () => { paused = false; }, get paused() { return paused; },
    async tick() {
      const out = { posted: [], skipped: [], stopped: null };
      if (paused) { out.stopped = 'paused'; return out; }
      if (state && !(await state.isInitialised())) {
        let n = 0;
        for (const entry of await read()) { let item; try { item = await open(entry); } catch { item = null; } if (item) { await seen.add(await sha(String(item.id))); n++; } }
        await state.markInitialised(); out.baseline = n; out.stopped = 'baseline: ' + n + ' existing items marked as seen, none posted'; return out;
      }
      for (const entry of await read()) {
        let item; try { item = await open(entry); } catch { item = null; }
        if (!item) { out.skipped.push({ reason: 'not openable' }); continue; }
        const key = await sha(String(item.id));
        if (await seen.has(key)) continue;
        const c = cleanItem(item, { hosts, queryOk }); if (c.reason) { out.skipped.push({ id: item.id, reason: c.reason }); await seen.add(key); continue; } // refused for good, not retried
        const t = now(); while (sent.length && t - sent[0] > 60000) sent.shift();
        if (sent.length >= maxPerMinute) { out.stopped = 'rate limit'; break; } // left unseen: the next tick posts it
        try { await post(c.text); } catch (e) { out.stopped = 'post failed: ' + (e.status || e.message); break; } // unseen: retried later
        sent.push(t); await seen.add(key); out.posted.push(item.id);
        if (paused) { out.stopped = 'paused'; break; }
      }
      return out;
    }
  };
}
export const memorySeen = () => { const s = new Set(); return { has: async (k) => s.has(k), add: async (k) => { s.add(k); } }; };
