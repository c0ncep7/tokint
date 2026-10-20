import { test } from 'node:test';
import assert from 'node:assert/strict';
import { base64, deriveVaultKeys, recordId, sealJson, unsealJson, VAULT_ITERATIONS } from '../src/vault-crypto';
import { lockVault, migratePreferences, openVault, readPrivate, SESSION_KEY, vaultKeys, writePrivate } from '../src/vault';
import { decodeRecent, encodeRecent, type RecentToken } from '../src/token-cache';
import { storageFixture, TEST_PASSPHRASE } from './vault-fixture';

test('vault authenticates records, binds their purpose, and uses unique nonces', async () => {
  const salt = base64(crypto.getRandomValues(new Uint8Array(16)));
  const { keys } = await deriveVaultKeys(TEST_PASSPHRASE, salt);
  const first = await sealJson(keys, 'settings', { endpoint: 'https://example.invalid/private-fixture' });
  const second = await sealJson(keys, 'settings', { endpoint: 'https://example.invalid/private-fixture' });
  assert.notEqual(first.iv, second.iv);
  assert.notDeepEqual(first.ciphertext, second.ciphertext);
  assert.deepEqual(await unsealJson(keys, 'settings', first), { endpoint: 'https://example.invalid/private-fixture' });
  await assert.rejects(unsealJson(keys, 'lastContract', first));
  const tampered = first.ciphertext.slice(0);
  new Uint8Array(tampered)[0] ^= 1;
  await assert.rejects(unsealJson(keys, 'settings', { ...first, ciphertext: tampered }));
  const other = await deriveVaultKeys(TEST_PASSPHRASE, base64(crypto.getRandomValues(new Uint8Array(16))));
  await assert.rejects(unsealJson(other.keys, 'settings', first));
  assert.notEqual(await recordId(keys, 'contract:410'), await recordId(other.keys, 'contract:410'));
  await assert.rejects(deriveVaultKeys(TEST_PASSPHRASE, salt, VAULT_ITERATIONS * 100));
});

test('vault migrates plaintext preferences, never persists its key, and locks after session loss', async () => {
  const fixture = storageFixture({ settings: { rpcUrl: 'private-fixture-endpoint' }, lastContract: 'private-fixture-contract' });
  await openVault(TEST_PASSPHRASE, migratePreferences);
  assert.deepEqual(await readPrivate('settings'), { rpcUrl: 'private-fixture-endpoint' });
  assert.equal(await readPrivate('lastContract'), 'private-fixture-contract');
  assert.ok(fixture.session[SESSION_KEY]);
  const persisted = JSON.stringify(fixture.local);
  for (const secret of [TEST_PASSPHRASE, 'private-fixture-endpoint', 'private-fixture-contract', 'material']) assert.ok(!persisted.includes(secret));
  await writePrivate('theme', 'light');
  await lockVault();
  await assert.rejects(vaultKeys(), /Unlock TOKINT/);
  await assert.rejects(readPrivate('settings'), /Unlock TOKINT/);
  await assert.rejects(openVault('wrong passphrase fixture', migratePreferences), /Incorrect passphrase/);
  assert.equal(fixture.session[SESSION_KEY], undefined);
  await openVault(TEST_PASSPHRASE, migratePreferences);
  assert.equal(await readPrivate('theme'), 'light');
  assert.equal(await readPrivate('lastContract'), 'private-fixture-contract');
});

test('vault accepts six-character passphrases for creation and unlock while rejecting invalid lengths', async () => {
  const fixture = storageFixture();
  for (const invalid of ['', 'short', '      ', 'x'.repeat(1025)]) {
    await assert.rejects(openVault(invalid, migratePreferences), /6–1024 characters/);
  }
  assert.equal(fixture.local.vaultHeader, undefined);
  assert.equal(fixture.session[SESSION_KEY], undefined);
  await openVault('vault6', migratePreferences);
  await writePrivate('theme', 'dark');
  await lockVault();
  await assert.rejects(openVault('wrong6', migratePreferences), /Incorrect passphrase/);
  assert.equal(fixture.session[SESSION_KEY], undefined);
  await openVault('vault6', migratePreferences);
  assert.equal(await readPrivate('theme'), 'dark');
});

test('failed migration does not publish an unlocked session and can be retried', async () => {
  const fixture = storageFixture({ lastContract: 'migration-fixture' });
  await assert.rejects(openVault(TEST_PASSPHRASE, async () => { throw new Error('Quota fixture'); }), /Quota fixture/);
  assert.ok(fixture.local.vaultHeader);
  assert.equal(fixture.session[SESSION_KEY], undefined);
  await openVault(TEST_PASSPHRASE, migratePreferences);
  assert.equal(await readPrivate('lastContract'), 'migration-fixture');
});

test('encrypted cache payload preserves metadata and exact original media bytes', async () => {
  const original = new Uint8Array([0, 255, 12, 99]);
  const row: RecentToken = {
    key: 'fixture:410:auto', contract: 'fixture', token: '410', method: 'auto', name: 'Example', visitedAt: 1,
    snapshot: { scope: 'scope', fetchedAt: 1, result: { raw: 'ipfs://fixture', method: 'uri' },
      metadata: { data: { name: 'Example' }, url: 'https://example.invalid' },
      image: { url: 'https://example.invalid/image', blob: new Blob([original], { type: 'image/png' }) } },
  };
  const bytes = await encodeRecent(row);
  const restored = decodeRecent(bytes);
  assert.equal(restored.snapshot!.image!.blob.type, 'image/png');
  assert.deepEqual(new Uint8Array(await restored.snapshot!.image!.blob.arrayBuffer()), original);
  assert.deepEqual(restored.snapshot!.metadata, row.snapshot!.metadata);
  assert.equal(restored.key, row.key);
  assert.throws(() => decodeRecent(bytes.slice(0, -1)));
});
