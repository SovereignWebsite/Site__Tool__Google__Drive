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
