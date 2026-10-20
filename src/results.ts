import { ensureVault } from './vault-ui';
import { getSettings } from './storage';
import { ipfsUrl, parseQuery } from './core';
await ensureVault();
const ipfs = new URLSearchParams(location.hash.slice(1)).get('ipfs');
if (ipfs) {
  const query = parseQuery(ipfs);
  if (query.kind === 'ipfs') location.replace(ipfsUrl(query.ref, await getSettings()));
  else await import('./inspector');
} else await import('./inspector');
