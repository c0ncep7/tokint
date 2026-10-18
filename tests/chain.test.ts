import { test } from 'node:test';
import assert from 'node:assert/strict';
import { encodeAbiParameters } from 'viem';
import { chooseUri, readTokenUri, type ContractReader } from '../src/chain';
import { Failure } from '../src/core';
test('ERC-721 uses tokenURI and ERC-1155 uses uri', async () => {
  for (const standard of ['721', '1155']) {
    const methods: string[] = [];
    const read: ContractReader = async (method, argument) => {
      if (method === 'supportsInterface') return argument === (standard === '721' ? '0x5b5e139f' : '0x0e89341c');
      methods.push(method); return 'ipfs://example';
    };
    const result = await chooseUri(read, 1n, 'auto');
    assert.equal(result.method, standard === '721' ? 'tokenURI' : 'uri');
    assert.equal(methods.length, 1);
  }
});
test('contracts without ERC-165 can fall back from tokenURI to uri', async () => {
  const result = await chooseUri(async method => { if (method !== 'uri') throw new Failure('contract', 'unsupported'); return 'ipfs://example'; }, 1n, 'auto');
  assert.equal(result.method, 'uri');
});
test('empty URI falls back but a manual selection stays explicit', async () => {
  const read: ContractReader = async method => method === 'supportsInterface' ? false : method === 'tokenURI' ? '' : 'https://example.com';
  assert.equal((await chooseUri(read, 1n, 'auto')).method, 'uri');
  await assert.rejects(chooseUri(read, 1n, 'tokenURI'), /empty/);
});
test('both standards prefer tokenURI; manual method bypasses probes', async () => {
  const seen: string[] = [];
  const read: ContractReader = async method => { seen.push(method); return method === 'supportsInterface' ? true : 'https://example.com'; };
  assert.equal((await chooseUri(read, 1n, 'auto')).method, 'tokenURI');
  seen.length = 0; await chooseUri(read, 1n, 'uri'); assert.deepEqual(seen, ['uri']);
});
test('transport errors never silently trigger a different metadata method', async () => {
  const seen: string[] = [];
  await assert.rejects(chooseUri(async method => { seen.push(method); if (method === 'supportsInterface') return false; throw new Failure('rpc', 'offline'); }, 1n, 'auto'), (e: unknown) => e instanceof Failure && e.kind === 'rpc');
  assert.equal(seen.includes('uri'), false);
});
test('reverting metadata calls retain contract failure classification', async () => {
  await assert.rejects(chooseUri(async () => { throw new Failure('contract', 'reverted'); }, 99n, 'auto'), (e: unknown) => e instanceof Failure && e.kind === 'contract');
});
test('full viem read uses mainnet, latest block and precise token encoding', async () => {
  const calls: { method: string; params?: unknown[] }[] = [];
  const id = 900719925474099312345n;
  const result = await readTokenUri('https://example.com', '0x0000000000000000000000000000000000000001', id, 'tokenURI', {
    permitted: async () => true,
    fetcher: async (_url, init) => {
      const request = JSON.parse(String(init?.body)); calls.push(request);
      return Response.json({ jsonrpc: '2.0', id: request.id, result: request.method === 'eth_chainId' ? '0x1' : encodeAbiParameters([{ type: 'string' }], ['https://example.com/metadata']) });
    },
  });
  assert.equal(result.raw, 'https://example.com/metadata');
  assert.equal(calls[1].params?.[1], 'latest');
  const data = (calls[1].params?.[0] as { data: string }).data;
  assert.equal(data.slice(-64), id.toString(16).padStart(64, '0'));
});
test('wrong-chain RPC endpoints fail before any contract call', async () => {
  await assert.rejects(readTokenUri('https://example.com', '0x0000000000000000000000000000000000000001', 1n, 'auto', {
    permitted: async () => true, fetcher: async () => Response.json({ result: '0x89' }),
  }), /not Ethereum mainnet/);
});
test('JSON-RPC reverts and rate-limit errors survive viem wrapping', async () => {
  for (const [code, message, expected] of [[3, 'execution reverted', 'contract'], [-32005, 'rate limit', 'rpc']] as const) {
    await assert.rejects(readTokenUri('https://example.com', '0x0000000000000000000000000000000000000001', 1n, 'tokenURI', {
      permitted: async () => true,
      fetcher: async (_url, init) => JSON.parse(String(init?.body)).method === 'eth_chainId' ? Response.json({ result: '0x1' }) : Response.json({ error: { code, message } }),
    }), (e: unknown) => e instanceof Failure && e.kind === expected);
  }
});
