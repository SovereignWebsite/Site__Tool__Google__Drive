// What the relay page keeps between visits, so it never reposts: the seen hashes, the per-author chain state, and whether it has started.
// Built on the same { get, put, del } store as relay-keys (IndexedDB in the page, memory in tests).
export function createRelayState(store) {
  return {
    seen: { has: async (k) => !!(await store.get('seen:' + k)), add: async (k) => { await store.put('seen:' + k, 1); } },
    chains: { get: async (k) => (await store.get('chain:' + k)) || null, set: async (k, v) => { await store.put('chain:' + k, v); } },
    state: { isInitialised: async () => !!(await store.get('initialised')), markInitialised: async () => { await store.put('initialised', new Date().toISOString()); } }
  };
}
