// Disposable fixture passphrase for isolated automated-test profiles only.
export const TEST_PASSPHRASE = 'disposable browser vault fixture only';
export async function prepareVault(context, worker) {
  const page = await context.newPage();
  await page.goto(`chrome-extension://${new URL(worker.url()).host}/options.html`);
  await page.locator('#vault-passphrase').fill(TEST_PASSPHRASE);
  await page.locator('#vault-confirm').fill(TEST_PASSPHRASE);
  await page.getByRole('button', { name: 'Create encrypted vault' }).click();
  await page.locator('#vault-dialog').waitFor({ state: 'detached' });
  await page.close();
}
export async function saveTestSettings(target, settings) {
  await target.evaluate(async settings => {
    const { saveSettings } = await import(chrome.runtime.getURL('storage.js'));
    await saveSettings(settings);
  }, settings);
}
