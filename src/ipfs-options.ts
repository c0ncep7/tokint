import { setBusy } from './loading';
import { extensionId, gatewaySettings } from './ipfs-bridge';

const input = document.querySelector<HTMLInputElement>('#main-extension')!;
const status = document.querySelector<HTMLElement>('#connection-status')!;
const params = new URLSearchParams(location.hash.slice(1));
status.textContent = params.get('error') ?? 'Connect once. Gateway changes in tokint apply to every IPFS lookup.';
void chrome.storage.local.get('mainExtensionId').then(stored => { input.value = params.get('main') ?? stored.mainExtensionId ?? ''; });
document.querySelector('#connect-form')!.addEventListener('submit', event => {
  event.preventDefault();
  void (async () => {
    try {
      const id = extensionId(input.value.trim());
      setBusy(status, true); status.textContent = 'Connecting…';
      const reply = await chrome.runtime.sendMessage(id, { type: 'tokint-gateway' });
      const prefs = gatewaySettings(reply);
      await chrome.storage.local.set({ mainExtensionId: id });
      history.replaceState(null, '', 'options.html');
      status.textContent = `Connected. Type ipfs, press Tab, then enter a CID/path. Current gateway: ${prefs.gatewayUrl}`;
    } catch { status.textContent = 'Connection failed. Load or reload tokint, then use Settings → Connect IPFS shortcut there.'; } finally { setBusy(status, false); }
  })();
});
