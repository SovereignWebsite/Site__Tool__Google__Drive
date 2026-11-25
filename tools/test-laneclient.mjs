import assert from 'node:assert/strict';
const { createLaneClient, LaneClientError } = await import('../chat-staging/relay/lane-client.mjs');
const calls = []; const all = Array.from({ length: 45 }, (_, i) => ({ file_id: 'f' + i, inbox: 'ib' }));
const server = async (url, init) => { const body = JSON.parse(init.body); calls.push({ url, headers: init.headers, body });
  const j = (o) => ({ ok: true, status: 200, json: async () => o });
  if (url.includes('/list/')) { const start = body.after_file_id ? all.findIndex((e) => e.file_id === body.after_file_id) + 1 : 0; const es = all.slice(start, start + 20); return j({ entries: es, truncated: start + 20 < all.length }); }
  if (body.inbox) return j({ files: [] }); // the first fetch finds nothing with the inbox: the client retries without it
  return j({ files: body.file_ids.map((id) => ({ file_id: id, payload: 'P-' + id })) }); };
const c = createLaneClient({ endpoint: 'https://dev.send.sgraph.ai', vaultId: 'testvault1', readKey: 'RK', fetch: server });
const p = await c.read();
assert.equal(p.length, 45); assert.equal(p[0], 'P-f0'); assert.equal(p[44], 'P-f44');
assert.ok(calls.every((x) => x.headers['x-sgraph-vault-enum-key'] === 'RK' && !x.url.includes('RK') && x.url.startsWith('https://dev.send.sgraph.ai/api/vault/append/')));
assert.equal(calls.filter((x) => x.url.includes('/list/')).length, 3, 'paged while truncated');
assert.equal(calls.filter((x) => x.url.includes('/fetch/')).length, 6, '3 batches of up to 20, each retried without inbox');
assert.equal(c.cursor, null); c.commit(); assert.equal(c.cursor, 'f44');
calls.length = 0; all.push({ file_id: 'f45', inbox: 'ib' }); assert.deepEqual(await c.read(), ['P-f45']); assert.equal(calls[0].body.after_file_id, 'f44', 'only new entries after the committed cursor');
for (const bad of [{ endpoint: 'http://dev.send.sgraph.ai' }, { endpoint: 'https://u:p@dev.send.sgraph.ai' }, { endpoint: 'https://dev.send.sgraph.ai/x' }, { vaultId: '../x' }, { readKey: '' }])
  assert.throws(() => createLaneClient({ endpoint: 'https://dev.send.sgraph.ai', vaultId: 'testvault1', readKey: 'RK', ...bad }), LaneClientError);
await assert.rejects(() => createLaneClient({ endpoint: 'https://dev.send.sgraph.ai', vaultId: 'testvault1', readKey: 'RK', fetch: async () => ({ ok: false, status: 403 }) }).read(), (e) => e.status === 403 && !e.message.includes('RK'));
console.log('lane client tests passed');
