import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CID } from 'multiformats/cid';
import { address, contentUrl, DEFAULTS, explorer, formatMetadata, httpUrl, imageDataUri, ipfsUrl, LatestRequest, MAX_METADATA, MAX_UINT256, parseIpfs, parseMetadata, parseQuery, readDataJson, resolveUri, settings, substituteId, tokenId } from '../src/core';

const DWEB = { ...DEFAULTS, gatewayUrl: 'https://dweb.link', gatewayStyle: 'subdomain' as const };
const contract = '0x0000000000000000000000000000000000000001';
const cid0 = 'QmYwAPJzv5CZsnAzt8auVTLnEKjHhhtvE4s1wKpR1X4M8F';
const cid = CID.parse(cid0).toV1().toString();
test('Arweave transaction URLs use their deterministic sandbox and preserve resource suffixes', () => {
  const id = 'SlaIzGKzkNyMyK-wNfXRjjNUWSFXDD7kIrrR98rxoU4';
  const host = 'jjlirtdcwoinzdgiv6ydl5orryzviwjbk4gd5zbcxli7psxrufha.arweave.net';
  for (const suffix of ['', '/nested/art%20work.png?download=1#frame']) {
    assert.equal(contentUrl(`https://arweave.net/${id}${suffix}`), `https://${host}/${id}${suffix}`);
    assert.equal(contentUrl(`https://${host}/${id}${suffix}`), `https://${host}/${id}${suffix}`);
  }
  // Independent published AR.IO example, not just this token's regression vector.
  const example = 'gnWKBqFXMJrrksEWrXLQRUQQQeFhv4uVxesHBcT8i6o';
  assert.equal(contentUrl(`https://arweave.net/${example}`), `https://qj2yubvbk4yjv24syelk24wqivcbaqpbmg7yxfof5mdqlrh4rova.arweave.net/${example}`);
  for (const url of [
    `https://arweave.net.example/${id}`, `https://custom.example/${id}`,
    `https://arweave.net:8443/${id}`, `https://arweave.net/tx/${id}/status`,
    'https://arweave.net/info', `https://arweave.net/${id}extra`,
    `https://arweave.net/${id.slice(0, -1)}5`, // Non-canonical base64 padding bits.
  ]) assert.equal(contentUrl(url), url);
  assert.throws(() => contentUrl(`http://arweave.net/${id}`), /HTTPS/);
  assert.throws(() => contentUrl(`https://user:pass@arweave.net/${id}`), /HTTPS/);
});
test('address commands route to Read Contract', () => {
  assert.deepEqual(parseQuery(`  ${contract} `), { kind: 'contract', contract });
  assert.equal(explorer(contract), `https://etherscan.io/address/${contract}#readContract`);
  assert.throws(() => address('0x123'));
});
test('token commands preserve uint256 precision', () => {
  const id = '900719925474099312345';
  assert.deepEqual(parseQuery(`${contract} ${id}`), { kind: 'token', contract, id });
  assert.equal(tokenId(MAX_UINT256.toString()), MAX_UINT256);
  assert.equal(tokenId('000'), 0n);
  for (const bad of ['-1', '1.5', '1e4', '0xff', '', (MAX_UINT256 + 1n).toString()]) assert.throws(() => tokenId(bad));
  assert.throws(() => parseQuery(`${contract} 1 2`));
});
test('CIDv0, CIDv1, ipfs://ipfs and gateway forms normalize', () => {
  for (const input of [cid0, cid, `ipfs://${cid0}`, `ipfs://ipfs/${cid0}`, `/ipfs/${cid}`, `https://ipfs.io/ipfs/${cid}`, `https://${cid}.ipfs.dweb.link`]) {
    const parsed = parseIpfs(input)!;
    assert.equal(parsed.cid, cid);
    assert.equal(ipfsUrl(parsed, DWEB), `https://${cid}.ipfs.dweb.link/`);
  }
  assert.equal(parseQuery(cid0).kind, 'ipfs');
  assert.equal(parseIpfs('not-a-cid'), null);
  assert.throws(() => resolveUri('ipfs://not-a-cid/foo', DWEB));
});
test('IPFS URLs preserve paths, query, fragment and filenames', () => {
  const uri = `ipfs://${cid0}/folder/one%20two.json?download=1#item`;
  assert.equal(resolveUri(uri, DWEB), `https://${cid}.ipfs.dweb.link/folder/one%20two.json?download=1#item`);
  assert.equal(resolveUri(uri, { ...DWEB, gatewayUrl: 'https://ipfs.io', gatewayStyle: 'path' }), `https://ipfs.io/ipfs/${cid}/folder/one%20two.json?download=1#item`);
});
test('relative media resolves inside the IPFS root for both gateway styles', () => {
  const base = `ipfs://${cid}/metadata/1.json`;
  assert.equal(resolveUri('../images/1.svg', DWEB, base), `https://${cid}.ipfs.dweb.link/images/1.svg`);
  assert.equal(resolveUri('/image.png', { ...DWEB, gatewayUrl: 'https://ipfs.io', gatewayStyle: 'path' }, base), `https://ipfs.io/ipfs/${cid}/image.png`);
  assert.equal(resolveUri('../../../../image.png', DWEB, base), `https://${cid}.ipfs.dweb.link/image.png`);
  assert.equal(resolveUri('../image.png', DWEB, 'https://example.com/metadata/1.json'), 'https://example.com/image.png');
  assert.equal(resolveUri('//example.com/image.png', DWEB, base), 'https://example.com/image.png');
});
test('unsupported executable URI schemes cannot become links', () => {
  for (const uri of ['javascript:alert(1)', 'file:///etc/passwd', 'chrome://settings']) assert.throws(() => resolveUri(uri, DWEB));
  assert.equal(imageDataUri('data:text/html,<script>alert(1)</script>'), false);
  assert.equal(imageDataUri('data:image/svg+xml,<svg/>'), true);
});
test('ERC-1155 substitutes every ID placeholder with padded lowercase hex', () => {
  const hex = 'ab'.padStart(64, '0');
  assert.equal(substituteId('ipfs://cid/{id}/{id}.json', 171n), `ipfs://cid/${hex}/${hex}.json`);
});
test('embedded JSON supports percent and base64 encoding with Unicode', () => {
  const object = { name: 'Café 🌱', image: 'data:image/svg+xml,<svg/>' };
  const json = JSON.stringify(object);
  assert.deepEqual(readDataJson(`data:application/json;charset=utf-8,${encodeURIComponent(json)}`), object);
  assert.deepEqual(readDataJson(`data:application/json;base64,${Buffer.from(json).toString('base64')}`), object);
  assert.throws(() => readDataJson('data:application/json;base64,%%%%'));
  assert.throws(() => readDataJson('data:text/html,<script/>'));
});
test('metadata must be a bounded JSON object', () => {
  for (const raw of ['<html>error</html>', 'null', '[]', 'true']) assert.throws(() => parseMetadata(raw));
  assert.throws(() => parseMetadata(JSON.stringify({ text: 'a'.repeat(2 * 1024 * 1024) })));
  assert.deepEqual(parseMetadata('{}'), {});
});
test('metadata nesting is bounded before rendering or caching', () => {
  const nested = (depth: number) => '{"items":' + '['.repeat(depth) + '0' + ']'.repeat(depth) + '}';
  assert.doesNotThrow(() => parseMetadata(nested(63)));
  for (const depth of [64, 300, 10_000]) assert.throws(() => parseMetadata(nested(depth)), /nesting limit/);
  assert.throws(() => readDataJson('data:application/json,' + encodeURIComponent(nested(300))), /nesting limit/);
});
test('large nested metadata uses compact JSON without amplifying display memory', () => {
  const text = '{"items":' + '['.repeat(60) + Array(100_000).fill('0').join(',') + ']'.repeat(60) + '}';
  const data = parseMetadata(text);
  const formatted = formatMetadata(data);
  assert.equal(formatted, text);
  assert.ok(formatted.length < MAX_METADATA);
  assert.deepEqual(JSON.parse(formatted), data);
  assert.equal(formatMetadata({ name: 'Artwork', attributes: [{ value: 1 }] }), JSON.stringify({ name: 'Artwork', attributes: [{ value: 1 }] }, null, 2));
});
test('settings validate endpoints and gateway mode', () => {
  assert.equal(settings(DWEB).gatewayStyle, 'subdomain');
  assert.throws(() => settings({ ...DWEB, rpcUrl: 'javascript:alert(1)' }));
  assert.throws(() => settings({ ...DWEB, gatewayUrl: 'https://dweb.link/ipfs/' }));
  assert.throws(() => settings({ ...DWEB, gatewayUrl: 'http://127.0.0.1:8080' }));
  assert.equal(settings({ ...DWEB, gatewayUrl: 'http://127.0.0.1:8080', gatewayStyle: 'path' }).gatewayUrl, 'http://127.0.0.1:8080');
});
test('starting another lookup aborts the old request and invalidates its callbacks', () => {
  const requests = new LatestRequest();
  const first = requests.begin(); const second = requests.begin();
  assert.equal(first.current(), false); assert.equal(first.signal.aborted, true);
  assert.equal(second.current(), true);
  requests.cancel(); assert.equal(second.current(), false);
});

test('remote endpoints require HTTPS and HTTP accepts only literal loopback hosts', () => {
  assert.equal(httpUrl('https://example.org/meta').href, 'https://example.org/meta');
  for (const host of ['localhost', '127.0.0.1']) {
    assert.equal(httpUrl(`http://${host}:8080/meta`).hostname, host);
    assert.equal(settings({ ...DEFAULTS, rpcUrl: `http://${host}:8545`, gatewayUrl: `http://${host}:8080`, gatewayStyle: 'path' }).gatewayUrl, `http://${host}:8080`);
    assert.equal(resolveUri(`http://${host}:8080/meta`, DEFAULTS), `http://${host}:8080/meta`);
  }
  for (const url of ['http://[::1]', 'http://example.org', 'http://localhost.example', 'http://localhost.', 'http://127.1', 'http://127.0.0.2', 'http://2130706433', 'http://0x7f000001', 'http://%6cocalhost', 'http://[0:0:0:0:0:0:0:1]', 'http://localhost@remote.example', 'http://user:pass@localhost', 'https://user:pass@example.org', 'http://localhost\\@remote.example']) {
    assert.throws(() => httpUrl(url), /HTTPS/);
    assert.throws(() => settings({ ...DEFAULTS, rpcUrl: url }), /HTTPS/);
    assert.throws(() => resolveUri(url, DEFAULTS), /HTTPS/);
  }
  assert.throws(() => resolveUri('http://example.org/ipfs/' + cid, DEFAULTS), /HTTPS/);
  assert.throws(() => resolveUri('image.svg', DEFAULTS, 'http://example.org/meta.json'), /HTTPS/);
});
