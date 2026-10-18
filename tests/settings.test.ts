import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULTS, GATEWAYS, resolveUri } from '../src/core';
import { getSettings, restoreSettings, saveSettings } from '../src/storage';
const cid = 'bafybeie5nqv6kd3qnfjuprw2scvubkste4aq4oqasmoyzqmgtiqq4iqjqa';
test('new installations use Pinata path URLs for metadata and IPFS commands', () => {
  assert.equal(restoreSettings().gatewayUrl, 'https://gateway.pinata.cloud');
  assert.equal(resolveUri(`ipfs://${cid}/nested/1.json`, DEFAULTS), `https://gateway.pinata.cloud/ipfs/${cid}/nested/1.json`);
});
test('legacy default migrates once while preserving the configured RPC', () => {
  const old = { rpcUrl: 'https://rpc.example', gatewayUrl: 'https://dweb.link/', gatewayStyle: 'subdomain' as const };
  const migrated = restoreSettings(old);
  assert.equal(migrated.rpcUrl, 'https://rpc.example/');
  assert.equal(migrated.gatewayUrl, DEFAULTS.gatewayUrl);
  assert.equal(migrated.gatewayStyle, 'path');
  assert.equal(restoreSettings(old, 2).gatewayUrl, 'https://dweb.link');
});
test('legacy custom gateway is preserved', () => {
  const custom = { ...DEFAULTS, gatewayUrl: 'https://mine.example', gatewayStyle: 'subdomain' as const };
  assert.equal(restoreSettings(custom).gatewayUrl, custom.gatewayUrl);
  assert.equal(restoreSettings(custom).gatewayStyle, 'subdomain');
});
test('all public presets produce valid CID paths with their configured format', () => {
  for (const preset of GATEWAYS) {
    const url = new URL(resolveUri(`ipfs://${cid}/folder/a.json?q=1#item`, { ...DEFAULTS, ...preset }));
    assert.equal(url.search, '?q=1');
    assert.equal(url.hash, '#item');
    assert.equal(url.pathname, preset.gatewayStyle === 'path' ? `/ipfs/${cid}/folder/a.json` : '/folder/a.json');
    assert.equal(url.hostname, preset.gatewayStyle === 'path' ? new URL(preset.gatewayUrl).hostname : `${cid}.ipfs.${new URL(preset.gatewayUrl).hostname}`);
  }
});
test('storage saves the migration marker and respects later dweb selections', async () => {
  let state: Record<string, unknown> = { settings: { ...DEFAULTS, gatewayUrl: 'https://dweb.link', gatewayStyle: 'subdomain' }, lastContract: 'keep-me' };
  Object.assign(globalThis, { chrome: { storage: { local: {
    get: async () => ({ ...state }), set: async (values: Record<string, unknown>) => { state = { ...state, ...values }; },
  } } } });
  assert.equal((await getSettings()).gatewayUrl, DEFAULTS.gatewayUrl);
  assert.equal(state.settingsVersion, 2);
  assert.equal(state.lastContract, 'keep-me');
  await saveSettings({ ...DEFAULTS, gatewayUrl: 'https://dweb.link', gatewayStyle: 'subdomain' });
  assert.equal((await getSettings()).gatewayUrl, 'https://dweb.link');
});
