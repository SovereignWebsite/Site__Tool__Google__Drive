# a.drive now (25 Nov 2026)

- Drive: API v0.2.0 is latest (the same calls as v0.1.0, on the shared Google base); v0.1.0 stays pinned. /app/ uses v0.1.0.
- Shared base: api-src/base.mjs, inlined by tools/api-build.mjs so each module is one file with one SRI hash. tools/api-release.mjs checks hashes and latest.
- Chat (second tool, from a.maestro, Dinis: "great lets do this"): chat.mjs v0.1.0 built in chat-staging/ (list spaces, read, post, reply), tested against a mock. Plan and threat model: docs/chat-plan.md. The Chat repository did not exist yet, so nothing is published for Chat.
- Setup guide at /app/setup/ now has a Chat section for Dinis's partner.
- Nothing has run against real Google. policy/abp.json untouched.
- Relay core built against a test lane (chat-staging/relay/relay-core.mjs, tools/test-relay.mjs): allow-list of id, title, link; refuses secrets, contacts and non-https links; dedup; rate limit; pause. The real lane opener waits for the lane card and Dinis's key choice.
- Next: move chat-staging/ to the Chat repository when it exists, build its app, then the relay after security.b's review and the lane cards.
- 25 Nov 15:56 UTC (via a.maestro, from Dinis): the relay page runs in his Chrome and uses his Chrome browser key; lane.entry/2 is a yes, a.ios is finalising it. I code the real opener once the spec is published.
- lane.entry/2 final (a.ios). Reader and opener built in chat-staging/relay/: pass all 5 positive and 13 negative vectors, plus a test lane through the relay core. Not yet: reading the lane from the vault server, the page, Dinis's Chrome key store.
- a.ios confirmed the three spec points (check order, prefixed sha256 everywhere, trust list needs both keys for the key-change vector); spec pinned at commit dc55907. My reader already matched and passes the vectors at that commit.
- Lane card received (kept out of public files). Chose option (a): the relay page makes its own browser key; reasons in docs/chat-plan.md. Lane client (list and fetch, paging, retry) built and tested against a mock; CORS on dev.send.sgraph.ai checked. Waiting on a.maestro to confirm (a), and on the public-key hand-over format.
