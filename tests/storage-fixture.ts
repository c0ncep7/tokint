export function storageFixture(initial: Record<string, unknown> = {}) {
  const local: Record<string, unknown> = { ...initial };
  const session: Record<string, unknown> = {};
  const area = (state: Record<string, unknown>) => ({
    get: async (keys?: string | string[]) => Object.fromEntries(
      (keys == null ? Object.keys(state) : typeof keys === 'string' ? [keys] : keys)
        .filter(key => key in state).map(key => [key, state[key]])),
    set: async (values: Record<string, unknown>) => { Object.assign(state, values); },
    remove: async (keys: string | string[]) => { for (const key of typeof keys === 'string' ? [keys] : keys) delete state[key]; },
    setAccessLevel: async () => {},
  });
  Object.assign(globalThis, { chrome: { storage: { local: area(local), session: area(session) } } });
  // Unit cases run sequentially. Browser coverage exercises real cross-tab locks.
  Object.defineProperty(globalThis, 'navigator', { configurable: true, value: {
    locks: { request: async (_name: string, run: () => Promise<unknown>) => run() },
  } });
  return { local, session, storage: chrome.storage };
}
