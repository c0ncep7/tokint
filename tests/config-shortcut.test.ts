import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULTS, settings } from '../src/core';
import { RPC_PRESETS, rpcPreset, validateAlchemyRpc } from '../src/rpc-presets';
import { allowedGatewayRequest, extensionId, gatewayReply, gatewaySettings, ipfsDestination } from '../src/ipfs-bridge';
import { IPFS_COMPANION_ID } from '../src/ipfs-companion-id';
const cid = 'QmYwAPJzv5CZsnAzt8auVTLnEKjHhhtvE4s1wKpR1X4M8F';
test('RPC presets round-trip normalized URLs and preserve custom configurations', () => {
  for (const item of RPC_PRESETS) assert.equal(rpcPreset(settings({ ...DEFAULTS, rpcUrl: item.url }).rpcUrl), item.id);
  assert.equal(rpcPreset('https://custom.example/rpc'), 'custom');
  assert.equal(rpcPreset('https://eth-mainnet.g.alchemy.com/v2/test-fixture'), 'alchemy');
  validateAlchemyRpc('https://eth-mainnet.g.alchemy.com/v2/test-fixture');
  for (const bad of ['https://eth-mainnet.g.alchemy.com/v2/YOUR_API_KEY', 'https://eth-mainnet.g.alchemy.com/v2/', 'https://eth-mainnet.g.alchemy.com.example/v2/test-fixture', 'https://arb-mainnet.g.alchemy.com/v2/test-fixture']) assert.throws(() => validateAlchemyRpc(bad));
});
test('gateway bridge only accepts its companion and never returns RPC configuration', () => {
  assert.equal(allowedGatewayRequest({ type: 'tokint-gateway' }, IPFS_COMPANION_ID), true);
  for (const sender of [undefined, 'a'.repeat(32)]) assert.equal(allowedGatewayRequest({ type: 'tokint-gateway' }, sender), false);
  assert.equal(allowedGatewayRequest({ type: 'settings' }, IPFS_COMPANION_ID), false);
  const reply = gatewayReply({ ...DEFAULTS, rpcUrl: 'https://custom.example/private-endpoint' });
  assert.deepEqual(Object.keys(reply).sort(), ['gatewayStyle', 'gatewayUrl', 'type', 'version']);
  assert.equal(JSON.stringify(reply).includes('private-endpoint'), false);
});
test('IPFS shortcut preserves nested paths and follows fresh gateway configuration', () => {
  const first = gatewaySettings(gatewayReply(DEFAULTS));
  const second = gatewaySettings(gatewayReply({ ...DEFAULTS, gatewayUrl: 'https://dweb.link', gatewayStyle: 'subdomain' }));
  const suffix = '/art/nested/file%20name.svg?download=1#frame';
  assert.match(ipfsDestination(cid + suffix, first), /^https:\/\/gateway.pinata.cloud\/ipfs\//);
  const result = ipfsDestination(`ipfs://${cid}${suffix}`, second);
  assert.ok(result.endsWith(suffix)); assert.match(result, /\.ipfs\.dweb.link\/art\//);
  assert.equal(ipfsDestination(ipfsDestination(cid + suffix, first), second), result);
  assert.throws(() => ipfsDestination('not-a-cid', first));
  assert.throws(() => ipfsDestination('javascript:alert(1)', first));
});
test('companion rejects invalid identities and unsafe gateway replies', () => {
  assert.equal(extensionId(IPFS_COMPANION_ID), IPFS_COMPANION_ID);
  assert.throws(() => extensionId('javascript:alert(1)'));
  for (const value of [null, {}, { ...gatewayReply(DEFAULTS), gatewayUrl: 'javascript:alert(1)' }, { ...gatewayReply(DEFAULTS), gatewayStyle: 'bad' }]) assert.throws(() => gatewaySettings(value));
});
