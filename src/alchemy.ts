import { address, Failure, tokenId, type Settings } from './core';
import { validateAlchemyRpc } from './rpc-presets';
import { requestBytes, type NetworkOptions } from './network';

export const THUMBNAIL_ORIGINS = ['https://nft-cdn.alchemy.com/*', 'https://res.cloudinary.com/*'];
export function alchemyEnabled(prefs: Settings): boolean {
  try {
    validateAlchemyRpc(prefs.rpcUrl);
    return /^\/v2\/[a-z\d_-]+$/i.test(new URL(prefs.rpcUrl).pathname);
  } catch { return false; }
}
type Endpoint = 'getNFTsForContract' | 'getNFTsForOwner' | 'getOwnersForNFT' | 'getNFTMetadata';
export async function alchemyRequest(prefs: Settings, endpoint: Endpoint, params: Record<string, string>, opts: NetworkOptions = {}): Promise<Record<string, unknown>> {
  if (!alchemyEnabled(prefs)) throw new Failure('input', 'Configure Alchemy in Settings to use this feature.');
  const url = new URL(prefs.rpcUrl);
  url.pathname = `/nft/v3/${url.pathname.slice(4)}/${endpoint}`;
  url.search = new URLSearchParams(params).toString();
  try {
    const response = await requestBytes(url.href, 'metadata', 8 * 1024 * 1024, { timeoutMs: 15_000, ...opts });
    let data;
    try { data = JSON.parse(new TextDecoder().decode(response.bytes)); }
    catch { throw new Failure('json', 'Alchemy returned invalid JSON. Retry to try again.'); }
    if (!data || typeof data !== 'object' || Array.isArray(data) || data.error) throw new Failure('metadata', 'Alchemy could not complete this request. Check NFT API access in Settings, then retry.');
    return data;
  } catch (e) {
    if (opts.signal?.aborted) throw e;
    if (e instanceof Failure) {
      if (/HTTP (401|403)/.test(e.message)) throw new Failure('metadata', 'Alchemy rejected this configuration. Check your RPC URL and NFT API access in Settings.');
      if (e.kind === 'permission') throw e;
      throw new Failure(e.kind, e.message.replace('Metadata host', 'Alchemy'));
    }
    // Never surface service responses/URLs which could include the configured credential.
    throw new Failure('metadata', 'Alchemy could not complete this request. Retry to try again.');
  }
}
const record = (value: unknown): Record<string, unknown> => value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
const text = (value: unknown) => typeof value === 'string' ? value : '';
export function apiTokenId(value: unknown): string {
  if (typeof value !== 'string' || !/^(?:\d+|0x[\da-f]+)$/i.test(value)) throw new Failure('json', 'Alchemy returned an invalid token ID.');
  return tokenId(BigInt(value).toString()).toString();
}
export function thumbnailUrl(value: unknown): string | undefined {
  try {
    const url = new URL(text(value));
    if (url.protocol !== 'https:' || url.username || url.password || url.port) return;
    if (url.hostname === 'nft-cdn.alchemy.com' || (url.hostname === 'res.cloudinary.com' && url.pathname.startsWith('/alchemyapi/'))) return url.href;
  } catch { /* Missing thumbnails leave an identity-only card. */ }
}
export type BrowseToken = { contract: string; token: string; name: string; collection: string; thumbnail?: string };
export type BrowseMode = 'collection' | 'wallet';
export function parseBrowse(data: Record<string, unknown>, mode: BrowseMode, collection?: string) {
  const raw = data[mode === 'collection' ? 'nfts' : 'ownedNfts'];
  if (!Array.isArray(raw)) throw new Failure('json', 'Alchemy returned an invalid token list.');
  const items: BrowseToken[] = [];
  let skipped = 0;
  for (const value of raw.slice(0, 24)) {
    try {
      const nft = record(value), contract = record(nft.contract), image = record(nft.image);
      const contractAddress = address(text(contract.address) || collection || '');
      if (collection && contractAddress.toLowerCase() !== collection.toLowerCase()) throw new Error('Different collection');
      const token = apiTokenId(nft.tokenId);
      if (items.some(item => item.contract === contractAddress && item.token === token)) continue;
      items.push({ contract: contractAddress, token, name: text(nft.name).slice(0, 160), collection: text(contract.name).slice(0, 120), thumbnail: thumbnailUrl(image.thumbnailUrl) ?? thumbnailUrl(image.cachedUrl) });
    } catch { skipped++; }
  }
  const next = text(data.pageKey) || text(data.nextToken);
  if (raw.length > 24) throw new Failure('json', 'Alchemy returned more tokens than requested. Retry to try again.');
  return { items, next: next.length <= 4096 ? next : '', skipped };
}
export async function browseTokens(prefs: Settings, mode: BrowseMode, target: string, cursor: string, opts: NetworkOptions = {}) {
  const identity = address(target);
  const params: Record<string, string> = { withMetadata: 'true', tokenUriTimeoutInMs: '0' };
  if (mode === 'collection') { params.contractAddress = identity; params.limit = '24'; if (cursor) params.startToken = cursor; }
  else { params.owner = identity; params.pageSize = '24'; if (cursor) params.pageKey = cursor; }
  const data = await alchemyRequest(prefs, mode === 'collection' ? 'getNFTsForContract' : 'getNFTsForOwner', params, opts);
  return parseBrowse(data, mode, mode === 'collection' ? identity : undefined);
}
export function parseOwners(data: Record<string, unknown>) {
  if (data.owners === null) return { owners: [], incomplete: !!data.pageKey };
  if (!Array.isArray(data.owners)) throw new Failure('json', 'Alchemy returned an invalid owner list.');
  const owners: string[] = [];
  let incomplete = !!data.pageKey || data.owners.length > 100;
  for (const value of data.owners.slice(0, 100)) {
    try { const owner = address(text(value)); if (!owners.includes(owner)) owners.push(owner); }
    catch { incomplete = true; }
  }
  return { owners, incomplete };
}
export function parseMint(data: Record<string, unknown>) {
  const mint = record(data.mint);
  let recipient: string | undefined;
  try { recipient = address(text(mint.mintAddress)); } catch { /* Not indexed. */ }
  const tx = /^0x[\da-f]{64}$/i.test(text(mint.transactionHash)) ? text(mint.transactionHash) : undefined;
  const n = mint.blockNumber;
  const block = typeof n === 'number' && Number.isSafeInteger(n) && n >= 0 ? String(n) : typeof n === 'string' && /^\d+$/.test(n) ? n : undefined;
  const timestamp = text(mint.timestamp);
  const date = timestamp && Number.isFinite(Date.parse(timestamp)) ? new Date(timestamp).toISOString() : undefined;
  return { recipient, tx, block, date };
}
