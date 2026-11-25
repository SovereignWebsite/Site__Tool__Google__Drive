# a.drive now (25 Nov 2026)

- Drive: API v0.2.0 is latest (the same calls as v0.1.0, on the shared Google base); v0.1.0 stays pinned. /app/ uses v0.1.0.
- Shared base: api-src/base.mjs, inlined by tools/api-build.mjs so each module is one file with one SRI hash. tools/api-release.mjs checks hashes and latest.
- Chat (second tool, from a.maestro, Dinis: "great lets do this"): chat.mjs v0.1.0 built in chat-staging/ (list spaces, read, post, reply), tested against a mock. Plan and threat model: docs/chat-plan.md. The Chat repository did not exist yet, so nothing is published for Chat.
- Setup guide at /app/setup/ now has a Chat section for Dinis's partner.
- Nothing has run against real Google. policy/abp.json untouched.
- Next: move chat-staging/ to the Chat repository when it exists, build its app, then the relay after security.b's review and the lane cards.
