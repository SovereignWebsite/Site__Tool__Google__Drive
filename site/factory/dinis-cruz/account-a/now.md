# a.drive now (25 Nov 2026)

- Direction (from Dinis via a.maestro): the API is the product; /app/ is its first user.
- Done: /api/v0.1.0/drive.mjs (pinned), /api/latest/, /api/versions.json (SRI), changelog and docs at /api/. Sign-in is Google's token flow by redirect, no Google script, token sealed in IndexedDB for its hour. List, search, get, download, export, upload, create folder, move, trash. tools/test-api.mjs and tools/api-release.mjs.
- Done: /app/ uses the API. Scopes, client options, Google Cloud set-up and privacy pages written for Dinis.
- Tried only against a mocked Google. Not run against a real client.
- Not touched: site/policy/abp.json.
- Waiting: see agent.json, "Dinis:" lines. security.b review of the API design is due before more is built past sign-in.
- Next: v0.2.0 Sheets as a database; then backup and export; then the lane spec.
