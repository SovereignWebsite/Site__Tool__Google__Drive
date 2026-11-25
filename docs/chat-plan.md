# Chat tool: plan (a.drive, 25 Nov 2026)

Status: a plan, for security.b to review before anything is built past reading. The repository (SovereignWebsite/Site__Tool__Google__Chat) did not exist when this was written; chat.mjs v0.1.0 is built and tested against a mock in this repository, under chat-staging/, and moves to the Chat repository when it exists.

## Shape
- `api-src/base.mjs` is the shared base: token sign-in by redirect (no Google script), the token sealed in a non-extractable IndexedDB key for its hour, errors. `tools/api-build.mjs` inlines it, so each published module is one file with one SRI hash. Drive v0.2.0 and Chat v0.1.0 are both built this way.
- `chat.mjs` v0.1.0: `listSpaces`, `listMessages(space, {thread, since})`, `post(space, text, {thread})`, `reply`. Ids are checked against a strict pattern before any request. Text only, 4096 characters. No webhook mode: a webhook address carries its secret in the URL.

## Scopes (check Google's current list; the names below are what I expect)
| Job | Scope |
|---|---|
| List spaces | chat.spaces.readonly |
| Read messages | chat.messages.readonly |
| Post and reply | chat.messages.create |
Nothing for membership, space creation or deletion is requested. The API default asks for all three; a site that only reads passes `scope: [SCOPES.spacesRead, SCOPES.messagesRead]`.

## The relay (Dinis's reason for this)
A page he keeps open, signed in to Google in his browser, drains the agents' sealed append lanes and posts each "needs you" item to his chosen space as one short line with its link.
- It signs in as the team's agent account at the Workspace, in the browser, with the Internal client. No service account, no key in any session.
- It never posts keys, contacts or private content: a post is built from an allow-list of fields (a title and a link), never from a lane item's body.
- The lane reading reuses what the decisions and feedback pages do; the lane cards come from a.maestro. Not built yet.

## Threat model, first cut
- **Page compromise** exposes what the signed-in account can do with these scopes: read its spaces and post as it. Mitigations: the narrow scopes; connect-src limited to Google's API hosts and checked in CI; no third-party script; the token lives an hour, sealed.
- **Posting as a person** is the main abuse: the relay posts only from a fixed template. The page needs a visible "posting as" line and a pause button.
- **Spam or loops**: a rate limit in the relay (one post per item, deduplicated by a hash kept in the browser), and a stop after N posts a minute.
- **Reading other people's messages**: only spaces the account is in; the app shows what it reads and keeps nothing.
- **What Google sees**: everything posted, in clear. Chat is not a confidential channel; the relay posts only short pointer lines.

## Questions for security.b
1. Is posting as a shared agent account from a human's open browser acceptable, or should each person post as themselves?
2. Is the fixed-template, allow-list design enough to keep private content out?
3. Should the relay refuse to run unless the page's CSP is the expected one?

## Set-up (for Dinis's partner)
See /app/setup/ on this site: the Chat section lists enabling the Chat API, the optional Chat configuration page, the scopes, and the origin and redirect to add on the same Internal client.

## Relay core (built against a test lane, 25 Nov)
`chat-staging/relay/relay-core.mjs`, tested by `tools/test-relay.mjs`. Lane reading and opening are plug-in functions (`read()`, `open(entry)`), so the real sealed lane drops in when its envelope is final (lane.entry/2 waits on Dinis's yes). Inputs still needed from a.maestro: the lane card (endpoint, vault_id, append_token, recipient key) and which browser key the relay page uses.
- **Allow-list:** only an item's `id`, `title` and `link` are ever read. The post is `Needs you: <title> <link>`; the body and every other field are never copied.
- **Refused for good** (not retried, never posted): a link that is not https or carries credentials, a title over 140 characters, anything shaped like a key or token, an email address or a phone number, and optionally a link host outside an allow-list.
- **Dedup:** one post per item id, remembered by hash, marked only after a successful post, so a failed post is retried and never lost.
- **Rate limit:** five posts a minute by default; the rest wait for the next tick. A failed post stops the tick.
- **Pause:** a pause control stops it at once.
- Still to build: the page (a "posting as" line, the pause button, the log of what was posted), the browser key store, and the real lane opener.

## Lane reader and opener (lane.entry/2, final 25 Nov)
- `chat-staging/relay/lane-entry-v2.mjs`: a WebCrypto-only reader written against the final spec. It passes the owners' vectors: the canonical case, the five positive and all thirteen negative, each refused with the code given (`tools/test-lane.mjs`; fetch the vectors first, as that file says, because their throwaway keys are not kept here).
- `chat-staging/relay/lane-opener.mjs`: opens one sealed payload with the page's RSA key and gives the relay `{id, title, link}`. Entry type `needs-you`, body exactly `{title, link}` (proposed here for the lane's readers and writers to agree). The item id is the entry's hash.
  - Trust: only author keys on the page's own list (never from the entry). A replay, a gap or a fork is refused by the chain. A signed entry of another type or lane advances the chain but is not posted.
  - Tested with a test lane and test keys made in memory (`tools/test-opener.mjs`): untrusted author, wrong type, extra body field, replay, another lane, junk and a wrong recipient key are all refused; good entries reach the relay core.
- Still not built: reading the lane from the vault server (the endpoint, vault_id and append_token card are with a.maestro), the page, and Dinis's Chrome key store.

## Decision: the relay page makes its own browser key (option a, 25 Nov)
A browser key belongs to one origin, so the relay page on the Chat site cannot use the CRM's key on the CRM's origin. Two options: (a) the relay page makes its own key in Dinis's Chrome; (b) the relay runs inside the CRM app and imports chat.mjs. **Recommended and chosen: (a).**
- No key crosses origins, and the Google client needs no extra origin for the CRM.
- The relay page can only ever read the "for Dinis" lane, so a flaw in the page exposes that lane and the Chat scopes, not the CRM's other lanes, contacts or keys.
- The cost: Dinis enrols one more public key (shown by the page as a QR or string), and a.maestro re-seals the lane's read key to it.
- The key: non-extractable RSA-OAEP (to open entries) and ECDSA P-256 (to sign), held in IndexedDB. Passkey gating as in the CRM's You page is a later step; I do not have that code, so I will reuse it if pointed to it.
- Reading: `chat-staging/relay/lane-client.mjs` (list and fetch as a.maestro described them; paging, 20 files a fetch, retry without the inbox; a read key held in memory only and never in a URL or log; tested against a mock server). dev.send.sgraph.ai answers a CORS preflight with `Access-Control-Allow-Origin: *` and allows `x-sgraph-vault-enum-key`, checked 25 Nov.
- Trusted authors: starts with one, a.maestro's (lane.entry/2 author key p256:a213b369...6809, published in PrompTugal's board/keys.json); Dinis edits the list in the page.
- Never in a public file: the lane's append token and read key. They are given to the page at run time (the read key sealed to the page's key).
- State the page must keep between visits, or it would repost: the seen hashes and the per-author chain state, in IndexedDB. Cleared state means a full replay of the lane; the seen store is what stops duplicates, so losing it is the one way to double-post. The page should say so and offer "mark everything as seen".

## The page's key and the read key (built, tested without a browser)
- `chat-staging/relay/relay-keys.mjs`, using the same vendored sgit pki code as the CRM (`vendor/`, copied unedited from the CRM's pinned copy and checked against its hashes; CC BY 4.0 and MIT, see `vendor/VENDOR.json` and `vendor/pki/ATTRIBUTION.md`). RSA-OAEP 4096 and ECDSA P-256, private halves not extractable, kept in IndexedDB; the public half is the k1 string (label "Chat relay, chat.google.tool.sovereignweb.site") with both fingerprints, and a QR of the same string at level M (the CRM found level L unreadable for this key size).
- The read key arrives as a **signed m1 code sealed to the page's key** (the format the CRM already opens), signed by a.maestro's P-256 key. Plaintext `{"kind":"lane-read-key","lane","vault_id","enum_key"}`. The page checks the signature against the signer list and the lane name, then keeps the read key only sealed to its own public key. Tested: unsigned, unknown signer, forged signature, wrong lane, wrong kind, wrong recipient and junk are all refused.
- Not built yet: the passkey lock (copy of the CRM's: a platform authenticator, asked once per tab), the page itself, the editable trusted-author list, the seen and chain state in IndexedDB.
