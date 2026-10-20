import { saveTestSettings } from './storage-browser-helpers.mjs';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { chromium } from 'playwright';
import { encodeAbiParameters } from 'viem';

// Use real HTTP redirects and host permissions, not intercepted fetch responses.
// The only test-manifest grant is localhost; 127.0.0.1 stays unapproved.
await mkdir('test-results', { recursive: true });
const root = await mkdtemp(path.resolve('test-results/security-'));
const requests = [];
const contract = '0x0000000000000000000000000000000000000001';
const artwork = `data:image/jpeg;base64,${(await readFile('tests/fixtures/wide.jpg')).toString('base64')}`;
let allowed, denied, context;
const server = createServer(async (req, res) => {
  requests.push({ host: req.headers.host, path: req.url, method: req.method, cookie: req.headers.cookie, referer: req.headers.referer });
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'content-type');
  if (req.method === 'OPTIONS') { res.writeHead(204).end(); return; }
  const redirects = {
    '/redirect-return': `${denied}/bounce`, '/bounce': `${allowed}/final`,
    '/redirect-target': `${denied}/final`, '/redirect-same': `${allowed}/final`,
    '/rpc-redirect': `${denied}/rpc`,
  };
  if (redirects[req.url]) { res.writeHead(req.url === '/rpc-redirect' ? 307 : 302, { Location: redirects[req.url] }).end(); return; }
  if (req.url === '/rpc') {
    let body = ''; for await (const chunk of req) body += chunk;
    const call = JSON.parse(body);
    const token = call.method === 'eth_call' ? Number(BigInt('0x' + call.params[0].data.slice(-64))) : 0;
    const uri = { 1: '/redirect-return', 2: '/redirect-target', 3: '/redirect-same' }[token] ?? `/metadata/${token}`;
    const result = call.method === 'eth_chainId' ? '0x1' : call.params[0].data.startsWith('0x01ffc9a7')
      ? encodeAbiParameters([{ type: 'bool' }], [true])
      : encodeAbiParameters([{ type: 'string' }], [`${allowed}${uri}`]);
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ jsonrpc: '2.0', id: call.id, result })); return;
  }
  if (req.url === '/oversized.gif') {
    res.writeHead(200, { 'Content-Type': 'image/gif', 'Content-Length': String(100 * 1024 * 1024 + 1) }).end('GIF89a'); return;
  }
  res.setHeader('Content-Type', 'application/json');
  if (req.url === '/metadata/5') { res.end('{"items":' + '['.repeat(10_000) + '0' + ']'.repeat(10_000) + '}'); return; }
  if (req.url === '/metadata/6') {
    res.end('{"name":"Bounded JSON","items":' + '['.repeat(60) + Array(100_000).fill('0').join(',') + ']'.repeat(60) + '}'); return;
  }
  res.end(JSON.stringify({ name: 'Security fixture', image: req.url === '/metadata/4' ? `${allowed}/redirect-return` : req.url === '/metadata/7' ? `${allowed}/oversized.gif` : artwork }));
});
try {
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  allowed = `http://localhost:${server.address().port}`;
  denied = `http://127.0.0.1:${server.address().port}`;
  const extension = path.join(root, 'extension');
  await cp('extension', extension, { recursive: true });
  const manifest = JSON.parse(await readFile(path.join(extension, 'manifest.json'), 'utf8'));
  assert.ok(!manifest.host_permissions.some(origin => origin.includes('opensea.io')));
  manifest.host_permissions.push('http://localhost/*');
  await writeFile(path.join(extension, 'manifest.json'), JSON.stringify(manifest));
  context = await chromium.launchPersistentContext(path.join(root, 'profile'), {
    executablePath: process.env.CHROMIUM_EXECUTABLE || undefined,
    channel: process.env.CHROMIUM_EXECUTABLE ? undefined : 'chromium', headless: true,
    args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`],
  });
  const worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker');

  const page = await context.newPage();
  const errors = []; page.on('pageerror', error => errors.push(error.message));
  await page.goto(`chrome-extension://${new URL(worker.url()).host}/results.html`);
  await page.waitForFunction(() => document.querySelector('.shell')?.inert === false);
  assert.equal(await page.evaluate(() => chrome.permissions.contains({ origins: ['http://127.0.0.1/*'] })), false);
  // Positive control: the old fetch policy reaches B and returns to A, despite
  // B having no extension grant. This ensures zero target requests is meaningful.
  await page.evaluate(async url => { await (await fetch(url, { credentials: 'omit', referrerPolicy: 'no-referrer' })).text(); }, `${allowed}/redirect-return`);
  assert.ok(requests.some(req => req.host === new URL(denied).host && req.path === '/bounce'));
  assert.ok(requests.some(req => req.path === '/final'));
  await saveTestSettings(page, { rpcUrl: `${allowed}/rpc`, gatewayUrl: 'https://gateway.pinata.cloud', gatewayStyle: 'path' });
  async function submit(id) {
    requests.length = 0;
    await page.locator('#contract').fill(contract);
    await page.locator('#token').fill(String(id)); await page.locator('#token').press('Enter');
  }
  await submit(0);
  await page.waitForFunction(() => !document.querySelector('#image').hidden);
  assert.ok(requests.some(req => req.path === '/metadata/0'));
  assert.ok(requests.every(req => !req.cookie && !req.referer));
  console.log('PASS direct RPC, metadata and image lookup with real host permissions');
  for (const id of [1, 2, 3, 4]) {
    await submit(id);
    await page.waitForFunction(() => document.querySelector('#status').textContent.includes('redirects are blocked'));
    assert.ok(requests.some(req => req.path.startsWith('/redirect-')));
    assert.ok(!requests.some(req => req.host === new URL(denied).host || req.path === '/final'));
  }
  console.log('PASS cross-host, return-chain, same-host and media redirects stop before the target request');
  await submit(5);
  await page.waitForFunction(() => document.querySelector('#status').textContent.includes('nesting limit'));
  await submit(6);
  await page.waitForFunction(() => document.querySelector('#name').textContent === 'Bounded JSON' && document.querySelector('#json').textContent.includes('items'));
  assert.ok((await page.locator('#json').textContent()).length < 2 * 1024 * 1024);
  console.log('PASS hostile nesting rejected and large nested JSON rendered without expansion');
  await submit(7);
  await page.waitForFunction(() => document.querySelector('#status').textContent.includes('exceeds'));
  assert.equal(await page.locator('#image').isVisible(), false);
  assert.equal(await page.locator('#share-media').isVisible(), true);
  console.log('PASS oversized automatic preview is stopped and original-download controls remain available');
  await saveTestSettings(page, { rpcUrl: `${allowed}/rpc-redirect`, gatewayUrl: 'https://gateway.pinata.cloud', gatewayStyle: 'path' });
  await submit(8);
  await page.waitForFunction(() => document.querySelector('#status').textContent.includes('redirects are blocked'));
  assert.ok(requests.some(req => req.path === '/rpc-redirect' && req.method === 'POST'));
  assert.ok(!requests.some(req => req.host === new URL(denied).host));
  assert.deepEqual(errors, []);
  console.log('PASS RPC POST redirects cannot forward the request body to an unapproved host');
  console.log(`Security browser checks passed (${context.browser()?.version()}).`);
} finally {
  await context?.close();
  server.closeAllConnections(); await new Promise(resolve => server.close(resolve));
  await rm(root, { recursive: true, force: true });
}
