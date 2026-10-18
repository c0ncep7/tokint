import { address, Failure, tokenId } from './core';

/** Read only the clicked tab URL; never fetch or inject into the OpenSea page. */
export function openSeaToken(value?: string): { contract: string; id: string } | null {
  if (!value) return null;
  let url: URL;
  try { url = new URL(value); } catch { return null; }
  if (url.protocol !== 'https:' || !['opensea.io', 'www.opensea.io'].includes(url.hostname) || url.port || url.username || url.password) return null;
  const parts = url.pathname.replace(/\/+$/, '').slice(1).split('/');
  // OpenSea also serves localized pages, e.g. /fr/item/ethereum/… .
  if (/^[a-z]{2}(?:-[a-z]{2})?$/i.test(parts[0])) parts.shift();
  const [route] = parts;
  let chain: string, contract: string, id: string;
  if ((route === 'item' || route === 'assets') && parts.length === 4) [, chain, contract, id] = parts;
  else if (route === 'assets' && parts.length === 3) { chain = 'ethereum'; [, contract, id] = parts; }
  else return null;
  if (chain !== 'ethereum') throw new Failure('input', 'This OpenSea token is on another network. tokint supports Ethereum mainnet only.');
  try {
    return { contract: address(decodeURIComponent(contract)), id: tokenId(decodeURIComponent(id)).toString() };
  } catch {
    throw new Failure('input', 'Could not read a valid contract address and token ID from this OpenSea URL.');
  }
}
