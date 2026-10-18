import { chromium } from 'playwright';
import { encodeAbiParameters } from 'viem';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm } from 'node:fs/promises';
import path from 'node:path';
await mkdir('test-results', { recursive: true });
const profile = await mkdtemp(path.resolve('test-results/opensea-profile-'));
const contract = '0xc43ec24ec4a968ff3ceafdf9a35e2c8118b4cfb2';
const sourceUrl = `https://opensea.io/item/ethereum/${contract}/87`;
const extensionPath = path.resolve(process.env.EXTENSION_DIR || 'extension');
const context = await chromium.launchPersistentContext(profile, {
  executablePath: process.env.CHROMIUM_EXECUTABLE || undefined,
  channel: process.env.CHROMIUM_EXECUTABLE ? undefined : 'chromium',
  headless: true,
  args: ['--enable-unsafe-extension-debugging', `--disable-extensions-except=${extensionPath}`, `--load-extension=${extensionPath}`],
});
try {
  const worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker');
  const extensionId = new URL(worker.url()).host;
  assert.equal(await worker.evaluate(() => chrome.action.getPopup({})), `chrome-extension://${extensionId}/launcher.html`);
  assert.equal(await worker.evaluate(() => chrome.action.onClicked.hasListeners()), false);
  console.log('PASS toolbar uses the launcher popup without a background click handler');
  let reads = 0;
  let expectedId = 87n;
  let expectedContract = contract;
  await context.route('https://opensea.io/**', route => route.fulfill({ contentType: 'text/html', body: '<title>OpenSea toolbar fixture</title><p>Token 87</p>' }));
  await context.route('https://ethereum-rpc.publicnode.com/**', async route => {
    const request = route.request().postDataJSON();
    let result;
    if (request.method === 'eth_chainId') result = '0x1';
    else if (request.params[0].data.startsWith('0x01ffc9a7')) result = encodeAbiParameters([{ type: 'bool' }], [true]);
    else {
      assert.equal(request.params[0].to.toLowerCase(), expectedContract.toLowerCase());
      assert.equal(BigInt('0x' + request.params[0].data.slice(-64)), expectedId);
      reads++;
      result = encodeAbiParameters([{ type: 'string' }], ['data:application/json,' + encodeURIComponent(JSON.stringify({ name: `Toolbar token ${expectedId}`, image: 'data:image/svg+xml,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"><rect width="10" height="10" fill="red"/></svg>') }))]);
    }
    await route.fulfill({ json: { jsonrpc: '2.0', id: request.id, result } });
  });
  const source = await context.newPage(); await source.goto(sourceUrl);
  const opened = context.waitForEvent('page').catch(() => null);
  const browserCdp = await context.browser().newBrowserCDPSession();
  const { targetInfos } = await browserCdp.send('Target.getTargets', { filter: [{ type: 'tab', exclude: false }] });
  const tabTarget = targetInfos.find(t => t.url === sourceUrl);
  assert.ok(tabTarget, 'Missing OpenSea tab target');
  await browserCdp.send('Extensions.triggerAction', { id: extensionId, targetId: tabTarget.targetId });
  const page = await opened;
  assert.ok(page, 'Toolbar did not open a tab');
  await page.waitForLoadState();
  console.log('Toolbar opened:', page.url());
  await page.waitForFunction(() => !document.querySelector('#image').hidden);
  assert.equal(await page.locator('#token').inputValue(), '87');
  assert.equal((await page.locator('#contract').inputValue()).toLowerCase(), contract);
  assert.equal(await page.locator('#name').textContent(), 'Toolbar token 87');
  assert.equal(reads, 1);
  assert.equal(source.url(), sourceUrl);
  console.log('PASS actual browser extension action receives activeTab URL and automatically loads exact OpenSea token 87');
  assert.equal(await page.locator('#extension-version').textContent(), `v${await worker.evaluate(() => chrome.runtime.getManifest().version)}`);
  await page.close();
  await source.bringToFront();
  expectedId = 88n;
  await source.evaluate(url => history.pushState(null, '', url), sourceUrl.replace('/87', '/88'));
  const nextEvent = context.waitForEvent('page').catch(() => null);
  await browserCdp.send('Extensions.triggerAction', { id: extensionId, targetId: tabTarget.targetId });
  const next = await nextEvent; assert.ok(next);
  await next.waitForLoadState();
  await next.waitForFunction(() => !document.querySelector('#image').hidden);
  assert.equal(await next.locator('#token').inputValue(), '88');
  assert.equal(await next.locator('#name').textContent(), 'Toolbar token 88');
  assert.equal(reads, 2);
  console.log('PASS toolbar reads the current token after OpenSea client-side navigation');
  await next.close();
  await source.bringToFront();
  await source.evaluate(url => history.pushState(null, '', url), sourceUrl.replace('/ethereum/', '/base/'));
  const errorEvent = context.waitForEvent('page').catch(() => null);
  await browserCdp.send('Extensions.triggerAction', { id: extensionId, targetId: tabTarget.targetId });
  const errorPage = await errorEvent; assert.ok(errorPage);
  await errorPage.waitForLoadState();
  await errorPage.waitForFunction(() => document.querySelector('#status').textContent.includes('Ethereum mainnet only'));
  assert.equal(await errorPage.locator('#contract').inputValue(), '');
  assert.equal(await errorPage.locator('#token').inputValue(), '');
  assert.equal(reads, 2);
  assert.equal(await errorPage.locator('#handoff-details').isVisible(), true);
  await errorPage.locator('#handoff-details summary').click();
  assert.match(await errorPage.locator('#handoff-info').textContent(), /refreshed-tab/);
  await errorPage.screenshot({ path: `test-results/opensea-handoff-warning-${context.browser().version().replaceAll('.', '-')}.png`, fullPage: true });
  console.log('PASS failed OpenSea handoff displays context without restoring an unrelated saved contract');
  await errorPage.goto(`chrome-extension://${extensionId}/results.html#${new URLSearchParams({ launch: 'toolbar', via: 'unavailable', handoff: 'unavailable', error: 'The browser did not provide the current page address.' })}`);
  await errorPage.waitForFunction(() => document.querySelector('#status').textContent.includes('did not provide'));
  assert.equal(await errorPage.locator('#contract').inputValue(), '');
  assert.match(await errorPage.locator('#handoff-info').textContent(), /No token page address received/);
  console.log('PASS unavailable-URL diagnostic explains the missing handoff and shows the running version');
  expectedId = 87n;
  await errorPage.locator('#contract').fill(contract);
  await errorPage.locator('#token').fill('87');
  await errorPage.locator('#token').press('Enter');
  await errorPage.waitForFunction(() => !document.querySelector('#image').hidden);
  assert.equal(await errorPage.locator('#handoff-details').isVisible(), false);
  console.log('PASS manual lookup after a failed handoff clears stale diagnostics');
  await errorPage.close();
  for (const [url, id] of [
    ['https://superrare.com/artwork/eth/0xA930ef880909b589a525ffd9Bd8E60854A2E0A02/1', 1n],
    ['https://token-art.example/gallery/0xA930ef880909b589a525ffd9Bd8E60854A2E0A02/900719925474099312345/details?private=value', 900719925474099312345n],
  ]) {
    expectedContract = '0xA930ef880909b589a525ffd9Bd8E60854A2E0A02'; expectedId = id;
    const origin = new URL(url).origin;
    assert.equal(await worker.evaluate(origin => chrome.runtime.getManifest().host_permissions.some(pattern => pattern.startsWith(origin + '/')), origin), false);
    await context.route(origin + '/**', route => route.fulfill({ contentType: 'text/html', body: '<title>Generic token fixture</title>' }));
    await source.goto(url); await source.bringToFront();
    const { targetInfos: targets } = await browserCdp.send('Target.getTargets', { filter: [{ type: 'tab', exclude: false }] });
    const target = targets.find(t => t.url === url); assert.ok(target);
    const openedEvent = context.waitForEvent('page');
    const previousReads = reads;
    await browserCdp.send('Extensions.triggerAction', { id: extensionId, targetId: target.targetId });
    const inspector = await openedEvent;
    await inspector.waitForLoadState();
    await inspector.waitForFunction(() => !document.querySelector('#image').hidden);
    assert.equal(await inspector.locator('#contract').inputValue(), expectedContract);
    assert.equal(await inspector.locator('#token').inputValue(), id.toString());
    assert.equal(await inspector.locator('#name').textContent(), `Toolbar token ${id}`);
    assert.equal(reads, previousReads + 1);
    assert.equal(source.url(), url);
    const params = new URL(inspector.url()).hash;
    assert.equal(params.includes('private'), false);
    console.log(`PASS actual toolbar auto-loads ${origin} using activeTab without site host permissions`);
    await inspector.close();
  }
  console.log(`Browser engine: ${context.browser().version()}`);
} catch (error) { console.error(error); process.exitCode = 1; } finally { await context.close(); await rm(profile, { recursive: true, force: true }); }
