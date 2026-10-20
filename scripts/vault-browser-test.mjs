import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { mkdtemp, mkdir, rm } from 'node:fs/promises';
import path from 'node:path';
import { TEST_PASSPHRASE } from './vault-browser-helpers.mjs';
await mkdir('test-results', { recursive: true });
const profile = await mkdtemp(path.resolve('test-results/vault-profile-'));
const launch = () => chromium.launchPersistentContext(profile, {
  executablePath: process.env.CHROMIUM_EXECUTABLE || undefined,
  channel: process.env.CHROMIUM_EXECUTABLE ? undefined : 'chromium', headless: true,
  args: [`--disable-extensions-except=${path.resolve('extension')}`, `--load-extension=${path.resolve('extension')}`],
});
let context;
let checks = 0;
const pass = name => { checks++; console.log(`PASS ${name}`); };
try {
  context = await launch();
  const worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker');
  const root = `chrome-extension://${new URL(worker.url()).host}`;
  const page = await context.newPage();
  await page.goto(`${root}/options.html`);
  await page.locator('#vault-confirm').waitFor();
  const fixture = {
    settings: { rpcUrl: 'https://rpc.example.invalid/vault-private-fixture', gatewayUrl: 'https://gateway.pinata.cloud', gatewayStyle: 'path' },
    lastContract: '0x0000000000000000000000000000000000000001',
  };
  await page.evaluate(async fixture => {
    await chrome.storage.local.set({ ...fixture, settingsVersion: 2 });
    localStorage.setItem('tokint-theme', 'light');
    await new Promise((resolve, reject) => {
      const open = indexedDB.open('tokint-recents', 1);
      open.onupgradeneeded = () => { open.result.createObjectStore('tokens', { keyPath: 'key' }); open.result.createObjectStore('control'); };
      open.onerror = () => reject(open.error);
      open.onsuccess = () => {
        const db = open.result; const tx = db.transaction('tokens', 'readwrite');
        tx.objectStore('tokens').put({ key: 'legacy-identity-fixture', contract: fixture.lastContract, token: '410', method: 'auto', name: 'Encrypted cache fixture', visitedAt: Date.now(),
          snapshot: { scope: 'fixture', fetchedAt: Date.now(), result: { raw: 'ipfs://fixture', method: 'uri' }, metadata: { data: { name: 'Private metadata fixture' }, url: 'https://example.invalid/metadata' },
            image: { url: 'https://example.invalid/image', blob: new Blob([new Uint8Array([1, 2, 0, 255])], { type: 'image/png' }) } } });
        tx.oncomplete = () => { db.close(); resolve(); }; tx.onerror = () => reject(tx.error);
      };
    });
  }, fixture);
  await page.locator('#vault-passphrase').fill(TEST_PASSPHRASE);
  await page.locator('#vault-confirm').fill('different fixture passphrase');
  await page.getByRole('button', { name: 'Create encrypted vault' }).click();
  assert.match(await page.locator('#vault-status').textContent(), /do not match/);
  await page.locator('#vault-confirm').fill(TEST_PASSPHRASE);
  await page.getByRole('button', { name: 'Create encrypted vault' }).click();
  await page.locator('#vault-dialog').waitFor({ state: 'detached' });
  await page.waitForFunction(url => document.querySelector('#rpc-url').value === url, fixture.settings.rpcUrl);
  const stored = await page.evaluate(async () => {
    const local = await chrome.storage.local.get(null);
    const session = await chrome.storage.session.get(null);
    const disk = await new Promise((resolve, reject) => {
      const open = indexedDB.open('tokint-recents', 1);
      open.onsuccess = () => { const db = open.result; const tx = db.transaction('tokens'); const req = tx.objectStore('tokens').getAll(); req.onsuccess = () => resolve(req.result); tx.oncomplete = () => db.close(); }; open.onerror = () => reject(open.error);
    });
    return { local, session, disk, theme: localStorage.getItem('tokint-theme') };
  });
  const diskText = JSON.stringify([stored.local, stored.disk]);
  for (const text of [TEST_PASSPHRASE, fixture.lastContract, 'vault-private-fixture', 'legacy-identity-fixture', 'Private metadata fixture', 'Encrypted cache fixture']) assert.ok(!diskText.includes(text), `Persisted plaintext: ${text}`);
  assert.equal(stored.theme, null);
  assert.equal(stored.disk[0].record.sealed, 1);
  assert.equal(stored.local.settings.sealed, 1);
  assert.ok(stored.session.tokintVaultSession.material);
  assert.ok(!JSON.stringify(stored.local).includes(stored.session.tokintVaultSession.material));
  pass('first-run confirmation and migration encrypt settings, last contract, theme, metadata, media, and cache identities');
  const read = async target => target.evaluate(async () => {
    const storage = await import(chrome.runtime.getURL('storage.js'));
    const cache = await import(chrome.runtime.getURL('token-cache.js'));
    const row = (await cache.readCache()).rows[0];
    return { settings: await storage.getSettings(), lastContract: await storage.getLastContract(), name: row.name,
      image: [...new Uint8Array(await row.snapshot.image.blob.arrayBuffer())] };
  });
  assert.deepEqual((await read(page)).image, [1, 2, 0, 255]);
  await context.close();
  context = await launch();
  const locked = await context.newPage();
  await locked.goto(`${root}/options.html`);
  await locked.locator('#vault-passphrase').waitFor();
  assert.equal(await locked.locator('#vault-confirm').count(), 0);
  assert.equal(await locked.locator('#rpc-url').inputValue(), '');
  assert.equal(await locked.evaluate(async () => (await chrome.storage.session.get('tokintVaultSession')).tokintVaultSession), undefined);
  await locked.locator('#vault-passphrase').fill('incorrect passphrase fixture');
  await locked.getByRole('button', { name: 'Unlock', exact: true }).click();
  await locked.waitForFunction(() => document.querySelector('#vault-status').textContent.includes('Incorrect passphrase'));
  assert.equal(await locked.locator('#rpc-url').inputValue(), '');
  await locked.locator('#vault-passphrase').fill(TEST_PASSPHRASE);
  await locked.getByRole('button', { name: 'Unlock', exact: true }).click();
  await locked.locator('#vault-dialog').waitFor({ state: 'detached' });
  const restored = await read(locked);
  assert.deepEqual(restored.settings, fixture.settings);
  assert.equal(restored.lastContract, fixture.lastContract);
  assert.deepEqual(restored.image, [1, 2, 0, 255]);
  pass('full browser restart loses the key, rejects a wrong passphrase, and restores exact data with the correct one');
  const other = await context.newPage(); await other.goto(`${root}/results.html`);
  await other.locator('#contract').waitFor({ state: 'visible' });
  await other.waitForFunction(address => document.querySelector('#contract').value === address, fixture.lastContract);
  await locked.getByRole('button', { name: 'Lock saved data' }).click();
  for (const tab of [locked, other]) await tab.locator('#vault-passphrase').waitFor();
  assert.equal(await other.locator('#contract').inputValue(), '');
  pass('manual lock reloads every open page and removes visible decrypted values');
  console.log(`${checks} vault/browser checks passed.`);
} finally { await context?.close(); await rm(profile, { recursive: true, force: true }); }
