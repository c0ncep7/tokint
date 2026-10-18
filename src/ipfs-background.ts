import { parseIpfs } from './core';
import { extensionId, gatewaySettings, ipfsDestination } from './ipfs-bridge';

// Open our own page only after a live handshake, instead of asking the main
// extension to navigate to a potentially missing/disabled extension resource.
chrome.runtime.onMessageExternal.addListener((message, sender, reply) => {
  if (message?.type !== 'tokint-connect' || !sender.id || sender.url !== `chrome-extension://${sender.id}/options.html`) return false;
  const main = extensionId(sender.id);
  void (async () => {
    try {
      // Verify the caller implements the gateway protocol before opening a tab.
      gatewaySettings(await chrome.runtime.sendMessage(main, { type: 'tokint-gateway' }));
      await chrome.tabs.create({ url: chrome.runtime.getURL(`options.html#main=${main}`), active: true });
      reply({ type: 'tokint-connect', opened: true });
    } catch { reply({ type: 'tokint-connect', opened: false }); }
  })();
  return true;
});

function description(text: string) {
  return parseIpfs(text) ? 'Open <match>IPFS</match> using your tokint gateway' : 'Enter an <match>IPFS CID/path</match> or <match>ipfs:// URI</match>';
}
chrome.omnibox.onInputStarted.addListener(() => { void chrome.omnibox.setDefaultSuggestion({ description: description('') }); });
chrome.omnibox.onInputChanged.addListener((text, suggest) => {
  void chrome.omnibox.setDefaultSuggestion({ description: description(text) });
  suggest([]);
});
export async function destination(text: string): Promise<string> {
  try {
    // Validate before contacting the main extension. Never send the input itself.
    if (!parseIpfs(text)) throw new Error('Enter a valid CID/path, ipfs:// URI, or IPFS gateway URL.');
    const stored = await chrome.storage.local.get('mainExtensionId');
    const main = extensionId(stored.mainExtensionId ?? '');
    let reply;
    try { reply = await chrome.runtime.sendMessage(main, { type: 'tokint-gateway' }); }
    catch { throw new Error('Could not reach tokint. Enable or reload it, then reconnect this shortcut from tokint Settings.'); }
    return ipfsDestination(text, gatewaySettings(reply));
  } catch (e) {
    return chrome.runtime.getURL(`options.html#${new URLSearchParams({ error: e instanceof Error ? e.message : 'Could not open IPFS.' })}`);
  }
}
chrome.omnibox.onInputEntered.addListener((text, disposition) => {
  void (async () => {
    const url = await destination(text);
    if (disposition === 'currentTab') await chrome.tabs.update({ url });
    else await chrome.tabs.create({ url, active: disposition !== 'newBackgroundTab' });
  })().catch(console.error);
});
