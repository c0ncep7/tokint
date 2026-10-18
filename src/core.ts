import { getAddress } from 'viem';
import { CID } from 'multiformats/cid';

export type FailureKind = 'input' | 'permission' | 'rpc' | 'contract' | 'metadata' | 'gateway' | 'json' | 'image';
export class Failure extends Error {
  constructor(public kind: FailureKind, message: string, public origin?: string) { super(message); this.name = 'Failure'; }
}
export type Method = 'auto' | 'tokenURI' | 'uri';
export type Settings = { rpcUrl: string; gatewayUrl: string; gatewayStyle: 'subdomain' | 'path' };
export const GATEWAYS: { id: string; name: string; gatewayUrl: string; gatewayStyle: Settings['gatewayStyle']; note: string }[] = [
  { id: 'pinata', name: 'Pinata (default)', gatewayUrl: 'https://gateway.pinata.cloud', gatewayStyle: 'path', note: 'Public Pinata gateway. Uses /ipfs/CID/path URLs.' },
  { id: 'filebase', name: 'Filebase', gatewayUrl: 'https://ipfs.filebase.io', gatewayStyle: 'path', note: 'Public Filebase gateway for light usage. Uses /ipfs/CID/path URLs.' },
  { id: 'ipfs-io', name: 'IPFS.io', gatewayUrl: 'https://ipfs.io', gatewayStyle: 'path', note: 'Shares infrastructure and rate limits with dweb.link.' },
  { id: 'dweb', name: 'dweb.link', gatewayUrl: 'https://dweb.link', gatewayStyle: 'subdomain', note: 'Uses a separate browser origin for each CID. Shares rate limits with IPFS.io.' },
];
export const DEFAULTS: Settings = { rpcUrl: 'https://ethereum-rpc.publicnode.com', gatewayUrl: GATEWAYS[0].gatewayUrl, gatewayStyle: GATEWAYS[0].gatewayStyle };
export const MAX_UINT256 = (1n << 256n) - 1n;

export function address(value: string): `0x${string}` {
  try { return getAddress(value.trim()); } catch { throw new Failure('input', 'Enter a complete 0x address with 40 hexadecimal characters.'); }
}
export function tokenId(value: string): bigint {
  if (!/^\d+$/.test(value.trim())) throw new Failure('input', 'Enter a non-negative decimal token ID.');
  const id = BigInt(value.trim());
  if (id > MAX_UINT256) throw new Failure('input', 'Token ID exceeds the uint256 limit.');
  return id;
}
export function httpUrl(value: string): URL {
  let u: URL;
  try { u = new URL(value); } catch { throw new Failure('input', 'Enter a valid HTTP or HTTPS URL.'); }
  if (!['http:', 'https:'].includes(u.protocol) || u.username || u.password) throw new Failure('input', 'Only HTTP and HTTPS URLs without embedded usernames or passwords are supported.');
  return u;
}
export function settings(value: Settings): Settings {
  const rpc = httpUrl(value.rpcUrl.trim());
  const gateway = httpUrl(value.gatewayUrl.trim());
  if (gateway.pathname !== '/' || gateway.search || gateway.hash) throw new Failure('input', 'Gateway must be a base URL, for example https://dweb.link (without /ipfs/).');
  if (value.gatewayStyle !== 'path' && value.gatewayStyle !== 'subdomain') throw new Failure('input', 'Choose a gateway URL style.');
  if (value.gatewayStyle === 'subdomain' && (gateway.hostname === 'localhost' || /^[\d.]+$/.test(gateway.hostname) || gateway.hostname.includes(':'))) throw new Failure('input', 'Use path style for a local or IP-address gateway.');
  rpc.hash = '';
  return { rpcUrl: rpc.href, gatewayUrl: gateway.origin, gatewayStyle: value.gatewayStyle };
}
export function permissionPattern(url: string): string {
  const u = httpUrl(url);
  return `${u.protocol}//${u.hostname}/*`;
}
export type IpfsRef = { cid: string; suffix: string };
export function parseIpfs(value: string): IpfsRef | null {
  let raw = value.trim();
  if (/^https?:\/\//i.test(raw)) {
    const u = httpUrl(raw);
    const match = u.hostname.match(/^([^.]+)\.ipfs\./i);
    if (match) raw = match[1] + u.pathname + u.search + u.hash;
    else if (u.pathname.startsWith('/ipfs/')) raw = u.pathname.slice(6) + u.search + u.hash;
    else return null;
  } else {
    raw = raw.replace(/^ipfs:\/\/(?:ipfs\/)?/i, '').replace(/^\/ipfs\//, '');
  }
  const match = raw.match(/^([^/?#]+)(.*)$/);
  if (!match) return null;
  try { return { cid: CID.parse(match[1]).toV1().toString(), suffix: match[2] }; } catch { return null; }
}
export function ipfsUrl(ref: IpfsRef, prefs: Settings): string {
  const root = httpUrl(prefs.gatewayUrl);
  if (prefs.gatewayStyle === 'subdomain') root.hostname = `${ref.cid}.ipfs.${root.hostname}`;
  const prefix = prefs.gatewayStyle === 'path' ? `/ipfs/${ref.cid}` : '';
  // Resolve dot segments within the CID root before adding a path-gateway prefix.
  const tail = new URL(ref.suffix.startsWith('/') ? ref.suffix : '/' + ref.suffix, 'https://ipfs.invalid');
  return `${root.origin}${prefix}${tail.pathname}${tail.search}${tail.hash}`;
}
export function resolveUri(value: string, prefs: Settings, base?: string): string {
  const raw = value.trim();
  const ipfs = parseIpfs(raw);
  if (ipfs) return ipfsUrl(ipfs, prefs);
  if (/^ipfs:/i.test(raw)) throw new Failure('input', 'The IPFS URI contains an invalid CID.');
  if (/^data:/i.test(raw)) return `data:${raw.slice(5)}`;
  if (/^https?:/i.test(raw)) return httpUrl(raw).href;
  if (base && !/^[a-z][a-z\d+.-]*:/i.test(raw)) {
    if (raw.startsWith('//')) return httpUrl(`https:${raw}`).href;
    const ref = parseIpfs(base);
    if (ref && !raw.startsWith('//')) {
      const logical = new URL(raw, `https://ipfs.invalid${ref.suffix.startsWith('/') ? ref.suffix : '/' + ref.suffix}`);
      return ipfsUrl({ cid: ref.cid, suffix: logical.pathname + logical.search + logical.hash }, prefs);
    }
    return httpUrl(new URL(raw, base).href).href;
  }
  throw new Failure('input', 'This URI scheme is not supported. Use IPFS, HTTP(S), or embedded data.');
}
export function substituteId(value: string, id: bigint): string { return value.replaceAll('{id}', id.toString(16).padStart(64, '0')); }
export function explorer(contract: string): string { return `https://etherscan.io/address/${address(contract)}#readContract`; }
export type Query = { kind: 'contract'; contract: string } | { kind: 'token'; contract: string; id: string } | { kind: 'ipfs'; ref: IpfsRef };
export function parseQuery(value: string): Query {
  const raw = value.trim();
  const parts = raw.split(/\s+/);
  if (/^0x/i.test(parts[0])) {
    const contract = address(parts[0]);
    if (parts.length === 1) return { kind: 'contract', contract };
    if (parts.length === 2) return { kind: 'token', contract, id: tokenId(parts[1]).toString() };
    throw new Failure('input', 'Use a contract address followed by one decimal token ID.');
  }
  const ref = parseIpfs(raw);
  if (ref) return { kind: 'ipfs', ref };
  throw new Failure('input', 'Enter a contract address, an address + token ID, or an IPFS URI / CID.');
}
export function imageDataUri(value: string): boolean { return /^data:image\/(?:png|jpeg|gif|webp|avif|bmp|svg\+xml)(?:;|,)/i.test(value); }
export function htmlDataUri(value: string): boolean { return /^data:text\/html(?:;|,)/i.test(value); }
export function readDataJson(uri: string): Record<string, unknown> {
  const match = uri.match(/^data:application\/json((?:;[^,]*)?),(.*)$/is);
  if (!match) throw new Failure('json', 'Expected an embedded application/json data URI.');
  try {
    const encoded = decodeURIComponent(match[2]);
    const raw = /;base64(?:;|$)/i.test(match[1]) ? new TextDecoder('utf-8', { fatal: true }).decode(Uint8Array.from(atob(encoded), c => c.charCodeAt(0))) : encoded;
    return parseMetadata(raw);
  } catch (e) { if (e instanceof Failure) throw e; throw new Failure('json', 'The embedded JSON could not be decoded.'); }
}
export const MAX_METADATA = 2 * 1024 * 1024;
export function parseMetadata(text: string): Record<string, unknown> {
  if (new TextEncoder().encode(text).length > MAX_METADATA) throw new Failure('json', 'Metadata exceeds the 2 MB limit. Open the source URL to inspect it.');
  try {
    const data: unknown = JSON.parse(text);
    if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error();
    return data as Record<string, unknown>;
  } catch { throw new Failure('json', 'The response is not a JSON object. Open the source URL to inspect it.'); }
}
export class LatestRequest {
  private controller?: AbortController;
  private version = 0;
  begin() {
    this.controller?.abort();
    const version = ++this.version;
    const controller = this.controller = new AbortController();
    return { signal: controller.signal, current: () => version === this.version && !controller.signal.aborted };
  }
  cancel() { this.controller?.abort(); ++this.version; }
}
