import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CID } from 'multiformats/cid';
import { storageLocation } from '../src/storage-location';

const cid0 = 'QmYwAPJzv5CZsnAzt8auVTLnEKjHhhtvE4s1wKpR1X4M8F';
const cid = CID.parse(cid0).toV1().toString();
test('embedded JSON classifies as on-chain with base64 and percent encoding', () => {
  for (const uri of ['data:application/json;base64,e30=', 'data:application/json,%7B%7D', ' DATA:application/json,{} ']) assert.equal(storageLocation(uri), 'on-chain');
});
test('IPFS CID versions, paths and gateways classify as decentralized', () => {
  for (const uri of [`ipfs://${cid0}/metadata/1.json`, `${cid}/1`, `/ipfs/${cid}/1`, `https://gateway.example/ipfs/${cid0}/1`, `https://${cid}.ipfs.dweb.link/metadata/1.json`]) assert.equal(storageLocation(uri), 'decentralized');
});
test('Arweave gateways and native refs classify without matching lookalike hosts', () => {
  for (const uri of ['https://arweave.net/id', 'https://media.arweave.net/id', 'https://ARWEAVE.NET./id', 'ar://transaction/media.svg']) assert.equal(storageLocation(uri), 'decentralized');
  for (const uri of ['https://arweave.net.evil.example/id', 'https://not-arweave.net/id', 'https://example.com/?url=ipfs://cid', 'https://example.com/image.jpg']) assert.equal(storageLocation(uri), 'centralized');
});
test('embedded remote media inherits storage of containing metadata', () => {
  const image = 'data:image/svg+xml,%3Csvg/%3E';
  for (const location of ['on-chain', 'decentralized', 'centralized'] as const) assert.equal(storageLocation(image, { uri: 'https://example.com/token.json', location }), location);
});
test('absolute media references are classified independently of metadata', () => {
  const parent = { uri: 'data:application/json,{}', location: 'on-chain' as const };
  assert.equal(storageLocation('https://example.com/image.jpg', parent), 'centralized');
  assert.equal(storageLocation(`ipfs://${cid}/image.gif`, parent), 'decentralized');
  assert.equal(storageLocation('//arweave.net/image', parent), 'decentralized');
});
test('relative media follows its original logical metadata location', () => {
  for (const uri of [`ipfs://${cid}/meta/1.json`, `https://example.com/ipfs/${cid}/meta/1.json`, 'https://arweave.net/id/meta/1.json']) {
    assert.equal(storageLocation('../images/1.svg', { uri, location: 'decentralized' }), 'decentralized');
  }
  assert.equal(storageLocation('../1.svg', { uri: 'https://example.com/meta/1', location: 'centralized' }), 'centralized');
  assert.equal(storageLocation('//example.com/1.svg', { uri: `ipfs://${cid}/meta/1`, location: 'decentralized' }), 'centralized');
  // The resolver treats a path-gateway reference as logical IPFS, retaining its CID root.
  assert.equal(storageLocation('/logo.svg', { uri: `https://example.com/ipfs/${cid}/meta/1`, location: 'decentralized' }), 'decentralized');
});
test('missing or unsupported references never claim on-chain or centralized storage', () => {
  for (const value of ['', ' ', 'ipfs://invalid', 'javascript:alert(1)', 'blob:https://example.com/id', 'https://', 'https://arweave.net@other.example/id', 'relative.svg']) assert.equal(storageLocation(value), null);
  assert.equal(storageLocation('relative.svg', { uri: 'data:application/json,{}', location: 'on-chain' }), null);
});
