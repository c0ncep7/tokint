import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULTS, Failure } from '../src/core';
import { alchemyEnabled, alchemyRequest, apiTokenId, browseTokens, parseBrowse, parseMint, parseOwners, thumbnailUrl } from '../src/alchemy';
const prefs = { ...DEFAULTS, rpcUrl: 'https://eth-mainnet.g.alchemy.com/v2/test-fixture' };
const contract = '0x0000000000000000000000000000000000000001';
const allowed = async () => true;
const sample = (tokenId = '1') => ({ contract: { address: contract, name: 'Collection' }, tokenId, name: '<script>test</script>', image: { thumbnailUrl: 'https://res.cloudinary.com/alchemyapi/image/upload/fixture.png' } });
test('Alchemy features require a valid configured mainnet endpoint and reject placeholders/lookalikes', () => {
  assert.ok(alchemyEnabled(prefs)); assert.equal(alchemyEnabled(DEFAULTS), false);
  for (const rpcUrl of ['https://eth-mainnet.g.alchemy.com/v2/YOUR_API_KEY', 'https://eth-sepolia.g.alchemy.com/v2/test-fixture', 'https://eth-mainnet.g.alchemy.com.evil.test/v2/test-fixture', 'https://user:pass@eth-mainnet.g.alchemy.com/v2/test-fixture', 'http://eth-mainnet.g.alchemy.com/v2/test-fixture', 'https://eth-mainnet.g.alchemy.com/v2/%2fother', 'https://eth-mainnet.g.alchemy.com/v2/test-fixture?other=1']) assert.equal(alchemyEnabled({ ...prefs, rpcUrl }), false);
});
test('disabled Alchemy does not request host access or make requests', async () => {
  await assert.rejects(alchemyRequest(DEFAULTS, 'getNFTMetadata', {}, { permitted: async () => { throw new Error('Unexpected permission check'); } }), /Configure Alchemy/);
});
test('collection and wallet pagination use their documented parameters without losing IDs', async () => {
  const cursor = '0x10000000000000000000000000000000';
  for (const mode of ['collection', 'wallet'] as const) {
    const result = await browseTokens(prefs, mode, contract, cursor, { permitted: allowed, fetcher: async input => {
      const url = new URL(String(input));
      assert.equal(url.pathname, `/nft/v3/test-fixture/${mode === 'collection' ? 'getNFTsForContract' : 'getNFTsForOwner'}`);
      assert.equal(url.searchParams.get(mode === 'collection' ? 'startToken' : 'pageKey'), cursor);
      assert.equal(url.searchParams.get(mode === 'collection' ? 'limit' : 'pageSize'), '24');
      assert.equal(url.searchParams.get(mode === 'collection' ? 'contractAddress' : 'owner'), contract);
      assert.equal(url.searchParams.get('tokenUriTimeoutInMs'), '0');
      return Response.json({ [mode === 'collection' ? 'nfts' : 'ownedNfts']: [sample(cursor)], pageKey: 'next+cursor' });
    } });
    assert.equal(result.items[0].token, BigInt(cursor).toString()); assert.equal(result.next, 'next+cursor');
  }
});
test('API token IDs preserve uint256 precision and reject numeric/overflow/malformed IDs', () => {
  const maximum = 2n ** 256n - 1n;
  assert.equal(apiTokenId('0x' + maximum.toString(16)), maximum.toString());
  for (const value of [3, -1, '1.5', '0x', '-1', String(maximum + 1n)]) assert.throws(() => apiTokenId(value));
});
test('browse parser tolerates missing names/images, skips invalid identities, and rejects malformed lists', () => {
  const result = parseBrowse({ nfts: [sample(), sample(), { tokenId: '2' }, sample('-1'), { ...sample('3'), contract: { address: '0x0000000000000000000000000000000000000002' } }], nextToken: '4' }, 'collection', contract);
  assert.equal(result.items.length, 2); assert.equal(result.skipped, 2); assert.equal(result.next, '4');
  assert.equal(result.items[1].thumbnail, undefined);
  assert.throws(() => parseBrowse({ ownedNfts: 'bad' }, 'wallet'));
});
test('thumbnail URLs are restricted to known Alchemy CDN paths and cannot execute metadata', () => {
  assert.ok(thumbnailUrl('https://nft-cdn.alchemy.com/eth-mainnet/art'));
  assert.ok(thumbnailUrl('https://res.cloudinary.com/alchemyapi/image/upload/art'));
  for (const value of ['javascript:alert(1)', 'data:image/svg+xml,xxx', 'https://example.com/art', 'https://res.cloudinary.com/other/art', 'https://user:pass@nft-cdn.alchemy.com/art', 'https://nft-cdn.alchemy.com.evil.test/art']) assert.equal(thumbnailUrl(value), undefined);
});
test('Alchemy errors are useful but never echo response bodies or configured URLs', async () => {
  for (const status of [401, 403, 429, 503]) await assert.rejects(alchemyRequest(prefs, 'getNFTMetadata', {}, { permitted: allowed, fetcher: async () => new Response(prefs.rpcUrl, { status }) }), (e: unknown) => e instanceof Failure && !e.message.includes('test-fixture') && (status === 429 ? /rate limited/.test(e.message) : true));
  await assert.rejects(alchemyRequest(prefs, 'getNFTMetadata', {}, { permitted: allowed, fetcher: async () => Response.json({ error: prefs.rpcUrl }) }), /could not complete/);
  await assert.rejects(alchemyRequest(prefs, 'getNFTMetadata', {}, { permitted: allowed, fetcher: async () => new Response('<html>') }), /invalid JSON/);
});
test('permission denial stops Alchemy requests and retains a narrow retry origin', async () => {
  await assert.rejects(alchemyRequest(prefs, 'getNFTMetadata', {}, { permitted: async () => false, fetcher: async () => { throw new Error('Unexpected network'); } }), (e: unknown) => e instanceof Failure && e.kind === 'permission' && e.origin === 'https://eth-mainnet.g.alchemy.com/*');
});
test('Alchemy requests are bounded and abortable', async () => {
  await assert.rejects(alchemyRequest(prefs, 'getNFTMetadata', {}, { permitted: allowed, fetcher: async () => new Response('', { headers: { 'content-length': String(9 * 1024 * 1024) } }) }), /exceeds/);
  const controller = new AbortController(); controller.abort();
  await assert.rejects(alchemyRequest(prefs, 'getNFTMetadata', {}, { signal: controller.signal, permitted: allowed }), (e: unknown) => e instanceof DOMException && e.name === 'AbortError');
  await assert.rejects(alchemyRequest(prefs, 'getNFTMetadata', {}, { permitted: allowed, timeoutMs: 5, fetcher: async (_url, init) => new Promise((_resolve, reject) => init?.signal?.addEventListener('abort', () => reject(new DOMException('aborted','AbortError')))) }), /timed out/);
});
test('owner results identify partial lists and mint recipient is not called the creator', () => {
  assert.deepEqual(parseOwners({ owners: null }), { owners: [], incomplete: false });
  const owners = parseOwners({ owners: [contract, contract, 'invalid'], pageKey: 'more' });
  assert.deepEqual(owners.owners, [contract]); assert.equal(owners.incomplete, true);
  assert.deepEqual(parseMint({ mint: { mintAddress: contract, blockNumber: 123, timestamp: '2020-01-01T00:00:00Z', transactionHash: '0x' + 'ab'.repeat(32) } }), { recipient: contract, block: '123', date: '2020-01-01T00:00:00.000Z', tx: '0x' + 'ab'.repeat(32) });
  assert.ok(Object.values(parseMint({})).every(v => v === undefined));
  assert.ok(Object.values(parseMint({ mint: { mintAddress: 'javascript:alert(1)', transactionHash: 'bad', blockNumber: Number.MAX_SAFE_INTEGER + 1, timestamp: 'bad' } })).every(v => v === undefined));
});
