import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { mkdtemp, rm, mkdir } from 'node:fs/promises';
import path from 'node:path';
await mkdir('test-results', { recursive: true });
const profile = await mkdtemp(path.resolve('test-results/config-profile-'));
const extensions = path.resolve('extension');
const context = await chromium.launchPersistentContext(profile, {
  executablePath: process.env.CHROMIUM_EXECUTABLE || undefined,
  channel: process.env.CHROMIUM_EXECUTABLE ? undefined : 'chromium',
  headless: true, viewport: { width: 1100, height: 1100 },
  args: [`--disable-extensions-except=${extensions}`, `--load-extension=${extensions}`],
});
let checks = 0;
const check = text => { checks++; console.log(`PASS ${text}`); };
try {
  const page = await context.newPage();
  const invalidCsp = [];
  page.on('console', message => { if (/invalid source/i.test(message.text())) invalidCsp.push(message.text()); });
  const main = context.serviceWorkers()[0] ?? await context.waitForEvent('serviceworker');
  const mainId = new URL(main.url()).host;
  const options = `chrome-extension://${mainId}/options.html`;
  await page.goto(options);
  await page.waitForFunction(() => document.querySelector('#rpc-preset').value === 'publicnode');
  assert.equal(await page.locator('#rpc-preset option').count(), 5);
  for (const [preset, url] of [['drpc', 'https://eth.drpc.org/'], ['1rpc', 'https://public.1rpc.io/eth']]) {
    await page.locator('#rpc-preset').selectOption(preset);
    assert.equal(await page.locator('#rpc-url').isDisabled(), true);
    await page.getByRole('button', { name: 'Save settings' }).click();
    await page.waitForFunction(() => document.querySelector('#settings-status').textContent.startsWith('Saved.'));
    await page.reload();
    await page.waitForFunction(p => document.querySelector('#rpc-preset').value === p, preset);
    assert.equal(new URL(await page.locator('#rpc-url').inputValue()).href, url);
  }
  check('public RPC presets save and restore normalized endpoints');
  await page.locator('#rpc-preset').selectOption('alchemy');
  assert.equal(await page.locator('#rpc-url').isDisabled(), false);
  assert.equal(await page.locator('#alchemy-help').isVisible(), true);
  await page.locator('#rpc-url').fill('https://eth-mainnet.g.alchemy.com/v2/YOUR_API_KEY');
  await page.getByRole('button', { name: 'Save settings' }).click();
  await page.waitForFunction(() => document.querySelector('#settings-status').textContent.startsWith('Paste your complete'));
  await page.locator('#rpc-url').fill('https://eth-mainnet.g.alchemy.com/v2/test-fixture');
  await page.getByRole('button', { name: 'Save settings' }).click();
  await page.waitForFunction(() => document.querySelector('#settings-status').textContent.startsWith('Saved.'));
  await page.reload();
  await page.waitForFunction(() => document.querySelector('#rpc-preset').value === 'alchemy');
  assert.equal(await page.locator('#rpc-url').inputValue(), 'https://eth-mainnet.g.alchemy.com/v2/test-fixture');
  async function verifyPrivacyLink(link) {
    assert.equal(await link.getAttribute('href'), 'privacy.html');
    const opened = context.waitForEvent('page');
    await link.click();
    const policy = await opened;
    await policy.waitForLoadState();
    assert.equal(policy.url(), `chrome-extension://${mainId}/privacy.html`);
    assert.match(await policy.locator('h1').textContent(), /privacy policy/i);
    await policy.close();
  }
  await verifyPrivacyLink(page.getByRole('link', { name: 'Privacy policy', exact: true }));
  await page.screenshot({ path: 'test-results/rpc-settings.png', fullPage: true });
  check('optional Alchemy endpoint persists and placeholder URLs are rejected');
  await page.locator('#rpc-preset').selectOption('custom');
  await page.locator('#rpc-url').fill('https://custom.example/rpc');
  await page.getByRole('button', { name: 'Save settings' }).click();
  await page.waitForFunction(() => document.querySelector('#settings-status').textContent.startsWith('Saved.'));
  await page.reload();
  await page.waitForFunction(() => document.querySelector('#rpc-preset').value === 'custom');
  assert.equal(await page.locator('#rpc-url').inputValue(), 'https://custom.example/rpc');
  check('custom endpoints remain editable and survive reload');
  await page.locator('#rpc-url').fill('http://remote.example/rpc');
  await page.getByRole('button', { name: 'Save settings' }).click();
  await page.waitForFunction(() => document.querySelector('#settings-status').textContent.startsWith('Use HTTPS'));
  await page.locator('#rpc-url').fill('http://127.0.0.1:8545');
  await page.getByRole('button', { name: 'Save settings' }).click();
  await page.waitForFunction(() => document.querySelector('#settings-status').textContent.startsWith('Saved.'));
  await page.reload();
  await page.waitForFunction(() => document.querySelector('#rpc-url').value === 'http://127.0.0.1:8545/');
  check('settings reject remote HTTP and accept a literal loopback endpoint');
  const cid = 'QmYwAPJzv5CZsnAzt8auVTLnEKjHhhtvE4s1wKpR1X4M8F';
  const input = `${cid}/nested/art%20work.svg?download=1#frame`;
  const resolve = text => page.evaluate(async text => (await import(chrome.runtime.getURL('background.js'))).destination(text), text);
  const first = await resolve(input);
  assert.match(first, /^https:\/\/gateway.pinata.cloud\/ipfs\//);
  assert.ok(first.endsWith('/nested/art%20work.svg?download=1#frame'));
  await page.locator('#gateway-preset').selectOption('dweb');
  await page.getByRole('button', { name: 'Save settings' }).click();
  await page.waitForFunction(() => document.querySelector('#settings-status').textContent.startsWith('Saved.'));
  const second = await resolve(`ipfs://${input}`);
  assert.match(second, /\.ipfs\.dweb.link\/nested\/art%20work.svg\?download=1#frame$/);
  assert.equal(await resolve(first), second);
  check('IPFS resolution follows changed gateway settings immediately and preserves nested paths');
  const invalid = await resolve('javascript:alert(1)');
  assert.equal(new URL(invalid).host, mainId);
  assert.ok(new URLSearchParams(new URL(invalid).hash.slice(1)).has('error'));
  check('invalid inputs open local errors');
  await page.goto(`chrome-extension://${mainId}/results.html`);
  assert.equal(await page.locator('label[for="raw-uri"]').textContent(), 'Metadata endpoint');
  assert.equal(await page.locator('label[for="resolved-uri"]').textContent(), 'Metadata URL');
  assert.equal(await page.locator('#read-contract svg').count(), 1);
  assert.equal(await page.locator('#read-contract').getAttribute('aria-label'), 'Read contract on Etherscan');
  assert.equal(await page.locator('#metadata-link').getAttribute('aria-label'), 'Open metadata');
  await page.locator('#contract').fill('0x0000000000000000000000000000000000000001');
  const opened = context.waitForEvent('page');
  await context.route('https://etherscan.io/**', route => route.fulfill({ body: 'Etherscan fixture' }));
  await page.locator('#read-contract').click();
  const explorer = await opened;
  await explorer.waitForLoadState();
  assert.equal(explorer.url(), 'https://etherscan.io/address/0x0000000000000000000000000000000000000001#readContract');
  check('metadata labels and accessible inline icons replace large link buttons; Etherscan opens the typed contract');
  await page.getByRole('button', { name: 'Help', exact: true }).click();
  await verifyPrivacyLink(page.getByRole('link', { name: 'Read the privacy policy' }));
  assert.deepEqual(invalidCsp, []);
  check('Settings and Help open the bundled privacy policy; CSP contains no ignored invalid sources');
  console.log(`${checks} configuration/browser checks passed.`);
} finally {
  await context.close();
  await rm(profile, { recursive: true, force: true });
}
