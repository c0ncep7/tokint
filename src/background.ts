import { VaultLockedError } from './vault';
import { explorer, ipfsUrl, parseQuery } from './core';
import { getSettings } from './storage';

const escapeXml = (text: string) => text.replace(/[<>&"']/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&apos;' })[c]!);
function suggestion(text: string) {
  try {
    const query = parseQuery(text);
    if (query.kind === 'contract') return 'Open <match>Read Contract</match> on Etherscan';
    if (query.kind === 'token') return `Inspect metadata for token <match>${escapeXml(query.id)}</match>`;
    return 'Open <match>IPFS</match> through your configured gateway';
  } catch { return 'Enter <match>address</match>, <match>address + token ID</match>, or <match>IPFS URI / CID</match>'; }
}
chrome.omnibox.onInputChanged.addListener((text, suggest) => {
  void chrome.omnibox.setDefaultSuggestion({ description: suggestion(text) });
  suggest([]);
});
chrome.omnibox.onInputStarted.addListener(() => { void chrome.omnibox.setDefaultSuggestion({ description: suggestion('') }); });
export async function destination(text: string) {
  try {
    const query = parseQuery(text);
    if (query.kind === 'contract') return explorer(query.contract);
    if (query.kind === 'ipfs') {
      try { return ipfsUrl(query.ref, await getSettings()); }
      catch (error) {
        if (!(error instanceof VaultLockedError)) throw error;
        return chrome.runtime.getURL(`results.html#${new URLSearchParams({ ipfs: text })}`);
      }
    }
    return chrome.runtime.getURL(`results.html#${new URLSearchParams({ contract: query.contract, token: query.id, run: '1' })}`);
  } catch (e) {
    return chrome.runtime.getURL(`results.html#${new URLSearchParams({ error: e instanceof Error ? e.message : 'Invalid input.' })}`);
  }
}
chrome.omnibox.onInputEntered.addListener((text, disposition) => {
  void (async () => {
    const url = await destination(text);
    if (disposition === 'currentTab') await chrome.tabs.update({ url });
    else await chrome.tabs.create({ url, active: disposition !== 'newBackgroundTab' });
  })().catch(console.error);
});
