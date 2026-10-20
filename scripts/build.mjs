import { build } from 'esbuild';
import gifsicle from 'gifsicle-wasm-browser';
import { cp, mkdir, rm, readFile, readdir, writeFile, stat } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';

// Resolve output paths from this script, never an arbitrary caller's directory.
const projectRoot = fileURLToPath(new URL('..', import.meta.url));
process.chdir(projectRoot);
const metafiles = [];
const bundle = async options => {
  const result = await build({ ...options, absWorkingDir: projectRoot, metafile: true });
  metafiles.push(result.metafile);
  return result;
};
const pkg = JSON.parse(await readFile('package.json', 'utf8'));
const lock = JSON.parse(await readFile('package-lock.json', 'utf8'));
for (const file of ['public/manifest.json']) {
  const manifest = JSON.parse(await readFile(file, 'utf8'));
  if (manifest.version !== pkg.version) throw new Error(`Version mismatch: ${file} must match package.json (${pkg.version}).`);
}
if (lock.version !== pkg.version || lock.packages[''].version !== pkg.version) throw new Error('package-lock.json version must match package.json.');
// Package the pinned runtime as a normal module, avoiding blob workers/eval.
let runtime = gifsicle.tool.workerLocalUrl;
const wasm = runtime.match(/data:application\/wasm;base64,([A-Za-z0-9+/=]+)/);
if (!wasm) throw new Error('Missing bundled GIF optimizer WebAssembly.');
runtime = runtime.replace(wasm[0], 'gifsicle.wasm');
const end = runtime.lastIndexOf(';onmessage=');
if (end < 0 || /new Function|eval\(/.test(runtime)) throw new Error('Unexpected GIF optimizer runtime.');
await rm('extension', { recursive: true, force: true });
await mkdir('extension');
await cp('public', 'extension', { recursive: true, filter: source => !source.endsWith('/tokint.svg') && !source.endsWith('/.DS_Store') });
await writeFile('extension/gifsicle.wasm', Buffer.from(wasm[1], 'base64'));
await writeFile('extension/gifsicle-runtime.js', '/* gifsicle-wasm-browser 1.5.19, MIT; see THIRD_PARTY_NOTICES.txt */\n' + runtime.slice(0, end + 1) + '\nexport default gifsicle;\n');
await bundle({ entryPoints: { background: 'src/background.ts', results: 'src/inspector.ts', options: 'src/options.ts', launcher: 'src/launcher.ts', storage: 'src/storage.ts', 'token-cache': 'src/token-cache.ts' }, outdir: 'extension', bundle: true, format: 'esm', splitting: true, target: 'chrome109', minify: true, legalComments: 'eof' });
await bundle({ entryPoints: ['src/theme.ts', 'src/html-media-sandbox.ts'], outdir: 'extension', bundle: true, format: 'iife', target: 'chrome109', minify: true });
await bundle({ entryPoints: ['src/share-worker.ts', 'src/svg-worker.ts', 'src/conversion-capabilities-worker.ts'], external: ['./gifsicle-runtime.js'], outdir: 'extension', bundle: true, format: 'esm', target: 'chrome109', minify: true, legalComments: 'eof' });
let notices = 'tokint — third-party dependency notices\n\nIncludes notices for runtime dependencies. Unused portions may be removed by the bundler.\n';
for (const [folder, entry] of Object.entries(lock.packages)) {
  if (!folder || entry.dev) continue;
  const pkg = JSON.parse(await readFile(`${folder}/package.json`, 'utf8'));
  notices += `\n${'='.repeat(72)}\n${pkg.name} ${pkg.version} — ${pkg.license || 'See license below'}\n`;
  if (pkg.name === 'multiformats') notices += '\nTOKINT distributes multiformats under its MIT license option.\n';
  const files = (await readdir(folder)).filter(name => /^(license|licence|copying)(\.|$)/i.test(name));
  for (const file of files) notices += `\n${await readFile(`${folder}/${file}`, 'utf8')}\n`;
}
notices += '\nGifsicle 1.92 WebAssembly optimizer — GNU GPL v2\nSource and integration notes: vendor/gifsicle/ in the source distribution.\n' + await readFile('vendor/gifsicle/COPYING', 'utf8');
notices += '\nwasm-codecs Gifsicle integration — MIT\n' + await readFile('vendor/gifsicle/WASM_CODECS_LICENSE', 'utf8');
await writeFile('extension/THIRD_PARTY_NOTICES.txt', notices);
for (const file of ['LICENSE', 'PRIVACY.md', 'DISTRIBUTION.md']) await cp(file, `extension/${file}`);
console.log('Ready to load: extension/');

// Remove the obsolete companion from earlier builds when upgrading this checkout.
await rm('ipfs-extension', { recursive: true, force: true });

async function checksums(folder) {
  const lines = [];
  for (const entry of (await readdir(folder, { withFileTypes: true })).sort((a, b) => a.name < b.name ? -1 : a.name > b.name ? 1 : 0)) {
    const file = `${folder}/${entry.name}`;
    if (entry.isDirectory()) lines.push(...await checksums(file));
    else lines.push(`${createHash('sha256').update(await readFile(file)).digest('hex')}  ${file}`);
  }
  return lines;
}
await writeFile('SHA256SUMS.txt', (await checksums('extension')).join('\n') + '\n');
console.log('Updated SHA256SUMS.txt');

async function sizes(folder) {
  const files = [];
  for (const entry of await readdir(folder, { withFileTypes: true })) {
    const file = `${folder}/${entry.name}`;
    if (entry.isDirectory()) files.push(...await sizes(file));
    else files.push({ file, bytes: (await stat(file)).size });
  }
  return files.sort((a, b) => b.bytes - a.bytes || a.file.localeCompare(b.file));
}
const packages = {};
for (const meta of metafiles) for (const output of Object.values(meta.outputs)) {
  for (const [input, contribution] of Object.entries(output.inputs)) {
    const name = input.match(/node_modules\/((?:@[^/]+\/)?[^/]+)/)?.[1] ?? 'project source';
    packages[name] = (packages[name] ?? 0) + contribution.bytesInOutput;
  }
}
const bundles = {};
for (const folder of ['extension']) {
  const files = await sizes(folder);
  bundles[folder] = { bytes: files.reduce((sum, file) => sum + file.bytes, 0), files };
  console.log(`${folder}: ${(bundles[folder].bytes / 1024).toFixed(1)} KiB unpacked (${files.length} files)`);
}
await writeFile('bundle-report.json', JSON.stringify({
  version: pkg.version, bundles,
  // Copied WASM/runtime assets are listed above, not in esbuild's contributions.
  javascriptContributions: Object.fromEntries(Object.entries(packages).sort((a, b) => b[1] - a[1])),
  metafiles,
}, null, 2) + '\n');
console.log('Bundle sizes and dependency contributions: bundle-report.json');
