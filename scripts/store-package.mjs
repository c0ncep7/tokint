// Convert the unpacked-install archive into the manifest-at-root Web Store format.
// Check the manifest's local entry points before producing an upload artifact.
export function storeEntries(extensionEntries, version) {
  const entries = extensionEntries.map(({ name, data }) => {
    if (!name.startsWith('extension/')) throw new Error(`Unexpected extension file: ${name}`);
    return { name: name.slice('extension/'.length), data };
  });
  const files = new Map(entries.map(entry => [entry.name, entry.data]));
  if (!files.has('manifest.json')) throw new Error('The store package must contain manifest.json at its root.');
  const manifest = JSON.parse(files.get('manifest.json').toString('utf8'));
  if (manifest.manifest_version !== 3 || manifest.version !== version) throw new Error('The store manifest must use Manifest V3 and match the release version.');
  // Chrome versions are bounded integers, not arbitrary npm semver strings.
  const parts = version.split('.');
  if (parts.length > 4 || parts.some(part => !/^(0|[1-9]\d*)$/.test(part) || Number(part) > 65535) || parts.every(part => Number(part) === 0)) {
    throw new Error('The release version must be a valid Chrome manifest version.');
  }
  const required = [
    'LICENSE', 'PRIVACY.md', 'privacy.html', 'DISTRIBUTION.md', 'THIRD_PARTY_NOTICES.txt',
    manifest.background?.service_worker,
    manifest.action?.default_popup,
    manifest.options_ui?.page,
    ...Object.values(manifest.icons ?? {}),
    ...Object.values(manifest.action?.default_icon ?? {}),
    ...(manifest.sandbox?.pages ?? []),
  ].filter(Boolean);
  for (const name of required) {
    if (!files.has(name)) throw new Error(`Missing store package file: ${name}`);
  }
  return entries;
}
