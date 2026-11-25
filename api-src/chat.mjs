// Sovereign Website Chat API, v0.1.0. One ES module, no dependencies, no telemetry. Pinned: never changes once released.
// Built on the shared Google base (api-src/base.mjs): the same sign-in, token sealing and errors as the Drive API.
// Uses the Google Chat API with the signed-in person's own authorisation. There is deliberately no webhook mode:
// a webhook address carries its secret in the URL.
export const VERSION = '0.1.0';
export const SCOPES = { // the narrowest set for each job; check Google's current list before relying on a name
  spacesRead: 'https://www.googleapis.com/auth/chat.spaces.readonly',
  messagesRead: 'https://www.googleapis.com/auth/chat.messages.readonly',
  messagesCreate: 'https://www.googleapis.com/auth/chat.messages.create'
};
const API = 'https://chat.googleapis.com/v1/';
const SPACE = /^spaces\/[A-Za-z0-9_-]+$/, THREAD = /^spaces\/[A-Za-z0-9_-]+\/threads\/[A-Za-z0-9_-]+$/;
const MAX_TEXT = 4096;

//#include base.mjs

export class ChatError extends GoogleError { constructor(m, status) { super(m); this.name = 'ChatError'; this.status = status; } }
const space = (s) => { s = String(s); if (!s.startsWith('spaces/')) s = 'spaces/' + s; if (!SPACE.test(s)) throw new ChatError('Not a space id: ' + s, 400); return s; };

// createChat({ clientId, redirectUri, scope, env })   scope defaults to read spaces + read messages + create messages.
export function createChat(opts = {}) {
  const g = createGoogle({ ...opts, scope: opts.scope || Object.values(SCOPES), errorClass: ChatError });
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
