import { setBusy } from './loading';
import { storageLocation, type StorageLocation } from './storage-location';
import { createAlchemyUI } from './alchemy-ui';
import { cacheKey, cacheScope, clearCache, readCache, rememberImage, rememberToken, usableSnapshot, type RecentToken, type Snapshot } from './token-cache';
import { renderJson } from './json-view';
import { address, explorer, Failure, formatMetadata, httpUrl, htmlDataUri, imageDataUri, LatestRequest, parseIpfs, resolveUri, substituteId, tokenId, type Method } from './core';
import { readTokenUri } from './chain';
import { loadPreview, loadMetadata } from './network';
import { getLastContract, getSettings, saveLastContract } from './storage';
import { embeddedMediaBlob, mediaExtension } from './downloads';
import { createMediaModal } from './media-modal';
import { createShareModal } from './share-modal';
import { svgDimensions } from './svg';
import { tokenMedia } from './token-media';
import { createHtmlMedia } from './html-media';

const el = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const infoModal = el<HTMLDialogElement>('info-modal');
el('open-info').addEventListener('click', () => infoModal.showModal());
el('close-info').addEventListener('click', () => infoModal.close());
infoModal.addEventListener('click', event => {
  if (event.target !== infoModal) return;
  const box = infoModal.getBoundingClientRect();
  if (event.clientX < box.left || event.clientX > box.right || event.clientY < box.top || event.clientY > box.bottom) infoModal.close();
});
function showStorageBadge(kind: 'metadata' | 'media', location: StorageLocation | null) {
  const badge = el(`${kind}-storage`);
  badge.hidden = !location;
  badge.textContent = location ? location : '';
  if (location) {
    badge.dataset.location = location;
    badge.title = `${kind === 'metadata' ? 'Contract metadata endpoint' : 'Selected media'}: ${location}. URI location only; external artwork dependencies are not checked. See Help.`;
  } else { delete badge.dataset.location; badge.removeAttribute('title'); }
}
const contractInput = el<HTMLInputElement>('contract');
const readContractButton = el<HTMLButtonElement>('read-contract');
function updateReadContractButton() {
  try { address(contractInput.value); readContractButton.disabled = false; }
  catch { readContractButton.disabled = true; }
}
contractInput.addEventListener('input', updateReadContractButton);
readContractButton.addEventListener('click', () => {
  try { window.open(explorer(contractInput.value), '_blank', 'noopener,noreferrer'); }
  catch { updateReadContractButton(); }
});
const tokenInput = el<HTMLInputElement>('token');
const methodInput = el<HTMLSelectElement>('method');
const alchemy = createAlchemyUI((contract, token) => {
  contractInput.value = contract; tokenInput.value = token; methodInput.value = 'auto';
  void run();
}, () => contractInput.value);
let configRevision = 0;
async function configureAlchemy() {
  const revision = ++configRevision;
  try { const prefs = await getSettings(); if (revision === configRevision) alchemy.configure(prefs); } catch { /* Inspector handles settings errors separately. */ }
}
chrome.storage.onChanged.addListener((changes, area) => { if (area === 'local' && changes.settings) void configureAlchemy(); });
void configureAlchemy();
const rawInput = el<HTMLTextAreaElement>('raw-uri');
const resolvedInput = el<HTMLTextAreaElement>('resolved-uri');
const image = el<HTMLImageElement>('image');
const mediaModal = createMediaModal(image);
const shareModal = createShareModal();
const requests = new LatestRequest();
const mediaRequests = new LatestRequest();
const mediaSelect = el<HTMLSelectElement>('media-source');
let selectMedia: (() => Promise<void>) | undefined;
let previewUrl: string | undefined;
mediaSelect.addEventListener('change', () => { void selectMedia?.(); });
type Ticket = ReturnType<LatestRequest['begin']>;
let pending: { error: Failure; action: () => Promise<void>; ticket: Ticket } | undefined;
let objectUrls: string[] = [];
let jsonText = '';
const recentSelect = el<HTMLSelectElement>('recent-tokens');
let recentRows: RecentToken[] = [];
let recentRender = 0;
const cacheChannel = new BroadcastChannel('tokint-cache');
async function renderRecents() {
  const version = ++recentRender;
  const { rows } = await readCache();
  if (version !== recentRender) return;
  // One visible entry per token; remember the most recently used method.
  recentRows = rows.filter((row, i) => rows.findIndex(r => r.contract.toLowerCase() === row.contract.toLowerCase() && r.token === row.token) === i);
  recentSelect.replaceChildren(new Option('Recent tokens', ''));
  for (const row of recentRows) {
    const short = `${row.contract.slice(0, 6)}…${row.contract.slice(-4)}`;
    const option = new Option(`${row.name || short} · #${row.token} · ${short}`, row.key);
    option.title = `${row.contract} · #${row.token} · ${row.method}`;
    recentSelect.append(option);
  }
  recentSelect.hidden = el('clear-recents').hidden = el('recent-controls').hidden = !recentRows.length;
}
function cacheChanged() { void renderRecents(); cacheChannel.postMessage('changed'); }
cacheChannel.onmessage = () => { void renderRecents(); };
recentSelect.addEventListener('change', () => {
  const row = recentRows.find(r => r.key === recentSelect.value);
  if (!row) return;
  contractInput.value = row.contract; tokenInput.value = row.token; methodInput.value = row.method;
  recentSelect.value = ''; void run();
});
el('clear-recents').addEventListener('click', () => {
  void clearCache().then(cleared => {
    if (cleared) { cacheChanged(); el('cache-status').textContent = ''; }
    else status('Could not clear local storage. Try again.', 'error');
  });
});

function objectUrl(blob: Blob) { const url = URL.createObjectURL(blob); objectUrls.push(url); return url; }
function link(id: string, url?: string) {
  const anchor = el<HTMLAnchorElement>(id);
  if (url) { anchor.href = url; anchor.hidden = false; }
  else { anchor.removeAttribute('href'); anchor.hidden = true; }
}
function status(message: string, state = 'ready') { el('status').textContent = message; el('status-row').dataset.state = state; setBusy(el('status'), state === 'loading'); }
function imageNote(text: string, loading = false) { el('media-size').textContent = ''; setBusy(el('image-placeholder'), loading); mediaModal.reset(); el('image-placeholder').hidden = false; el('image-note').textContent = text; image.hidden = true; }
function resetMedia() {
  mediaRequests.cancel();
  shareModal.reset(); mediaModal.reset();
  el('html-stage').replaceChildren(); el('html-stage').hidden = true;
  pending = undefined; el('retry').hidden = true;
  image.onload = image.onerror = null; image.removeAttribute('src');
  if (previewUrl) URL.revokeObjectURL(previewUrl);
  previewUrl = undefined;
  imageNote('Loading media…', true);
  el('media-caption').textContent = ''; el('media-type').textContent = '';
  showStorageBadge('media', null);
  link('image-link');
}
function reset() {
  alchemy.resetToken();
  el('cache-status').textContent = ''; el('cache-status').removeAttribute('title');
  el('handoff-details').hidden = true;
  el('handoff-info').textContent = '';
  resetMedia();
  selectMedia = undefined; mediaSelect.replaceChildren(); el('media-source-control').hidden = true;
  el('token-service-links').hidden = true;
  link('opensea-token-link'); link('onchainchecker-token-link');
  objectUrls.forEach(URL.revokeObjectURL); objectUrls = [];
  imageNote('Loading…', true);
  el('name').textContent = 'Loading token…';
  el('description').textContent = '';
  el('attributes').replaceChildren(); el('attributes').hidden = true;
  el('method-badge').hidden = true;
  showStorageBadge('metadata', null); showStorageBadge('media', null);
  el('media-caption').textContent = ''; el('media-type').textContent = '';
  el('token-caption').textContent = '';
  rawInput.value = resolvedInput.value = jsonText = '';
  el('json').textContent = '// Waiting for metadata…';
  for (const id of ['metadata-link', 'image-link', 'animation-link', 'download-media']) { link(id); el<HTMLAnchorElement>(id).removeAttribute('download'); }
  for (const id of ['copy-raw', 'copy-resolved', 'copy-json']) el<HTMLButtonElement>(id).disabled = true;
}
function failure(error: unknown, action: () => Promise<void>, ticket: Ticket, imageOnly = false) {
  if (!ticket.current()) return;
  const e = error instanceof Failure ? error : new Failure('metadata', error instanceof Error ? error.message : 'Lookup failed. Retry to try again.');
  pending = { error: e, action, ticket };
  status(`${imageOnly ? 'Metadata loaded. ' : ''}${e.kind === 'permission' ? '' : `${e.kind.toUpperCase()}: `}${e.message}`, 'error');
  const retry = el<HTMLButtonElement>('retry');
  retry.textContent = e.kind === 'permission' ? 'Allow and retry' : 'Retry';
  retry.hidden = false; retry.disabled = false;
  if (imageOnly) imageNote(e.kind === 'permission' ? 'Allow this media host to load the preview.' : `Preview unavailable. ${e.message}`);
  else {
    if (!jsonText) { el('name').textContent = 'Lookup incomplete'; el('json').textContent = '// Metadata is not available yet.'; }
    imageNote('Complete the lookup to see the image.');
  }
}
el('retry').addEventListener('click', () => {
  const attempt = pending;
  if (!attempt || !attempt.ticket.current()) return;
  el<HTMLButtonElement>('retry').disabled = true;
  // Call permissions.request directly in the click gesture, before any await.
  const grant = attempt.error.kind === 'permission' && attempt.error.origin
    ? chrome.permissions.request({ origins: [attempt.error.origin] }) : Promise.resolve(true);
  void grant.then(async granted => {
    if (pending !== attempt || !attempt.ticket.current()) return;
    if (!granted) {
      status('Host access was not granted. You can still open or copy the source URL.', 'error');
      el<HTMLButtonElement>('retry').disabled = false;
      return;
    }
    el('retry').hidden = true; pending = undefined;
    await attempt.action();
  }).catch(error => { if (attempt.ticket.current()) failure(error, attempt.action, attempt.ticket); });
});
function copyButton(id: string, content: () => string) {
  const label = el(id).getAttribute('aria-label') ?? 'Copy';
  let feedback: ReturnType<typeof setTimeout> | undefined;
  el(id).addEventListener('click', () => {
    const button = el<HTMLButtonElement>(id);
    void navigator.clipboard.writeText(content()).then(() => {
      button.dataset.copied = 'true'; button.title = 'Copied'; button.setAttribute('aria-label', 'Copied');
      if (feedback) clearTimeout(feedback);
      feedback = setTimeout(() => { delete button.dataset.copied; button.title = label; button.setAttribute('aria-label', label); }, 1500);
    }).catch(() => { status('Copy was blocked by the browser. Select the text and copy it manually.', 'error'); });
  });
}
copyButton('copy-raw', () => rawInput.value);
copyButton('copy-resolved', () => resolvedInput.value);
copyButton('copy-json', () => jsonText);

function showMetadata(data: Record<string, unknown>, id: bigint) {
  el('name').textContent = typeof data.name === 'string' && data.name ? data.name : `Token #${id}`;
  image.alt = typeof data.name === 'string' ? data.name : `Artwork for token ${id}`;
  el('description').textContent = typeof data.description === 'string' ? data.description : 'No description in this metadata.';
  jsonText = formatMetadata(data);
  renderJson(el('json'), jsonText); el<HTMLButtonElement>('copy-json').disabled = false;
  const attributes = el('attributes');
  if (Array.isArray(data.attributes)) {
    for (const attribute of data.attributes.slice(0, 200)) {
      if (!attribute || typeof attribute !== 'object') continue;
      const card = document.createElement('div'); card.className = 'attribute';
      const name = document.createElement('span'); name.textContent = String(attribute.trait_type ?? attribute.display_type ?? 'ATTRIBUTE');
      const value = document.createElement('strong'); value.textContent = typeof attribute.value === 'object' ? JSON.stringify(attribute.value) : String(attribute.value ?? '');
      card.append(name, value); attributes.append(card);
    }
    if (data.attributes.length > 200) { const note = document.createElement('p'); note.textContent = 'First 200 attributes shown. All attributes are in the JSON below.'; attributes.append(note); }
    attributes.hidden = !attributes.childElementCount;
  }
}
async function preview(url: string, ticket: Ticket, cachedImage?: Blob, cache?: { key: string; snapshot: Snapshot; epoch: number }) {
  if (!ticket.current()) return;

  imageNote('Loading media…', true);
  try {
    const blob = cachedImage ?? (url.startsWith('data:') ? embeddedMediaBlob(url) : await loadPreview(url, { signal: ticket.signal }));
    const extension = await mediaExtension(blob, url);
    const svgSize = extension === 'svg' ? await svgDimensions(blob).catch(() => undefined) : undefined;
    if (!ticket.current()) return;
    shareModal.setBlob(url, blob);
    if (extension === 'html') {
      const host = el('html-stage'); host.replaceChildren(); host.hidden = false;
      const html = await createHtmlMedia(blob, host, ticket.signal);
      if (!ticket.current()) { html.dispose(); return; }
      setBusy(el('image-placeholder'), false); el('image-placeholder').hidden = true;
      mediaModal.setHtml((stage, signal) => createHtmlMedia(blob, stage, signal));
      shareModal.setBlob(url, blob, html.width, html.height);
      el('media-caption').textContent = html.capture ? `${html.width} × ${html.height} canvas` : 'HTML artwork';
      el('media-type').textContent = 'HTML';
      el('media-size').textContent = `${Number((blob.size / 1_000_000).toFixed(2))} MB`;
      if (cache && !cachedImage) void rememberImage(cache.key, cache.snapshot, { url, blob }, cache.epoch).then(cacheChanged);
      status(''); return;
    }
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    const source = previewUrl = URL.createObjectURL(blob);
    // Keep Open image pointed at its original HTTP origin. Downloaded SVG bytes
    // must only be decoded as an image, never opened as an extension-origin document.
    image.onload = () => {
      if (!ticket.current()) return;
      image.hidden = false; setBusy(el('image-placeholder'), false); el('image-placeholder').hidden = true;
      mediaModal.ready();
      if (cache && !cachedImage) {
        void rememberImage(cache.key, cache.snapshot, { url, blob }, cache.epoch).then(cacheChanged);
      }
      const width = svgSize?.width ?? (extension === 'svg' ? undefined : image.naturalWidth);
      const height = svgSize?.height ?? (extension === 'svg' ? undefined : image.naturalHeight);
      shareModal.setBlob(url, blob, width, height);
      el('media-caption').textContent = width && height ? `${width} × ${height}${extension === 'svg' ? '' : ' pixels'}` : 'SVG image';
      el('media-type').textContent = extension === 'jpg' ? 'JPEG' : extension.toUpperCase();
      el('media-size').textContent = `${Number((blob.size / 1_000_000).toFixed(2))} MB`;
      status('');
    };
    image.onerror = () => failure(new Failure('image', 'The browser could not decode this image.'), () => preview(url, ticket, undefined, cache), ticket, true);
    image.src = source;
    // Embedded image URIs are copyable from the JSON; Chrome blocks direct top-level data navigation.
  } catch (e) { failure(e, () => preview(url, ticket, undefined, cache), ticket, true); }
}
async function run(fresh = false) {
  const fetchedAt = Date.now();
  const ticket = requests.begin();
  reset();
  try {
    const contract = address(contractInput.value);
    const id = tokenId(tokenInput.value);
    const method = methodInput.value as Method;
    contractInput.value = contract; tokenInput.value = id.toString();
    link('opensea-token-link', `https://opensea.io/item/ethereum/${contract.toLowerCase()}/${id}`);
    link('onchainchecker-token-link', `https://onchainchecker.xyz/collection/ethereum/${contract.toLowerCase()}/${id}`);
    el('token-service-links').hidden = false;
    updateReadContractButton();
    const contractLink = document.createElement('a');
    contractLink.textContent = contract; contractLink.href = explorer(contract);
    contractLink.target = '_blank'; contractLink.rel = 'noopener noreferrer'; contractLink.title = 'Read contract on Etherscan';
    el('token-caption').replaceChildren(contractLink, document.createTextNode(` · TOKEN #${id}`));
    history.replaceState(null, '', `#${new URLSearchParams({ contract, token: id.toString(), method, run: '1' })}`);
    status('Reading the contract on Ethereum mainnet…', 'loading');
    const prefs = await getSettings();
    if (!ticket.current()) return;
    alchemy.configure(prefs); alchemy.setToken(contract, id.toString());
    await saveLastContract(contract);
    if (!ticket.current()) return;
    const key = cacheKey(contract, id.toString(), method);
    const [stored, scope] = await Promise.all([readCache(key), cacheScope(prefs)]);
    if (!ticket.current()) return;
    const cached = fresh ? undefined : usableSnapshot(stored.row, scope);
    const result = cached?.result ?? await readTokenUri(prefs.rpcUrl, contract, id, method, { signal: ticket.signal });
    if (!ticket.current()) return;
    rawInput.value = result.raw; el<HTMLButtonElement>('copy-raw').disabled = false;
    el('method-badge').textContent = result.method === 'uri' ? 'ERC-1155' : 'ERC-721'; el('method-badge').hidden = false;
    const uri = result.method === 'uri' ? substituteId(result.raw, id) : result.raw;
    const metadataLocation = storageLocation(uri);
    showStorageBadge('metadata', metadataLocation);
    const resolved = resolveUri(uri, prefs);
    resolvedInput.value = resolved; el<HTMLButtonElement>('copy-resolved').disabled = false;
    if (!resolved.startsWith('data:')) link('metadata-link', httpUrl(resolved).href);
    status('URI resolved. Fetching metadata…', 'loading');
    const metadata = cached?.metadata ?? await loadMetadata(resolved, { signal: ticket.signal }, !!parseIpfs(uri));
    if (!ticket.current()) return;
    const snapshot: Snapshot = cached ?? { scope, fetchedAt, result, metadata };
    if (cached) {
      const time = new Date(cached.fetchedAt);
      el('cache-status').textContent = `Cached · ${time.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;
      el('cache-status').title = `Saved ${time.toLocaleString()}. Refresh fetches current contract, metadata, and media.`;
    }
    void rememberToken({ key, contract, token: id.toString(), method,
      name: typeof metadata.data.name === 'string' ? metadata.data.name.slice(0, 96) : '',
      visitedAt: Date.now(), snapshot }, stored.epoch).then(cacheChanged);
    showMetadata(metadata.data, id);
    if (resolved.startsWith('data:')) link('metadata-link', objectUrl(new Blob([jsonText], { type: 'application/json' })));
    else { resolvedInput.value = metadata.url; link('metadata-link', metadata.url); }
    const base = parseIpfs(uri) ? uri : metadata.url;
    const mediaReference = (reference: string) => resolveUri(result.method === 'uri' ? substituteId(reference, id) : reference, prefs, base);
    if (typeof metadata.data.animation_url === 'string' && metadata.data.animation_url) {
      try { link('animation-link', httpUrl(mediaReference(metadata.data.animation_url)).href); }
      catch { /* Non-HTTP references remain available in the selector and JSON. */ }
    }
    const media = tokenMedia(metadata.data);
    mediaSelect.replaceChildren(...media.map(item => new Option(item.field, item.field)));
    el('media-source-control').hidden = media.length < 2;
    status('');
    if (!media.length) { imageNote('This metadata does not include media.'); return; }
    selectMedia = async () => {
      if (!ticket.current()) return;
      const selected = media.find(item => item.field === mediaSelect.value);
      if (!selected) return;
      resetMedia();
      const selection = mediaRequests.begin();
      const mediaTicket: Ticket = { signal: selection.signal, current: () => ticket.current() && selection.current() };
      status('Loading media…', 'loading');
      const reference = result.method === 'uri' ? substituteId(selected.uri, id) : selected.uri;
      showStorageBadge('media', storageLocation(reference, { uri: base, location: metadataLocation }));
      try {
        const mediaUrl = mediaReference(selected.uri);
        if (mediaUrl.startsWith('data:') && !imageDataUri(mediaUrl) && !htmlDataUri(mediaUrl)) throw new Failure('image', 'This embedded media format is not supported.');
        if (!mediaUrl.startsWith('data:')) link('image-link', httpUrl(mediaUrl).href);
        shareModal.setSource(mediaUrl, { contract, id, title: typeof metadata.data.name === 'string' ? metadata.data.name : '' });
        await preview(mediaUrl, mediaTicket, cached?.image?.url === mediaUrl ? cached.image.blob : undefined, { key, snapshot, epoch: stored.epoch });
      } catch (e) { failure(e, () => selectMedia!(), mediaTicket, true); }
    };
    await selectMedia();
  } catch (e) { failure(e, () => run(true), ticket); }
}
el('lookup-form').addEventListener('submit', event => { event.preventDefault(); void run(); });
el('refresh').addEventListener('click', () => { void run(true); });
async function initialize() {
  void renderRecents();
  el('extension-version').textContent = `v${chrome.runtime.getManifest().version}`;
  const hash = new URLSearchParams(location.hash.slice(1));
  const failedHandoff = hash.get('launch') === 'toolbar' && hash.has('error');
  el('handoff-details').hidden = !failedHandoff;
  el('handoff-info').textContent = failedHandoff ? `tokint v${chrome.runtime.getManifest().version}\nInstalled manifest: ${chrome.runtime.getManifest().version}\nURL source: ${hash.get('via') ?? 'unknown'}\nResult: ${hash.get('handoff') ?? 'unknown'}\nSource page: ${hash.get('source') ?? 'No token page address received'}` : '';
  contractInput.value = hash.get('contract') ?? (failedHandoff ? '' : await getLastContract());
  updateReadContractButton();
  void configureAlchemy();
  tokenInput.value = hash.get('token') ?? '';
  methodInput.value = ['auto', 'tokenURI', 'uri'].includes(hash.get('method') ?? '') ? hash.get('method')! : 'auto';
  if (hash.has('error')) status(hash.get('error')!, 'error');
  else if (hash.get('run') === '1' && contractInput.value && tokenInput.value) await run();
  if (!tokenInput.value && contractInput.value) tokenInput.focus();
}
void initialize().catch(e => status(e instanceof Error ? e.message : 'Could not initialize the inspector.', 'error')).finally(() => document.querySelector<HTMLElement>('.shell')!.inert = false);
window.addEventListener('hashchange', () => {
  requests.cancel();
  mediaRequests.cancel();
  if (el('status').ariaBusy === 'true') status('');
  if (el('image-placeholder').ariaBusy === 'true') imageNote('No media loaded.');
  void initialize();
});
window.addEventListener('pagehide', () => { alchemy.dispose(); requests.cancel(); mediaRequests.cancel(); shareModal.reset(); mediaModal.reset(); if (previewUrl) URL.revokeObjectURL(previewUrl); objectUrls.forEach(URL.revokeObjectURL); });
