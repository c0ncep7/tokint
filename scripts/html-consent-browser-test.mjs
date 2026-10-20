import assert from 'node:assert/strict';
import { createSocket } from 'node:dgram';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { chromium } from 'playwright';
import { encodeAbiParameters } from 'viem';

// Real UDP provides a positive control for the network capability disclosed by
// the consent UI. No production endpoint or personal browser profile is used.
const socket = createSocket('udp4');
let packets = 0;
socket.on('message', () => packets++);
await new Promise(resolve => socket.bind(0, '127.0.0.1', resolve));
const profile = await mkdtemp('/private/tmp/tokint-html-consent-');
let context;
try {
  context = await chromium.launchPersistentContext(profile, {
    executablePath: process.env.CHROMIUM_EXECUTABLE || undefined,
    channel: process.env.CHROMIUM_EXECUTABLE ? undefined : 'chromium', headless: true, acceptDownloads: true,
    args: [`--disable-extensions-except=${process.cwd()}/extension`, `--load-extension=${process.cwd()}/extension`],
  });
  const worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker');
  const artwork = `<canvas width="32" height="32"></canvas><script>
    const peers=[];
    function connect(){ const pc=new RTCPeerConnection({iceServers:[{urls:'stun:127.0.0.1:${socket.address().port}'}]}); peers.push(pc);pc.createDataChannel('consent-test');pc.createOffer().then(o=>pc.setLocalDescription(o)); }
    connect();setInterval(connect,400);
    const ctx=document.querySelector('canvas').getContext('2d');
    function draw(t){ctx.fillStyle=Math.floor(t/100)%2?'red':'blue';ctx.fillRect(0,0,32,32);requestAnimationFrame(draw)}requestAnimationFrame(draw);
  </script>`;
  const metadata = { name: 'Consent fixture', image: 'data:image/svg+xml,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32"><rect width="32" height="32" fill="red"/></svg>'), animation_url: 'data:text/html;base64,' + Buffer.from(artwork).toString('base64') };
  await context.route('https://ethereum-rpc.publicnode.com/**', route => {
    const call = route.request().postDataJSON();
    const result = call.method === 'eth_chainId' ? '0x1' : call.params[0].data.startsWith('0x01ffc9a7')
      ? encodeAbiParameters([{ type: 'bool' }], [true])
      : encodeAbiParameters([{ type: 'string' }], ['data:application/json;base64,' + Buffer.from(JSON.stringify(metadata)).toString('base64')]);
    return route.fulfill({ json: { jsonrpc: '2.0', id: call.id, result } });
  });
  const page = await context.newPage();
  const errors = []; page.on('pageerror', error => errors.push(error.message));
  const url = `chrome-extension://${new URL(worker.url()).host}/results.html#contract=0x0000000000000000000000000000000000000001&token=1&run=1`;
  await page.goto(url);
  await page.locator('#html-consent').waitFor({ state: 'visible' });
  assert.match(await page.locator('#html-consent').textContent(), /external or local services.*IP address/s);
  assert.equal(await page.evaluate(() => chrome.permissions.contains({ origins: ['http://127.0.0.1/*'] })), false);
  assert.equal(await page.locator('iframe').count(), 0);
  await page.waitForTimeout(1500);
  assert.equal(packets, 0);
  await page.locator('#share-media').click();
  await page.locator('#share-html-consent-note').waitFor({ state: 'visible' });
  assert.equal(await page.locator('#share-generate').isDisabled(), true);
  const download = page.waitForEvent('download'); await page.locator('#download-media').click();
  assert.equal((await readFile(await (await download).path())).toString(), artwork);
  assert.equal(await page.locator('iframe').count(), 0); assert.equal(packets, 0);
  await page.locator('#close-share-modal').click();
  console.log('PASS lookup and original download never execute HTML or send STUN; conversion requires consent');

  await page.locator('#run-html').click();
  await page.waitForFunction(() => document.querySelector('#media-caption').textContent.includes('canvas'));
  await page.waitForTimeout(1200);
  assert.ok(packets > 0, 'Positive control: consent permits the disclosed WebRTC traffic');
  await page.locator('#fullscreen-media').click();
  await page.frameLocator('#fullscreen-stage iframe').locator('canvas').waitFor();
  await page.locator('#close-media-modal').click();
  await page.locator('#stop-html').click();
  assert.equal(await page.locator('iframe').count(), 0);
  await page.waitForTimeout(1000); const stopped = packets;
  await page.waitForTimeout(1500); assert.equal(packets, stopped, 'Stop removes active RTC contexts');
  await page.locator('#share-media').click();
  await page.locator('#share-html-consent-note').waitFor({ state: 'visible' });
  assert.equal(await page.locator('#share-generate').isDisabled(), true);
  await page.locator('#close-share-modal').click();
  console.log('PASS consent permits preview/fullscreen; Stop revokes execution and conversion and ends STUN');

  await page.locator('#run-html').click();
  await page.waitForFunction(() => document.querySelector('#media-caption').textContent.includes('canvas'));
  await page.locator('#media-source').selectOption('image');
  await page.locator('#image').waitFor({ state: 'visible' });
  await page.locator('#media-source').selectOption('animation_url');
  await page.locator('#html-consent').waitFor({ state: 'visible' });
  assert.equal(await page.locator('iframe').count(), 0);
  await context.setOffline(true);
  await page.reload();
  await page.locator('#html-consent').waitFor({ state: 'visible' });
  assert.equal(await page.locator('iframe').count(), 0);
  await page.waitForTimeout(1000); const reloaded = packets;
  await page.waitForTimeout(1500); assert.equal(packets, reloaded);
  await page.setViewportSize({ width: 390, height: 844 });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  await page.screenshot({ path: 'test-results/html-consent-narrow.png', fullPage: true });
  assert.deepEqual(errors, []);
  console.log('PASS media changes and offline cache reload require fresh consent; disclosure fits narrow screens');
} finally {
  await context?.close(); socket.close(); await rm(profile, { recursive: true, force: true });
}
