import { readTokenUri } from '../src/chain';
import { loadMetadata } from '../src/network';
import { DEFAULTS, resolveUri } from '../src/core';

// Public, read-only examples. Not part of deterministic npm test runs.
const network = { permitted: async () => true };
const loot = await readTokenUri(DEFAULTS.rpcUrl, '0xff9c1b15b16263c61d017ee9f65c50e4ae0113d7', 1n, 'auto', network);
const embedded = await loadMetadata(loot.raw, network);
console.log(`Loot #1: ${embedded.data.name}; ${loot.method}; embedded image: ${String(embedded.data.image).startsWith('data:image/')}`);
const bayc = await readTokenUri(DEFAULTS.rpcUrl, '0xbc4ca0eda7647a8ab7c2061c2e118a18a936f13d', 1n, 'auto', network);
console.log(`BAYC #1 URI: ${bayc.raw}`);
try {
  const metadata = await loadMetadata(resolveUri(bayc.raw, DEFAULTS), network, true);
  console.log(`BAYC metadata loaded; image present: ${typeof metadata.data.image === 'string'}`);
} catch (error) {
  console.error(`Live gateway check did not complete: ${error instanceof Error ? error.message : error}`);
  process.exitCode = 1;
}
