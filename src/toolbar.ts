import { tokenFromUrl } from './token-url';

export type ClickedTab = Pick<chrome.tabs.Tab, 'id' | 'url' | 'pendingUrl' | 'windowId'>;
export type TabAccess = {
  get: (id: number) => Promise<ClickedTab>;
  query: (query: chrome.tabs.QueryInfo) => Promise<ClickedTab[]>;
};
export type ToolbarPage = { url?: string; via: 'refreshed-tab' | 'click-event' | 'active-tab' | 'unavailable' };
const pageUrl = (tab: ClickedTab) => tab.pendingUrl || tab.url;

export async function toolbarPage(clicked: ClickedTab, tabs: TabAccess): Promise<ToolbarPage> {
  // Read the tab before opening the inspector. This also refreshes URLs after
  // client-side navigation and avoids relying only on the click payload.
  if (clicked.id !== undefined) {
    try {
      const current = await tabs.get(clicked.id);
      const url = pageUrl(current);
      if (url) return { url, via: 'refreshed-tab' };
    } catch { /* A closed/restricted tab may still have a usable click snapshot. */ }
  }
  const snapshot = pageUrl(clicked);
  if (snapshot) return { url: snapshot, via: 'click-event' };
  try {
    const candidates = await tabs.query(clicked.windowId === undefined ? { active: true, currentWindow: true } : { active: true, windowId: clicked.windowId });
    // With a known clicked tab, never accidentally inspect a different tab.
    const current = clicked.id === undefined ? candidates[0] : candidates.find(tab => tab.id === clicked.id);
    const url = current && pageUrl(current);
    if (url) return { url, via: 'active-tab' };
  } catch { /* Report an unavailable handoff below instead of silently restoring history. */ }
  return { via: 'unavailable' };
}

export function toolbarDestination(page: ToolbarPage): string {
  const params = new URLSearchParams({ launch: 'toolbar', via: page.via });
  let onOpenSea = false;
  if (page.url) {
    try {
      const url = new URL(page.url);
      onOpenSea = url.protocol === 'https:' && ['opensea.io', 'www.opensea.io'].includes(url.hostname) && !url.port && !url.username && !url.password;
      // Only retain the relevant OpenSea path, with no queries, fragments, or
      // unrelated browsing addresses, and only in this inspector tab's URL.
      if (onOpenSea) params.set('source', url.origin + url.pathname);
    } catch { /* An invalid browser URL is handled as an unavailable handoff. */ }
  }
  try {
    const token = tokenFromUrl(page.url);
    if (token) {
      params.set('contract', token.contract); params.set('token', token.id); params.set('run', '1');
      params.set('handoff', 'token');
      // Generic diagnostics keep only the site, not potentially private path segments.
      if (!onOpenSea) params.set('source', new URL(page.url!).origin);
    } else if (!page.url) {
      params.set('handoff', 'unavailable');
      params.set('error', 'The browser did not provide the current page address. Check tokint’s site access in the browser extension settings, then click its button from the token page again.');
    } else if (onOpenSea) {
      params.set('handoff', 'opensea-page');
      params.set('error', 'This OpenSea address does not identify an individual token. Open the NFT’s item page, then click tokint again.');
    } else params.set('handoff', 'other-page');
  } catch (error) {
    params.set('handoff', 'error');
    params.set('error', error instanceof Error ? error.message : 'Could not read a token from this URL.');
  }
  return `results.html#${params}`;
}
