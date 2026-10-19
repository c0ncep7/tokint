import { readFile, readdir, lstat, mkdir, mkdtemp, writeFile, rename, rm } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { zip } from './zip.mjs';
import { storeEntries } from './store-package.mjs';

process.chdir(fileURLToPath(new URL('..', import.meta.url)));
await import('./build.mjs');
const { version } = JSON.parse(await readFile('package.json', 'utf8'));
if (!/^\d+\.\d+\.\d+(?:-[a-zA-Z0-9.-]+)?$/.test(version)) throw new Error('Invalid release version.');

async function files(path, prefix = '') {
  const entry = await lstat(path);
  if (entry.isSymbolicLink()) throw new Error(`Symlinks are not allowed in release archives: ${path}`);
  if (entry.isFile()) return [{ name: `${prefix}${path}`, data: await readFile(path) }];
  if (!entry.isDirectory()) throw new Error(`Unsupported release file: ${path}`);
  const result = [];
  for (const name of (await readdir(path)).sort()) {
    if (name === '.DS_Store') continue;
    result.push(...await files(`${path}/${name}`, prefix));
  }
  return result;
}

// Explicit source roots exclude local configuration, profiles and node_modules.
const sourceRoots = ['src', 'public', 'scripts', 'tests', 'vendor', 'docs', 'package.json', 'package-lock.json', 'tsconfig.json', '.gitignore', 'README.md', 'VERIFICATION.md', 'DISTRIBUTION.md', 'PRIVACY.md'];
for (const name of await readdir('.')) if (/^(LICENSE|LICENCE|COPYING)(\.[A-Za-z0-9_-]+)?$/i.test(name)) sourceRoots.push(name);
const sources = [];
for (const root of sourceRoots) sources.push(...await files(root, `tokint-${version}-source/`));
sources.push({ name: `tokint-${version}-source/THIRD_PARTY_NOTICES.txt`, data: await readFile('extension/THIRD_PARTY_NOTICES.txt') });
await mkdir('releases', { recursive: true });
const staging = await mkdtemp(`releases/.${version}-`);
try {
  const checksums = [];
  const extensionEntries = await files('extension');
  const archives = [
    [`tokint-${version}.zip`, extensionEntries],
    [`tokint-${version}-chrome-web-store.zip`, storeEntries(extensionEntries, version)],
    [`tokint-${version}-source.zip`, sources],
  ];
  for (const [name, entries] of archives) {
    const bytes = zip(entries);
    await writeFile(`${staging}/${name}`, bytes);
    checksums.push(`${createHash('sha256').update(bytes).digest('hex')}  ${name}`);
    console.log(`${name}: ${(bytes.length / 1024).toFixed(1)} KiB`);
  }
  for (const name of ['bundle-report.json', 'DISTRIBUTION.md', 'LICENSE', 'PRIVACY.md', 'docs/WEB_STORE.md']) {
    const bytes = await readFile(name);
    const outputName = name.split('/').at(-1);
    await writeFile(`${staging}/${outputName}`, bytes);
    checksums.push(`${createHash('sha256').update(bytes).digest('hex')}  ${outputName}`);
  }
  await writeFile(`${staging}/SHA256SUMS.txt`, checksums.join('\n') + '\n');
  await rm(`releases/${version}`, { recursive: true, force: true });
  await rename(staging, `releases/${version}`);
  console.log(`Release artifacts: releases/${version}/`);
  console.log(`Chrome Web Store upload: releases/${version}/tokint-${version}-chrome-web-store.zip`);
  console.log('Publish the matching source archive alongside the binary downloads; see DISTRIBUTION.md.');
} finally { await rm(staging, { recursive: true, force: true }); }
