import { test } from 'node:test';
import assert from 'node:assert/strict';
import { inflateRawSync } from 'node:zlib';
import { storeEntries } from '../scripts/store-package.mjs';
import { zip } from '../scripts/zip.mjs';

function extension() {
  const manifest = {
    manifest_version: 3, version: '1.0.0',
    background: { service_worker: 'background.js' },
    action: { default_popup: 'launcher.html', default_icon: { 16: 'icons/16.png' } },
    options_ui: { page: 'options.html' }, icons: { 128: 'icons/128.png' },
    sandbox: { pages: ['html-media.html'] },
  };
  return Object.entries({
    'manifest.json': JSON.stringify(manifest),
    'background.js': '/* bundled service worker */', 'launcher.html': '<html></html>',
    'options.html': '<html></html>', 'html-media.html': '<html></html>',
    'icons/16.png': 'icon', 'icons/128.png': 'icon',
    LICENSE: 'GPL-2.0-only', 'PRIVACY.md': 'Privacy', 'privacy.html': '<html>Privacy</html>', 'DISTRIBUTION.md': 'Distribution',
    'THIRD_PARTY_NOTICES.txt': 'Notices',
  }).map(([name, data]) => ({ name: `extension/${name}`, data: Buffer.from(data) }));
}

// Read the ZIP directory independently and inflate each referenced local entry.
function unzip(bytes) {
  const end = bytes.length - 22;
  assert.equal(bytes.readUInt32LE(end), 0x06054b50);
  const count = bytes.readUInt16LE(end + 10);
  let directory = bytes.readUInt32LE(end + 16);
  const entries = new Map();
  for (let i = 0; i < count; i++) {
    assert.equal(bytes.readUInt32LE(directory), 0x02014b50);
    const nameLength = bytes.readUInt16LE(directory + 28);
    const name = bytes.subarray(directory + 46, directory + 46 + nameLength).toString('utf8');
    const local = bytes.readUInt32LE(directory + 42);
    assert.equal(bytes.readUInt32LE(local), 0x04034b50);
    assert.equal(bytes.readUInt16LE(local + 8), 8);
    const start = local + 30 + bytes.readUInt16LE(local + 26) + bytes.readUInt16LE(local + 28);
    const compressedSize = bytes.readUInt32LE(directory + 20);
    const data = inflateRawSync(bytes.subarray(start, start + compressedSize));
    assert.equal(data.length, bytes.readUInt32LE(directory + 24));
    entries.set(name, data);
    directory += 46 + nameLength + bytes.readUInt16LE(directory + 30) + bytes.readUInt16LE(directory + 32);
  }
  assert.equal(directory, end);
  return entries;
}

test('store ZIP has a root manifest and all original payloads; manual ZIP keeps its folder', () => {
  const input = extension();
  const store = unzip(zip(storeEntries(input, '1.0.0')));
  const manual = unzip(zip(input));
  assert.equal(JSON.parse(store.get('manifest.json').toString()).version, '1.0.0');
  assert.ok(manual.has('extension/manifest.json'));
  assert.ok(!manual.has('manifest.json'));
  assert.equal(store.size, input.length);
  for (const { name, data } of input) assert.deepEqual(store.get(name.slice('extension/'.length)), data);
});

test('store packaging rejects missing legal documents and manifest entry points', () => {
  for (const name of ['manifest.json', 'LICENSE', 'PRIVACY.md', 'privacy.html', 'THIRD_PARTY_NOTICES.txt', 'background.js', 'options.html', 'launcher.html', 'html-media.html', 'icons/128.png']) {
    assert.throws(() => storeEntries(extension().filter(entry => entry.name !== `extension/${name}`), '1.0.0'), /manifest.json|Missing store package file/);
  }
});

test('store packaging rejects incorrect roots, versions and manifest versions', () => {
  assert.throws(() => storeEntries([{ name: 'manifest.json', data: Buffer.from('{}') }], '1.0.0'), /Unexpected extension file/);
  assert.throws(() => storeEntries(extension(), '2.0.0'), /release version/);
  const input = extension();
  input[0].data = Buffer.from(JSON.stringify({ manifest_version: 2, version: '1.0.0' }));
  assert.throws(() => storeEntries(input, '1.0.0'), /Manifest V3/);
  for (const version of ['1.0.0-beta', '01.0.0', '65536.0.0', '0.0.0', '1.2.3.4.5']) {
    input[0].data = Buffer.from(JSON.stringify({ manifest_version: 3, version }));
    assert.throws(() => storeEntries(input, version), /valid Chrome manifest version/);
  }
});

test('ZIP bytes are reproducible regardless of input ordering', () => {
  assert.deepEqual(zip(extension()), zip(extension().reverse()));
});

test('ZIP rejects duplicate and unsafe archive paths', () => {
  for (const name of ['', '/absolute', '../parent', 'dir/../parent', 'dir//file', 'dir/./file', 'dir\\file', 'file\0']) {
    assert.throws(() => zip([{ name, data: Buffer.from('x') }]), /Invalid archive path/);
  }
  assert.throws(() => zip([extension()[0], extension()[0]]), /Invalid archive path/);
});
