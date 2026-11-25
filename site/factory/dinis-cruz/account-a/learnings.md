# Learnings

- The Gmail tool's /app/connect/ page answered 404 when I fetched it on 25 Nov, so I built from Google's documented token flow, not by copying it. Ask mail.dev.a for its client set-up.
- drive.file grants per-file access, so "browse" means the files you picked plus what the app made. Whole-Drive browsing needs a restricted scope (a decision for Dinis).
- The meta CSP on the app pages is wide enough for the Picker (gstatic, apis.google.com) but was not tested against it; loosen or tighten after the first real run.
- The seed's abp.json says a change to it needs the owner's yes: a blanket find and replace on the old wording touched it, and I reverted that.
- Gmail tool (per mail.dev.a): token flow by redirect with no Google script, token sealed in a non-extractable IndexedDB key, connect-src limited to Google's API hosts, Internal client. The Drive API copies the flow, not the Internal client: an outside team needs an External client or its own.
- A pinned API version must never change: tools/api-release.mjs records its SRI and fails if the file differs, and checks latest/ equals the newest version.
- Corrected: the Gmail client had no Search Console verification and no Google review, because it is Internal (Google does not verify Internal apps). An External client for this site is different: expect a branding check, and verify the domain if Google asks.
- A module that must be one file with one hash cannot import a shared base at run time: build it in (tools/api-build.mjs inlines api-src/base.mjs). Released versions are refused if their built file would differ.
