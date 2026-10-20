import { address, tokenId, type Method, type Settings } from './core';
import { vaultKeys } from './vault';
import { isSealed, recordId, seal, unseal, type Sealed, type VaultKeys } from './vault-crypto';

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
type EncryptedToken = { key: string; record: Sealed };
export async function encodeRecent(row: RecentToken): Promise<Uint8Array<ArrayBuffer>> {
  const image = row.snapshot?.image;
  const header = new TextEncoder().encode(JSON.stringify({ ...row,
    snapshot: row.snapshot && { ...row.snapshot, image: image && { url: image.url, type: image.blob.type, size: image.blob.size } },
  }));
  const body = image ? new Uint8Array(await image.blob.arrayBuffer()) : new Uint8Array();
  const packed = new Uint8Array(4 + header.length + body.length);
  new DataView(packed.buffer).setUint32(0, header.length);
  packed.set(header, 4); packed.set(body, 4 + header.length);
  return packed;
}
export function decodeRecent(bytes: Uint8Array<ArrayBuffer>): RecentToken {
  if (bytes.length < 4) throw new Error('Invalid cached record.');
  const size = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(0);
  if (size > bytes.length - 4) throw new Error('Invalid cached record.');
  const value = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes.slice(4, 4 + size)));
  if (value.snapshot?.image) {
    const image = value.snapshot.image;
    const body = bytes.slice(4 + size);
    if (body.length !== image.size) throw new Error('Invalid cached media.');
    value.snapshot.image = { url: image.url, blob: new Blob([body], { type: image.type }) };
  }
  return value as RecentToken;
}
async function encryptRow(keys: VaultKeys, row: RecentToken): Promise<EncryptedToken> {
  const key = await recordId(keys, row.key);
  return { key, record: await seal(keys, `recent:${key}`, await encodeRecent(row)) };
}
async function decryptRow(keys: VaultKeys, row: EncryptedToken): Promise<RecentToken> {
  if (!isSealed(row.record)) throw new Error('Cached data needs migration.');
  return decodeRecent(await unseal(keys, `recent:${row.key}`, row.record));
}
// Encryption runs outside IndexedDB transactions. The origin-wide Web Lock
// serializes mutations across tabs; the epoch still rejects stale network work.
async function contents(db: IDBDatabase) {
  const tx = db.transaction(['tokens', 'control'], 'readonly');
  const done = completion(tx);
  const [rows, epoch] = await Promise.all([
    request<EncryptedToken[]>(tx.objectStore('tokens').getAll()),
    request(tx.objectStore('control').get('epoch')), done,
  ]);
  return { rows, epoch: epoch ?? 0 };
}
export async function migrateTokenCache(keys: VaultKeys): Promise<void> {
  await navigator.locks.request('tokint-cache-write', async () => {
    const db = await database();
    try {
      const stored = await contents(db);
      const legacy = stored.rows.filter(row => !isSealed(row.record)) as unknown as RecentToken[];
      const encrypted = await Promise.all(legacy.map(row => encryptRow(keys, row)));
      const tx = db.transaction('tokens', 'readwrite');
      const done = completion(tx);
      for (let i = 0; i < legacy.length; i++) {
        tx.objectStore('tokens').delete(legacy[i].key);
        tx.objectStore('tokens').put(encrypted[i]);
      }
      await done;
    } finally { db.close(); }
  });
}
// A failed/quota-limited cache must never prevent the normal lookup.
export async function readCache(key?: string): Promise<{ rows: RecentToken[]; row?: RecentToken; epoch: number }> {
  let db: IDBDatabase | undefined;
  try {
    const keys = await vaultKeys();
    db = await database();
    const stored = await contents(db);
    const rows = await Promise.all(stored.rows.map(row => decryptRow(keys, row)));
    return { rows: rows.sort((a, b) => b.visitedAt - a.visitedAt), row: rows.find(r => r.key === key), epoch: stored.epoch };
  } catch { return { rows: [], epoch: -1 }; }
  finally { db?.close(); }
}
export async function updateCache(epoch: number, change: (rows: RecentToken[]) => RecentToken[]): Promise<void> {
  if (epoch < 0) return;
  try {
    await navigator.locks.request('tokint-cache-write', async () => {
      const keys = await vaultKeys();
      const db = await database();
      let transaction: IDBTransaction | undefined;
      try {
        const stored = await contents(db);
        if (stored.epoch !== epoch) return;
        const rows = await Promise.all(stored.rows.map(row => decryptRow(keys, row)));
        const next = pruneCache(change(rows));
        const previous = new Map(rows.map((row, i) => [row.key, { row, stored: stored.rows[i] }]));
        const nextKeys = new Set(next.map(row => row.key));
        const writes = await Promise.all(next.filter(row => previous.get(row.key)?.row !== row).map(row => encryptRow(keys, row)));
        const tx = transaction = db.transaction(['tokens', 'control'], 'readwrite');
        const done = completion(tx);
        // Account for older installed pages that do not participate in the lock.
        if ((await request(tx.objectStore('control').get('epoch')) ?? 0) === epoch) {
          for (const [key, value] of previous) if (!nextKeys.has(key)) tx.objectStore('tokens').delete(value.stored.key);
          for (const row of writes) tx.objectStore('tokens').put(row);
        }
        await done;
      } catch (error) {
        try { transaction?.abort(); } catch { /* Already completed/aborted. */ }
        throw error;
      } finally { db.close(); }
    });
  } catch { /* Cache unavailable; normal lookups still work. */ }
}
export async function clearCache(): Promise<boolean> {
  try {
    await navigator.locks.request('tokint-cache-write', async () => {
      const db = await database();
      try {
        const tx = db.transaction(['tokens', 'control'], 'readwrite');
        const done = completion(tx);
        const control = tx.objectStore('control');
        const epoch = await request(control.get('epoch'));
        tx.objectStore('tokens').clear(); control.put((epoch ?? 0) + 1, 'epoch');
        await done;
      } finally { db.close(); }
    });
    return true;
  } catch { return false; }
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
