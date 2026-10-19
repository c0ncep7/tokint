import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULTS, settings } from '../src/core';
import { RPC_PRESETS, rpcPreset, validateAlchemyRpc } from '../src/rpc-presets';
test('RPC presets round-trip normalized URLs and preserve custom configurations', () => {
  for (const item of RPC_PRESETS) assert.equal(rpcPreset(settings({ ...DEFAULTS, rpcUrl: item.url }).rpcUrl), item.id);
  assert.equal(rpcPreset('https://custom.example/rpc'), 'custom');
  assert.equal(rpcPreset('https://eth-mainnet.g.alchemy.com/v2/test-fixture'), 'alchemy');
  validateAlchemyRpc('https://eth-mainnet.g.alchemy.com/v2/test-fixture');
  for (const bad of ['https://eth-mainnet.g.alchemy.com/v2/YOUR_API_KEY', 'https://eth-mainnet.g.alchemy.com/v2/', 'https://eth-mainnet.g.alchemy.com.example/v2/test-fixture', 'https://arb-mainnet.g.alchemy.com/v2/test-fixture']) assert.throws(() => validateAlchemyRpc(bad));
});
