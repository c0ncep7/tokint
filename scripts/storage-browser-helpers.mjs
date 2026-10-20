export async function saveTestSettings(target, settings) {
  await target.evaluate(async settings => {
    const { saveSettings } = await import(chrome.runtime.getURL('storage.js'));
    await saveSettings(settings);
  }, settings);
}
