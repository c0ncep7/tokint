import { chromium } from 'playwright';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
await mkdir('test-results', { recursive: true });
const profile = await mkdtemp(path.resolve('test-results/interactive-'));
const context = await chromium.launchPersistentContext(profile, {
  executablePath: process.env.CHROMIUM_EXECUTABLE || undefined,
  channel: process.env.CHROMIUM_EXECUTABLE ? undefined : 'chromium',
  headless: false, viewport: null,
  args: [`--disable-extensions-except=${path.resolve('extension')}`, `--load-extension=${path.resolve('extension')}`],
});
const worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker');
const extensionId = new URL(worker.url()).host;
const page = context.pages()[0] || await context.newPage();
await page.goto(`chrome-extension://${extensionId}/results.html`);
await writeFile('test-results/interactive-session.json', JSON.stringify({ extensionId, browser: context.browser()?.version() }));
console.log(`Isolated browser ready. Extension: ${extensionId}`);
process.on('SIGINT', async () => { await context.close(); await rm(profile, { recursive: true, force: true }); process.exit(0); });
process.on('SIGTERM', async () => { await context.close(); await rm(profile, { recursive: true, force: true }); process.exit(0); });
await new Promise(resolve => context.on('close', resolve));
