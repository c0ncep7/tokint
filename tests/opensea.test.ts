import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openSeaToken } from '../src/opensea';
import { MAX_UINT256 } from '../src/core';
const contract = '0x0000000000000000000000000000000000000001';

test('OpenSea current, legacy, localized and www token pages yield exact token IDs', () => {
  for (const path of [`item/ethereum/${contract}/123`, `assets/ethereum/${contract}/123`, `assets/${contract}/123`, `fr/item/ethereum/${contract}/123`, `zh-CN/assets/ethereum/${contract}/123`]) {
    for (const host of ['opensea.io', 'www.opensea.io']) assert.deepEqual(openSeaToken(`https://${host}/${path}/?ref=profile#details`), { contract, id: '123' });
  }
});
test('OpenSea IDs remain uint256-precise and normalize leading zeros', () => {
  assert.equal(openSeaToken(`https://opensea.io/item/ethereum/${contract}/${MAX_UINT256}`)?.id, MAX_UINT256.toString());
  assert.equal(openSeaToken(`https://opensea.io/item/ethereum/${contract}/000`)?.id, '0');
  assert.equal(openSeaToken(`https://opensea.io/item/ethereum/${contract}/%31%32%33`)?.id, '123');
});
test('unrelated pages, lookalike hosts and unavailable tab URLs leave the regular inspector intact', () => {
  for (const url of [undefined, '', 'not a URL', 'chrome://newtab', 'https://example.com', 'https://opensea.io/', 'https://opensea.io/collection/test', `https://opensea.io/token/ethereum/${contract}`, `https://opensea.io.evil.example/item/ethereum/${contract}/1`, `https://testnets.opensea.io/item/ethereum/${contract}/1`, `https://opensea.io@evil.example/item/ethereum/${contract}/1`, `http://opensea.io/item/ethereum/${contract}/1`, `https://opensea.io/item/ethereum/${contract}/1/extra`]) assert.equal(openSeaToken(url), null);
});
test('other OpenSea networks are rejected instead of queried against Ethereum', () => {
  for (const chain of ['base', 'polygon', 'arbitrum', 'solana', 'sepolia']) assert.throws(() => openSeaToken(`https://opensea.io/item/${chain}/${contract}/1`), /Ethereum mainnet only/);
});
test('malformed OpenSea contracts and token IDs produce an error without an automatic lookup', () => {
  for (const path of [`item/ethereum/0x123/1`, `item/ethereum/${contract}/-1`, `item/ethereum/${contract}/1.5`, `item/ethereum/${contract}/0x01`, `item/ethereum/${contract}/${MAX_UINT256 + 1n}`, `item/ethereum/${contract}/%ZZ`]) assert.throws(() => openSeaToken(`https://opensea.io/${path}`), /valid contract address and token ID/);
});
