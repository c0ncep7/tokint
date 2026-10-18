import { parseIpfs } from './core';

export type StorageLocation = 'on-chain' | 'decentralized' | 'centralized';

/** Classify a URI's storage location, not availability or artwork dependencies. */
export function storageLocation(reference: string, parent?: { uri: string; location: StorageLocation | null }): StorageLocation | null {
  const raw = reference.trim();
  if (!raw) return null;
  // Embedded media lives wherever its containing JSON lives.
  if (/^data:/i.test(raw)) return parent ? parent.location : 'on-chain';
  try {
    if (parseIpfs(raw)) return 'decentralized';
    if (/^ar:\/\/[^/]+/i.test(raw)) return 'decentralized';
    if (!/^[a-z][a-z\d+.-]*:/i.test(raw) && !raw.startsWith('//')) {
      if (!parent || /^data:/i.test(parent.uri)) return null;
      if (parseIpfs(parent.uri) || /^ar:\/\//i.test(parent.uri)) return 'decentralized';
      return storageLocation(new URL(raw, parent.uri).href);
    }
    const url = new URL(raw.startsWith('//') ? `https:${raw}` : raw);
    if (!['https:', 'http:'].includes(url.protocol)) return null;
    const host = url.hostname.toLowerCase().replace(/\.$/, '');
    if (['arweave.net'].some(root => host === root || host.endsWith(`.${root}`))) return 'decentralized';
    return 'centralized';
  } catch { return null; }
}
