import { readFile, readdir, lstat, mkdir, mkdtemp, writeFile, rename, rm } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { zip } from './zip.mjs';

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
const sourceRoots = ['src', 'public', 'companion', 'scripts', 'tests', 'vendor', 'docs', 'package.json', 'package-lock.json', 'tsconfig.json', '.gitignore', 'README.md', 'VERIFICATION.md', 'DISTRIBUTION.md'];
for (const name of await readdir('.')) if (/^(LICENSE|LICENCE|COPYING)(\.[A-Za-z0-9_-]+)?$/i.test(name)) sourceRoots.push(name);
const sources = [];
for (const root of sourceRoots) sources.push(...await files(root, `tokint-${version}-source/`));
await mkdir('releases', { recursive: true });
const staging = await mkdtemp(`releases/.${version}-`);
try {
  const checksums = [];
  const archives = [
    [`tokint-${version}.zip`, await files('extension')],
    [`tokint-${version}-ipfs-shortcut.zip`, await files('ipfs-extension')],
    [`tokint-${version}-source.zip`, sources],
  ];
  for (const [name, entries] of archives) {
    const bytes = zip(entries);
    await writeFile(`${staging}/${name}`, bytes);
    checksums.push(`${createHash('sha256').update(bytes).digest('hex')}  ${name}`);
    console.log(`${name}: ${(bytes.length / 1024).toFixed(1)} KiB`);
  }
  for (const name of ['bundle-report.json', 'DISTRIBUTION.md']) {
    const bytes = await readFile(name);
    await writeFile(`${staging}/${name}`, bytes);
    checksums.push(`${createHash('sha256').update(bytes).digest('hex')}  ${name}`);
  }
  await writeFile(`${staging}/SHA256SUMS.txt`, checksums.join('\n') + '\n');
  await rm(`releases/${version}`, { recursive: true, force: true });
  await rename(staging, `releases/${version}`);
  console.log(`Release artifacts: releases/${version}/ (local packaging only; see DISTRIBUTION.md)`);
} finally { await rm(staging, { recursive: true, force: true }); }
