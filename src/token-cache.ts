import { address, tokenId, type Method, type Settings } from './core';

export const RECENT_LIMIT = 30;
export const CACHE_BYTES = 50 * 1024 * 1024;
export const CACHE_AGE = 24 * 60 * 60 * 1000;
export type Snapshot = {
  scope: string; fetchedAt: number;
  result: { raw: string; method: 'tokenURI' | 'uri' };
  metadata: { data: Record<string, unknown>; url: string };
  image?: { url: string; blob: Blob };
};
export type RecentToken = {
  key: string; contract: string; token: string; method: Method;
  name: string; visitedAt: number; snapshot?: Snapshot;
};
export function cacheKey(contract: string, token: string, method: Method) {
  return `${address(contract).toLowerCase()}:${tokenId(token)}:${method}`;
}
export async function cacheScope(prefs: Settings) {
  // Do not duplicate provider URLs (which can contain credentials) in the cache.
  const bytes = new TextEncoder().encode(JSON.stringify([prefs.rpcUrl, prefs.gatewayUrl, prefs.gatewayStyle]));
  return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)), x => x.toString(16).padStart(2, '0')).join('');
}
export function snapshotBytes(snapshot: Snapshot): number {
  return new TextEncoder().encode(JSON.stringify({ ...snapshot, image: undefined })).length
    + (snapshot.image?.blob.size ?? 0) + (snapshot.image?.url.length ?? 0) * 2;
}
export function usableSnapshot(row: RecentToken | undefined, scope: string, now = Date.now()) {
  const snapshot = row?.snapshot;
  return snapshot && snapshot.scope === scope && now >= snapshot.fetchedAt && now - snapshot.fetchedAt < CACHE_AGE ? snapshot : undefined;
}
export function pruneCache(rows: RecentToken[], now = Date.now()): RecentToken[] {
  let bytes = 0;
  const sorted = [...rows].sort((a, b) => b.visitedAt - a.visitedAt);
  const identity = (row: RecentToken) => `${row.contract.toLowerCase()}:${row.token}`;
  const recentTokens = new Set([...new Set(sorted.map(identity))].slice(0, RECENT_LIMIT));
  return sorted.filter(row => recentTokens.has(identity(row))).map(row => {
    if (row.snapshot) {
      const size = snapshotBytes(row.snapshot);
      if (now - row.snapshot.fetchedAt >= CACHE_AGE || size + bytes > CACHE_BYTES) {
        const { snapshot: _snapshot, ...recent } = row;
        return recent;
      }
      bytes += size;
    }
    return row;
  });
}
function request<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => { req.onsuccess = () => resolve(req.result); req.onerror = () => reject(req.error); });
}
async function database(): Promise<IDBDatabase> {
  const req = indexedDB.open('tokint-recents', 1);
  req.onupgradeneeded = () => {
    req.result.createObjectStore('tokens', { keyPath: 'key' });
    req.result.createObjectStore('control');
  };
  return request(req);
}
function completion(tx: IDBTransaction) {
  const done = new Promise<void>((resolve, reject) => {
    tx.oncomplete = () => resolve(); tx.onabort = tx.onerror = () => reject(tx.error ?? new Error('Cache unavailable'));
  });
  // Attach a handler immediately, even when a request rejects before we await completion.
  void done.catch(() => {});
  return done;
}
// A failed/quota-limited cache must never prevent the normal lookup.
export async function readCache(key?: string): Promise<{ rows: RecentToken[]; row?: RecentToken; epoch: number }> {
  let db: IDBDatabase | undefined;
  try {
    db = await database();
    const tx = db.transaction(['tokens', 'control'], 'readonly');
    const done = completion(tx);
    const [rows, epoch] = await Promise.all([request<RecentToken[]>(tx.objectStore('tokens').getAll()), request(tx.objectStore('control').get('epoch')), done]);
    return { rows: rows.sort((a, b) => b.visitedAt - a.visitedAt), row: rows.find(r => r.key === key), epoch: epoch ?? 0 };
  } catch { return { rows: [], epoch: -1 }; }
  finally { db?.close(); }
}
export async function updateCache(epoch: number, change: (rows: RecentToken[]) => RecentToken[]): Promise<void> {
  if (epoch < 0) return;
  let db: IDBDatabase | undefined;
  let transaction: IDBTransaction | undefined;
  try {
    db = await database();
    const tx = transaction = db.transaction(['tokens', 'control'], 'readwrite');
    const done = completion(tx);
    const store = tx.objectStore('tokens');
    const [rows, currentEpoch] = await Promise.all([request<RecentToken[]>(store.getAll()), request(tx.objectStore('control').get('epoch'))]);
    if ((currentEpoch ?? 0) === epoch) {
      const next = pruneCache(change(rows));
      const previous = new Map(rows.map(row => [row.key, row]));
      const keys = new Set(next.map(row => row.key));
      for (const row of rows) if (!keys.has(row.key)) store.delete(row.key);
      // Avoid rewriting every cached media Blob when just one token was visited.
      for (const row of next) if (previous.get(row.key) !== row) store.put(row);
    }
    await done;
  } catch {
    // Roll back even synchronous quota/clone errors, preserving old entries.
    try { transaction?.abort(); } catch { /* Already completed/aborted. */ }
  }
  finally { db?.close(); }
}
export async function clearCache(): Promise<boolean> {
  let db: IDBDatabase | undefined;
  try {
    db = await database();
    const tx = db.transaction(['tokens', 'control'], 'readwrite');
    const done = completion(tx);
    const control = tx.objectStore('control');
    const epoch = await request(control.get('epoch'));
    tx.objectStore('tokens').clear(); control.put((epoch ?? 0) + 1, 'epoch');
    await done; return true;
  } catch { return false; }
  finally { db?.close(); }
}
export async function rememberToken(row: RecentToken, epoch: number) {
  await updateCache(epoch, rows => {
    const previous = rows.find(r => r.key === row.key);
    // An older request in another tab cannot replace a newer snapshot.
    if (previous && (previous.snapshot?.fetchedAt ?? 0) > (row.snapshot?.fetchedAt ?? 0)) return rows;
    return [...rows.filter(r => r.key !== row.key), row];
  });
}
export async function rememberImage(key: string, snapshot: Snapshot, image: { url: string; blob: Blob }, epoch: number) {
  await updateCache(epoch, rows => rows.map(row => row.key === key && row.snapshot?.fetchedAt === snapshot.fetchedAt && row.snapshot.scope === snapshot.scope
    ? { ...row, snapshot: { ...row.snapshot, image } } : row));
}
