import { setBusy } from './loading';
import { alchemyEnabled, alchemyRequest, browseTokens, parseMint, parseOwners, THUMBNAIL_ORIGINS, type BrowseMode, type BrowseToken } from './alchemy';
import { address, Failure, LatestRequest, type Settings } from './core';
import { loadImage } from './network';

const el = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const button = (id: string) => el<HTMLButtonElement>(id);
const short = (value: string) => `${value.slice(0, 8)}…${value.slice(-6)}`;
function anchor(label: string, href: string) {
  const a = document.createElement('a'); a.textContent = label; a.href = href;
  a.target = '_blank'; a.rel = 'noopener noreferrer'; return a;
}
function message(error: unknown) { return error instanceof Failure ? error.message : 'Could not load Alchemy data. Retry to try again.'; }
export function createAlchemyUI(onToken: (contract: string, token: string) => void, getContract: () => string) {
  let prefs: Settings | undefined;
  let token: { contract: string; id: string } | undefined;
  const browse = el<HTMLDialogElement>('browse-modal');
  const details = el<HTMLDetailsElement>('alchemy-details');
  const browseRequests = new LatestRequest(), detailRequests = new LatestRequest();
  let mode: BrowseMode = 'collection', target = '', cursor = '', next = '', previous: string[] = [];
  let browsePendingOrigin: string | undefined;
  let items: BrowseToken[] = [], thumbnailUrls: string[] = [];
  let thumbnailRequests = new LatestRequest();
  let detailLoaded = false;
  const active = () => prefs && alchemyEnabled(prefs);
  function cleanThumbnails() {
    thumbnailRequests.cancel(); el('browse-grid').querySelectorAll<HTMLElement>('.browse-thumb').forEach(node => setBusy(node, false)); thumbnailUrls.forEach(URL.revokeObjectURL); thumbnailUrls = [];
  }
  function closeBrowse() {
    browseRequests.cancel(); setBusy(el('browse-status'), false); cleanThumbnails();
    if (browse.open) { browse.close(); document.body.classList.remove('modal-open'); }
  }
  function resetToken() {
    detailRequests.cancel(); setBusy(el('alchemy-asof'), false); token = undefined; detailLoaded = false; details.hidden = true;
    el('owners-content').replaceChildren(); el('mint-content').replaceChildren(); el('alchemy-asof').textContent = '';
  }
  function updateCollection() {
    try { address(getContract()); button('browse-collection').disabled = false; }
    catch { button('browse-collection').disabled = true; }
  }
  function configure(value: Settings) {
    const changed = prefs?.rpcUrl !== value.rpcUrl;
    prefs = value;
    el('alchemy-actions').hidden = !active(); updateCollection();
    if (changed) {
      closeBrowse(); detailRequests.cancel(); setBusy(el('alchemy-asof'), false); detailLoaded = false;
      el('owners-content').replaceChildren(); el('mint-content').replaceChildren(); el('alchemy-asof').textContent = '';
    }
    details.hidden = !active() || !token;
    if (!active()) details.open = false;
    else if (changed && token && details.open) void loadDetails();
  }
  async function thumbnails() {
    if (!active() || !browse.open) return;
    const ticket = thumbnailRequests.begin();
    const allowed = await Promise.all(THUMBNAIL_ORIGINS.map(origin => chrome.permissions.contains({ origins: [origin] })));
    if (!ticket.current() || !active()) return;
    const permitted = (url: string) => allowed[THUMBNAIL_ORIGINS.findIndex(origin => new URL(url).hostname === new URL(origin).hostname)];
    const jobs = items.map((item, index) => ({ item, index })).filter(({ item }) => item.thumbnail && permitted(item.thumbnail));
    button('browse-images').hidden = !items.some(item => item.thumbnail && !permitted(item.thumbnail));
    for (const { index } of jobs) { const node = el('browse-grid').querySelector<HTMLImageElement>(`[data-image="${index}"]`)?.parentElement; if (node) setBusy(node, true); }
    let position = 0;
    await Promise.all(Array.from({ length: 4 }, async () => {
      while (position < jobs.length && ticket.current()) {
        const { item, index } = jobs[position++];
        try {
          const blob = await loadImage(item.thumbnail!, { signal: ticket.signal, timeoutMs: 10_000 }, 2 * 1024 * 1024);
          if (!ticket.current() || !active()) return;
          const img = el('browse-grid').querySelector<HTMLImageElement>(`[data-image="${index}"]`);
          if (!img) continue;
          const url = URL.createObjectURL(blob); thumbnailUrls.push(url);
          img.onload = () => { if (ticket.current()) { img.hidden = false; setBusy(img.parentElement!, false); } };
          img.onerror = () => { if (ticket.current()) setBusy(img.parentElement!, false); };
          img.src = url;
        } catch {
          if (ticket.current()) { const node = el('browse-grid').querySelector<HTMLImageElement>(`[data-image="${index}"]`)?.parentElement; if (node) setBusy(node, false); }
        }
      }
    }));
  }
  function renderCards() {
    const grid = el('browse-grid'); grid.replaceChildren();
    for (const [index, item] of items.entries()) {
      const card = document.createElement('button'); card.type = 'button'; card.className = 'browse-card';
      const preview = document.createElement('span'); preview.className = 'browse-thumb';
      const placeholder = document.createElement('span'); placeholder.textContent = '◇'; preview.append(placeholder);
      const image = document.createElement('img'); image.dataset.image = String(index); image.alt = ''; image.hidden = true; image.referrerPolicy = 'no-referrer'; preview.append(image);
      const name = document.createElement('strong'); name.textContent = item.name || `Token #${item.token}`;
      const identity = document.createElement('span'); identity.className = 'muted'; identity.textContent = `#${item.token} · ${short(item.contract)}`;
      card.title = `${item.collection || item.name || 'Token'}\n${item.contract}\n#${item.token}`;
      card.append(preview, name, identity);
      card.addEventListener('click', () => { if (!active()) return; closeBrowse(); onToken(item.contract, item.token); });
      grid.append(card);
    }
  }
  async function loadPage(newCursor: string, history: string[]) {
    if (!active() || !browse.open) return;
    const ticket = browseRequests.begin(); cleanThumbnails();
    browsePendingOrigin = undefined; button('browse-retry').hidden = true; button('browse-images').hidden = true;
    button('browse-prev').disabled = button('browse-next').disabled = true;
    setBusy(el('browse-status'), true); el('browse-status').textContent = 'Loading…'; el('browse-grid').replaceChildren();
    try {
      const result = await browseTokens(prefs!, mode, target, newCursor, { signal: ticket.signal });
      if (!ticket.current() || !active()) return;
      cursor = newCursor; previous = history; next = result.next;
      if (next === cursor || previous.includes(next)) next = '';
      items = result.items; renderCards();
      el('browse-status').textContent = items.length ? (result.skipped ? 'Some invalid entries were omitted.' : '') : (result.skipped ? 'No usable tokens on this page.' : 'No tokens found.');
      el('browse-page').textContent = `Page ${previous.length + 1}`;
      button('browse-prev').disabled = !previous.length; button('browse-next').disabled = !next;
      void thumbnails();
    } catch (e) {
      if (!ticket.current()) return;
      el('browse-status').textContent = message(e);
      browsePendingOrigin = e instanceof Failure ? e.origin : undefined;
      button('browse-retry').hidden = false; button('browse-retry').textContent = browsePendingOrigin ? 'Allow and retry' : 'Retry';
      button('browse-retry').onclick = () => {
        const grant = browsePendingOrigin ? chrome.permissions.request({ origins: [browsePendingOrigin] }) : Promise.resolve(true);
        void grant.then(allowed => {
          if (!ticket.current() || !active()) return;
          if (allowed) void loadPage(newCursor, history);
          else el('browse-status').textContent = 'Host access was not granted.';
        }).catch(() => { if (ticket.current()) el('browse-status').textContent = 'Host access could not be requested. Retry to try again.'; });
      };
    } finally { if (ticket.current()) setBusy(el('browse-status'), false); }
  }
  function openBrowse(kind: BrowseMode) {
    if (!active()) return;
    mode = kind; next = cursor = ''; previous = []; items = [];
    el('browse-title').textContent = kind === 'collection' ? 'Browse collection' : 'Browse wallet';
    el('browse-address-label').textContent = kind === 'collection' ? 'Contract address' : 'Wallet address';
    const input = el<HTMLInputElement>('browse-address'); input.value = kind === 'collection' ? getContract() : '';
    el('browse-grid').replaceChildren(); el('browse-status').textContent = ''; el('browse-page').textContent = '';
    button('browse-retry').hidden = button('browse-images').hidden = true;
    button('browse-prev').disabled = button('browse-next').disabled = true;
    browse.showModal(); document.body.classList.add('modal-open'); input.focus();
    if (kind === 'collection') submitBrowse();
  }
  function submitBrowse() {
    try { target = address(el<HTMLInputElement>('browse-address').value); el<HTMLInputElement>('browse-address').value = target; void loadPage('', []); }
    catch (e) {
      browseRequests.cancel(); setBusy(el('browse-status'), false); cleanThumbnails(); el('browse-grid').replaceChildren(); items = [];
      el('browse-status').textContent = message(e); button('browse-prev').disabled = button('browse-next').disabled = true;
      button('browse-retry').hidden = button('browse-images').hidden = true;
    }
  }
  button('browse-collection').addEventListener('click', () => openBrowse('collection'));
  button('browse-wallet').addEventListener('click', () => openBrowse('wallet'));
  el('contract').addEventListener('input', updateCollection);
  el('browse-form').addEventListener('submit', e => { e.preventDefault(); submitBrowse(); });
  button('browse-next').addEventListener('click', () => { if (next) void loadPage(next, [...previous, cursor]); });
  button('browse-prev').addEventListener('click', () => { if (previous.length) void loadPage(previous.at(-1)!, previous.slice(0, -1)); });
  button('close-browse').addEventListener('click', closeBrowse);
  browse.addEventListener('cancel', e => { e.preventDefault(); closeBrowse(); });
  browse.addEventListener('click', e => { if (e.target === browse) closeBrowse(); });
  button('browse-images').addEventListener('click', () => {
    const grant = chrome.permissions.request({ origins: THUMBNAIL_ORIGINS });
    void grant.then(allowed => {
      if (!active() || !browse.open) return;
      if (allowed) void thumbnails(); else el('browse-status').textContent = 'Thumbnail access was not granted. Tokens can still be opened.';
    }).catch(() => { el('browse-status').textContent = 'Thumbnail access could not be requested.'; });
  });
  function detailRow(parent: HTMLElement, label: string, content: string | HTMLElement) {
    const row = document.createElement('div'); row.className = 'detail-row';
    const name = document.createElement('span'); name.className = 'muted'; name.textContent = label;
    const value = document.createElement('span'); value.append(content); row.append(name, value); parent.append(row);
  }
  async function loadDetails() {
    if (!active() || !token || !details.open) return;
    const ticket = detailRequests.begin(); detailLoaded = true;
    const selected = token, selectedPrefs = prefs!;
    setBusy(el('alchemy-asof'), true); el('alchemy-asof').textContent = 'Alchemy · Loading…';
    const owners = el('owners-content'), mint = el('mint-content'); owners.replaceChildren(); mint.replaceChildren();
    const params = { contractAddress: selected.contract, tokenId: selected.id };
    function failed(parent: HTMLElement, error: unknown) {
      const note = document.createElement('p'); note.textContent = message(error); parent.append(note);
      const retry = document.createElement('button'); retry.type = 'button'; retry.className = 'text-button';
      const origin = error instanceof Failure ? error.origin : undefined;
      retry.textContent = origin ? 'Allow and retry' : 'Retry';
      retry.onclick = () => {
        const grant = origin ? chrome.permissions.request({ origins: [origin] }) : Promise.resolve(true);
        void grant.then(allowed => { if (!ticket.current() || !active()) return; if (allowed) void loadDetails(); else note.textContent = 'Host access was not granted.'; }).catch(() => { if (ticket.current()) note.textContent = 'Host access could not be requested.'; });
      };
      parent.append(retry);
    }
    await Promise.allSettled([
      (async () => {
        try {
          const data = parseOwners(await alchemyRequest(selectedPrefs, 'getOwnersForNFT', params, { signal: ticket.signal }));
          if (!ticket.current()) return;
          for (const owner of data.owners) detailRow(owners, 'Owner', anchor(owner, `https://etherscan.io/address/${owner}`));
          if (!data.owners.length) detailRow(owners, 'Owners', 'Not available');
          if (data.incomplete) detailRow(owners, 'Coverage', anchor('Partial list · View holders ↗', `https://etherscan.io/token/${selected.contract}?a=${selected.id}#balances`));
        } catch (e) { if (ticket.current()) failed(owners, e); }
      })(),
      (async () => {
        try {
          const data = parseMint(await alchemyRequest(selectedPrefs, 'getNFTMetadata', { ...params, tokenUriTimeoutInMs: '0' }, { signal: ticket.signal }));
          if (!ticket.current()) return;
          if (data.date) detailRow(mint, 'Minted', new Date(data.date).toLocaleString());
          if (data.recipient) detailRow(mint, 'Minted to', anchor(data.recipient, `https://etherscan.io/address/${data.recipient}`));
          if (data.tx) detailRow(mint, 'Mint transaction', anchor(short(data.tx), `https://etherscan.io/tx/${data.tx}`));
          if (data.block) detailRow(mint, 'Mint block', anchor(data.block, `https://etherscan.io/block/${data.block}`));
          if (!Object.values(data).some(Boolean)) detailRow(mint, 'Mint', 'Not available');
        } catch (e) { if (ticket.current()) failed(mint, e); }
      })(),
    ]);
    if (ticket.current()) { setBusy(el('alchemy-asof'), false); el('alchemy-asof').textContent = `Alchemy index · Queried ${new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`; }
  }
  details.addEventListener('toggle', () => {
    if (details.open && !detailLoaded) void loadDetails();
    if (!details.open) { detailRequests.cancel(); setBusy(el('alchemy-asof'), false); detailLoaded = false; }
  });
  button('refresh-alchemy').addEventListener('click', () => { void loadDetails(); });
  return {
    configure, resetToken,
    setToken(contract: string, id: string) { token = { contract, id }; details.hidden = !active(); updateCollection(); if (details.open && active()) void loadDetails(); },
    dispose() { browseRequests.cancel(); detailRequests.cancel(); cleanThumbnails(); },
  };
}
