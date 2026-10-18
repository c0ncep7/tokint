import { address, Failure, tokenId } from './core';
import { openSeaToken } from './opensea';

const mainnet = new Set(['eth', 'ethereum', 'mainnet', 'ethereum-mainnet', '1', '0x1', 'eip155:1']);
const otherNetworks = new Set(['base', 'polygon', 'matic', 'arbitrum', 'arbitrum-one', 'optimism', 'optimistic', 'bsc', 'bnb', 'avalanche', 'avax', 'solana', 'zora', 'blast', 'linea', 'scroll', 'mantle', 'gnosis', 'ronin', 'apechain', 'abstract', 'celo', 'zksync', 'sepolia', 'goerli', 'holesky', 'hoodi', 'testnet']);
const networkError = () => new Failure('input', 'This token URL identifies another network. tokint supports Ethereum mainnet only.');

/** Recognize adjacent address/decimal-ID path segments, without reading page content. */
export function tokenFromUrl(value?: string): { contract: string; id: string } | null {
  if (!value) return null;
  let url: URL;
  try { url = new URL(value); } catch { return null; }
  if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password) return null;
  // Preserve the explicit chain and route checks for OpenSea's known formats.
  if (['opensea.io', 'www.opensea.io'].includes(url.hostname)) return openSeaToken(value);
  const parts = url.pathname.split('/').map(part => {
    try { return decodeURIComponent(part); } catch { return part; }
  });
  const matches = new Map<string, { contract: string; id: string }>();
  for (let i = 0; i < parts.length - 1; i++) {
    if (!/^0x[\da-f]{40}$/i.test(parts[i]) || !/^\d+$/.test(parts[i + 1])) continue;
    const preceding = (parts[i - 1] ?? '').toLowerCase();
    const explicitPathChain = /^(chain|chainid|network)$/.test((parts[i - 2] ?? '').toLowerCase());
    if (otherNetworks.has(preceding) || (explicitPathChain && !mainnet.has(preceding)) || /(^|[.-])(testnets?|sepolia|goerli|holesky|hoodi)([.-]|$)/i.test(url.hostname)) throw networkError();
    for (const [key, chain] of url.searchParams) {
      if (/^(chain|chainid|network)$/i.test(key) && !mainnet.has(chain.toLowerCase())) throw networkError();
    }
    const token = { contract: address(parts[i]), id: tokenId(parts[i + 1]).toString() };
    matches.set(`${token.contract}/${token.id}`, token);
  }
  if (matches.size > 1) throw new Failure('input', 'This URL contains more than one token. Enter the contract and token ID to choose which one to inspect.');
  return matches.values().next().value ?? null;
}
