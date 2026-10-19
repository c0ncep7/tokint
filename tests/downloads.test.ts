import { test } from 'node:test';
import assert from 'node:assert/strict';
import { downloadName, embeddedMediaBlob, mediaExtension } from '../src/downloads';

const contract = '0x00000000000000000000000000000000000000AB';
test('download names use the complete contract and lossless decimal token ID', () => {
  assert.equal(downloadName(contract, 900719925474099312345n, 'media', 'png'), '0x00000000000000000000000000000000000000ab--900719925474099312345--media.png');
  assert.equal(downloadName(contract, 0n, 'media', 'svg'), '0x00000000000000000000000000000000000000ab--0--media.svg');
  assert.throws(() => downloadName(contract, 1n, 'media', '../../html'));
});
test('base64 and percent-encoded SVG downloads preserve the original bytes', async () => {
  const svg = '<svg xmlns="http://www.w3.org/2000/svg"><text>Café 🌱</text></svg>';
  for (const uri of [`data:image/svg+xml,${encodeURIComponent(svg)}`, `data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`]) {
    const blob = embeddedMediaBlob(uri);
    assert.equal(blob.type, 'image/svg+xml');
    assert.equal(await blob.text(), svg);
    assert.equal(await mediaExtension(blob, uri), 'svg');
  }
});
test('HTML media preserves original base64 bytes and rejects unsupported or broken data', async () => {
  const html = '<!doctype html><canvas width="32" height="32"></canvas><script>requestAnimationFrame(() => {});</script>';
  const uri = `data:text/html;base64,${Buffer.from(html).toString('base64')}`;
  const blob = embeddedMediaBlob(uri);
  assert.equal(blob.type, 'text/html');
  assert.equal(await blob.text(), html);
  assert.equal(await mediaExtension(blob, uri), 'html');
  assert.throws(() => embeddedMediaBlob('data:image/png;base64,%%%%'));
  assert.throws(() => embeddedMediaBlob('data:text/javascript;base64,YWxlcnQoMSk='));
  assert.throws(() => embeddedMediaBlob('data:text/html;base64,%%%%'));
});
test('file signatures identify extensionless media even with a generic MIME type', async () => {
  const fixtures: [number[] | string, string][] = [
    [[0x89, 0x50, 0x4e, 0x47, 13, 10, 26, 10], 'png'], [[0xff, 0xd8, 0xff, 0xe0], 'jpg'],
    ['GIF89a', 'gif'], ['RIFF1234WEBP', 'webp'], ['1234ftypavif', 'avif'], ['BM', 'bmp'],
    ['<?xml version="1.0"?><svg xmlns="http://www.w3.org/2000/svg"/>', 'svg'],
  ];
  for (const [bytes, expected] of fixtures) {
    const blob = new Blob([typeof bytes === 'string' ? bytes : new Uint8Array(bytes)], { type: 'application/octet-stream' });
    assert.equal(await mediaExtension(blob, 'https://gateway.example/ipfs/cid'), expected);
  }
});
test('extension fallback uses known MIME types or URL paths, never query strings', async () => {
  assert.equal(await mediaExtension(new Blob(['data'], { type: 'image/jpeg' }), 'https://example.com/image'), 'jpg');
  assert.equal(await mediaExtension(new Blob(['data']), 'https://example.com/IMAGE.PNG?file=evil.exe'), 'png');
  assert.equal(await mediaExtension(new Blob(['data']), 'https://example.com/image?file=foo.png'), 'bin');
});
