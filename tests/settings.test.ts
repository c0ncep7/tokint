import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULTS, GATEWAYS, resolveUri } from '../src/core';
import { getSettings, getSettingsState, restoreSettings, saveSettings, SESSION_RPC_KEY } from '../src/storage';
import { storageFixture } from './storage-fixture';
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
  const { local: state } = storageFixture({ settings: { ...DEFAULTS, gatewayUrl: 'https://dweb.link', gatewayStyle: 'subdomain' }, lastContract: 'keep-me' });
  assert.equal((await getSettings()).gatewayUrl, DEFAULTS.gatewayUrl);
  assert.equal(state.settingsVersion, 2);
  assert.equal(state.lastContract, 'keep-me');
  await saveSettings({ ...DEFAULTS, gatewayUrl: 'https://dweb.link', gatewayStyle: 'subdomain' });
  assert.equal((await getSettings()).gatewayUrl, 'https://dweb.link');
});

test('Alchemy and all custom RPC URLs stay in memory by default, including root URLs and query credentials', async () => {
  for (const rpcUrl of ['https://eth-mainnet.g.alchemy.com/v2/session-fixture', 'https://rpc.example/?key=session-fixture', 'https://private-rpc.example/']) {
    const saved = storageFixture();
    await saveSettings({ ...DEFAULTS, rpcUrl });
    assert.equal((await getSettings()).rpcUrl, rpcUrl);
    assert.equal((await getSettingsState()).rememberRpc, false);
    assert.ok(!JSON.stringify(saved.local).includes(rpcUrl));
    await chrome.storage.session.remove(SESSION_RPC_KEY);
    await assert.rejects(getSettings(), /session-only RPC URL has expired/);
    const state = await getSettingsState();
    assert.equal(state.sessionExpired, true);
    assert.equal(state.value.rpcUrl, '');
  }
});
test('explicit remember persists a custom RPC; opting out removes it from disk and changing providers clears the session', async () => {
  const saved = storageFixture();
  const value = { ...DEFAULTS, rpcUrl: 'https://eth-mainnet.g.alchemy.com/v2/remember-fixture' };
  await saveSettings(value, true);
  assert.ok(JSON.stringify(saved.local).includes('remember-fixture'));
  assert.deepEqual(saved.session, {});
  assert.equal((await getSettingsState()).rememberRpc, true);
  assert.deepEqual(await getSettings(), value);
  await saveSettings(value, false);
  assert.ok(!JSON.stringify(saved.local).includes('remember-fixture'));
  assert.equal((await getSettings()).rpcUrl, value.rpcUrl);
  await saveSettings({ ...DEFAULTS, rpcUrl: 'https://eth.drpc.org' });
  assert.equal(saved.session[SESSION_RPC_KEY], undefined);
  assert.equal((await getSettings()).rpcUrl, 'https://eth.drpc.org/');
});
test('public presets and ordinary settings persist without credential consent', async () => {
  const saved = storageFixture();
  await saveSettings({ ...DEFAULTS, rpcUrl: 'https://public.1rpc.io/eth', gatewayUrl: 'https://my-gateway.example', gatewayStyle: 'subdomain' });
  assert.deepEqual(saved.session, {});
  assert.equal((await getSettings()).gatewayUrl, 'https://my-gateway.example');
  assert.equal((await getSettings()).rpcUrl, 'https://public.1rpc.io/eth');
});
test('pre-vault plaintext endpoints move into the session without inferring remember consent', async () => {
  const saved = storageFixture({ settings: { ...DEFAULTS, rpcUrl: 'https://rpc.example/old-fixture-key' }, settingsVersion: 2 });
  assert.equal((await getSettings()).rpcUrl, 'https://rpc.example/old-fixture-key');
  assert.ok(!JSON.stringify(saved.local).includes('old-fixture-key'));
  await chrome.storage.session.remove(SESSION_RPC_KEY);
  await assert.rejects(getSettings(), /expired/);
});
test('failed saves restore the previous session and mismatched session records cannot select a different endpoint', async () => {
  const saved = storageFixture();
  await saveSettings({ ...DEFAULTS, rpcUrl: 'https://rpc.example/first' });
  const original = chrome.storage.local.set;
  chrome.storage.local.set = (async () => { throw new Error('Quota fixture'); }) as typeof original;
  await assert.rejects(saveSettings({ ...DEFAULTS, rpcUrl: 'https://rpc.example/second' }), /Quota fixture/);
  chrome.storage.local.set = original;
  assert.equal((await getSettings()).rpcUrl, 'https://rpc.example/first');
  saved.session[SESSION_RPC_KEY] = { id: 'unrelated-revision', rpcUrl: 'https://rpc.example/stale' };
  await assert.rejects(getSettings(), /expired/);
});
test('old encrypted preferences are discarded without a passphrase and reset only once', async () => {
  for (const header of [undefined, { version: 1 }]) {
    const sealed = { sealed: 1, ciphertext: 'obsolete-fixture' };
    const saved = storageFixture({ vaultHeader: header, settings: sealed, lastContract: sealed, theme: sealed });
    saved.session.tokintVaultSession = { material: 'obsolete-session-fixture' };
    assert.equal((await getSettingsState()).value.gatewayUrl, DEFAULTS.gatewayUrl);
    for (const key of ['vaultHeader', 'lastContract', 'theme']) assert.equal(saved.local[key], undefined);
    assert.equal(saved.session.tokintVaultSession, undefined);
    await saveSettings({ ...DEFAULTS, rpcUrl: 'https://rpc.example/new-key' }, true);
    assert.equal((await getSettingsState()).rememberRpc, true);
    assert.equal((await getSettings()).rpcUrl, 'https://rpc.example/new-key');
  }
});
test('saving new settings directly clears the retired encrypted preferences', async () => {
  const saved = storageFixture({ vaultHeader: { version: 1 }, settings: { sealed: 1 } });
  await saveSettings({ ...DEFAULTS, rpcUrl: 'https://rpc.example/session-key' });
  assert.equal(saved.local.vaultHeader, undefined);
  assert.ok(!JSON.stringify(saved.local).includes('session-key'));
  assert.equal((await getSettings()).rpcUrl, 'https://rpc.example/session-key');
});
