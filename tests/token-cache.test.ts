import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULTS } from '../src/core';
import { CACHE_AGE, CACHE_BYTES, cacheKey, cacheScope, pruneCache, snapshotBytes, usableSnapshot, type RecentToken } from '../src/token-cache';
const contract = '0x00000000000000000000000000000000000000ab';
const now = 1_800_000_000_000;
const row = (n: number): RecentToken => ({ key: cacheKey(contract, String(n), 'auto'), contract, token: String(n), method: 'auto', name: '', visitedAt: now + n,
  snapshot: { scope: 'scope', fetchedAt: now, result: { raw: 'ipfs://fixture', method: 'tokenURI' }, metadata: { data: { name: 'Artwork' }, url: 'https://example.org/meta' } } });
test('cache identity normalizes addresses and large token IDs without mixing metadata methods', () => {
  const id = (2n ** 256n - 1n).toString();
  assert.equal(cacheKey(contract, `00${id}`, 'auto'), cacheKey(contract.toUpperCase().replace('0X','0x'), id, 'auto'));
  assert.notEqual(cacheKey(contract, id, 'auto'), cacheKey(contract, id, 'uri'));
  assert.throws(() => cacheKey(contract, '-1', 'auto'));
});
test('cache expires at 24 hours and invalidates on RPC/gateway changes without storing URLs', async () => {
  const scope = await cacheScope(DEFAULTS);
  assert.match(scope, /^[a-f0-9]{64}$/);
  for (const settings of [{ ...DEFAULTS, rpcUrl: 'https://example.org/rpc' }, { ...DEFAULTS, gatewayUrl: 'https://example.org' }, { ...DEFAULTS, gatewayStyle: 'subdomain' as const }]) assert.notEqual(await cacheScope(settings), scope);
  const r = row(1);
  assert.ok(usableSnapshot(r, 'scope', now + CACHE_AGE - 1));
  assert.equal(usableSnapshot(r, 'scope', now + CACHE_AGE), undefined);
  assert.equal(usableSnapshot(r, 'different', now), undefined);
  assert.equal(usableSnapshot(r, 'scope', now - 1), undefined);
});
test('least recently visited tokens are evicted beyond 30; expired metadata leaves a recent shortcut', () => {
  const rows = pruneCache(Array.from({ length: 35 }, (_, i) => row(i)), now);
  assert.equal(rows.length, 30); assert.equal(rows[0].token, '34'); assert.equal(rows.at(-1)?.token, '5');
  const expired = pruneCache([row(1)], now + CACHE_AGE);
  assert.equal(expired[0].snapshot, undefined); assert.equal(expired[0].token, '1');
});
test('cache byte budget includes original blobs and preserves recents when snapshots are evicted', () => {
  const rows = Array.from({ length: 4 }, (_, i) => row(i));
  const blob = new Blob([new Uint8Array(20 * 1024 * 1024)], { type: 'image/png' });
  for (const r of rows) r.snapshot!.image = { url: 'https://example.org/art.png', blob };
  const pruned = pruneCache(rows, now);
  assert.equal(pruned.length, 4);
  assert.equal(pruned.filter(r => r.snapshot).length, 2);
  assert.ok(pruned.reduce((n, r) => n + (r.snapshot ? snapshotBytes(r.snapshot) : 0), 0) <= CACHE_BYTES);
  assert.ok(rows[0].snapshot, 'pruning does not mutate callers');
});

test('method variants do not reduce the 30 distinct-token recent limit', () => {
  const rows = Array.from({ length: 31 }, (_, i) => row(i));
  const variant = { ...row(30), key: cacheKey(contract, '30', 'uri'), method: 'uri' as const };
  const pruned = pruneCache([...rows, variant], now);
  assert.equal(new Set(pruned.map(r => r.token)).size, 30);
  assert.equal(pruned.filter(r => r.token === '30').length, 2);
  assert.ok(!pruned.some(r => r.token === '0'));
});
