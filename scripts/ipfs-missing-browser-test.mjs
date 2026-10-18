import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { mkdtemp, rm, mkdir } from 'node:fs/promises';
import path from 'node:path';
await mkdir('test-results', { recursive: true });
const profile = await mkdtemp(path.resolve('test-results/missing-ipfs-profile-'));
const extension = path.resolve('extension');
const context = await chromium.launchPersistentContext(profile, {
  executablePath: process.env.CHROMIUM_EXECUTABLE || undefined,
  channel: process.env.CHROMIUM_EXECUTABLE ? undefined : 'chromium', headless: true,
  args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`],
});
try {
  const worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker');
  const id = new URL(worker.url()).host;
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(`chrome-extension://${id}/options.html`);
  const before = context.pages().length;
  for (let attempt = 0; attempt < 2; attempt++) {
    await page.locator('#connect-ipfs').click();
    await page.waitForFunction(() => document.querySelector('#ipfs-connection-status').textContent.includes('Load unpacked'));
    assert.equal(await page.locator('#connect-ipfs').isEnabled(), true);
    assert.equal(context.pages().length, before);
    assert.ok(page.url().endsWith('/options.html'));
  }
  // A stale companion responding without the new protocol gets the same recovery path.
  await page.evaluate(() => { chrome.runtime.sendMessage = async () => undefined; });
  await page.locator('#connect-ipfs').click();
  await page.waitForFunction(() => document.querySelector('#ipfs-connection-status').textContent.includes('reload both extensions'));
  assert.equal(context.pages().length, before);
  assert.deepEqual(errors, []);
  console.log('PASS missing companion and stale reply show recovery instructions without opening blocked tabs; Retry remains available');
} finally { await context.close(); await rm(profile, { recursive: true, force: true }); }
