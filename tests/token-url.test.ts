import { test } from 'node:test';
import assert from 'node:assert/strict';
import { tokenFromUrl } from '../src/token-url';
const contract = '0xA930ef880909b589a525ffd9Bd8E60854A2E0A02';
const path = `${contract}/1`;

test('detects SuperRare and arbitrary sites with adjacent contract/token path segments', () => {
  for (const url of [`https://superrare.com/artwork/eth/${path}`, `https://example.org/${path}`, `http://localhost:8080/gallery/${path}/details/?foo=bar#art`, `https://example.org/作品/${path}`]) {
    assert.deepEqual(tokenFromUrl(url), { contract, id: '1' });
  }
});
test('keeps large IDs exact, normalizes zeros and decodes path segments once', () => {
  const max = ((1n << 256n) - 1n).toString();
  for (const [input, id] of [[max,max],['0','0'],['00001','1'],['%31','1']]) {
    assert.equal(tokenFromUrl(`https://example.org/${contract}/${input}`)?.id, id);
  }
  assert.throws(() => tokenFromUrl(`https://example.org/${contract}/${1n << 256n}`), /uint256/);
});
test('ignores non-token paths, query/fragment matches, invalid IDs, and unsafe schemes', () => {
  for (const url of [undefined,'bad url',`file:///${path}`,`https://user:pass@example.org/${path}`,`https://example.org/?next=/${path}`,`https://example.org/#/${path}`,`https://example.org/${contract}`,`https://example.org/${contract}/-1`,`https://example.org/${contract}/1.5`,`https://example.org/${contract}/0x01`,`https://example.org/${contract}/1e3`,`https://example.org/${contract}/%ZZ`,`https://example.org/${contract}/%2531`,`https://example.org/${contract}/%201%20`,`https://example.org/${contract}/%31%2F2`,`https://example.org/0x123/1`]) assert.equal(tokenFromUrl(url), null, url);
});
test('rejects explicit other networks and testnet hosts', () => {
  for (const prefix of ['base','polygon','arbitrum','sepolia','chain/8453','network/unknown']) assert.throws(() => tokenFromUrl(`https://example.org/${prefix}/${path}`), /Ethereum mainnet only/);
  for (const query of ['chain=base','chainId=8453','network=sepolia']) assert.throws(() => tokenFromUrl(`https://example.org/${path}?${query}`), /Ethereum mainnet only/);
  assert.throws(() => tokenFromUrl(`https://testnets.opensea.io/assets/${path}`), /Ethereum mainnet only/);
  for (const prefix of ['eth','ethereum','chain/1','network/mainnet']) assert.equal(tokenFromUrl(`https://example.org/${prefix}/${path}`)?.id, '1');
  assert.equal(tokenFromUrl(`https://example.org/collection/base/art/${path}?chainId=1`)?.id, '1');
});
test('does not bypass OpenSea route or network validation', () => {
  assert.equal(tokenFromUrl(`https://opensea.io/item/ethereum/${path}`)?.id, '1');
  assert.throws(() => tokenFromUrl(`https://opensea.io/item/base/${path}`), /Ethereum mainnet only/);
  assert.equal(tokenFromUrl(`https://opensea.io/collection/${contract}`), null);
});
test('rejects ambiguous token pairs instead of guessing; identical pairs are harmless', () => {
  assert.throws(() => tokenFromUrl(`https://example.org/${path}/compare/${contract}/2`), /more than one token/);
  assert.deepEqual(tokenFromUrl(`https://example.org/${path}/compare/${path}`), { contract, id:'1' });
});
