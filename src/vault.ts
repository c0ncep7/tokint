import { base64, deriveVaultKeys, importVaultKeys, isSealed, sealJson, unbase64, unsealJson, VAULT_ITERATIONS, type Sealed, type VaultHeader, type VaultKeys } from './vault-crypto';

export const SESSION_KEY = 'tokintVaultSession';
export const MIN_PASSPHRASE_LENGTH = 6;
// chrome.storage serializes JSON, so binary ciphertext must be encoded there.
type JsonSealed = Omit<Sealed, 'ciphertext'> & { ciphertext: string };
type StoredHeader = Omit<VaultHeader, 'check'> & { check: JsonSealed };
const pack = (value: Sealed): JsonSealed => ({ ...value, ciphertext: base64(new Uint8Array(value.ciphertext)) });
const unpack = (value: JsonSealed): Sealed => ({ ...value, ciphertext: unbase64(value.ciphertext).buffer });
export class VaultLockedError extends Error {
  constructor() { super('Unlock TOKINT to use your saved data.'); }
}
export async function vaultHeader(): Promise<StoredHeader | undefined> {
  return (await chrome.storage.local.get('vaultHeader')).vaultHeader;
}
export async function vaultKeys(): Promise<VaultKeys> {
  const [header, session] = await Promise.all([vaultHeader(), chrome.storage.session.get(SESSION_KEY)]);
  const saved = session[SESSION_KEY];
  if (!header || !saved || saved.salt !== header.salt) throw new VaultLockedError();
  return importVaultKeys(unbase64(saved.material));
}
export async function vaultIsUnlocked(): Promise<boolean> {
  try { await vaultKeys(); return true; } catch { return false; }
}
export async function lockVault() { await chrome.storage.session.remove(SESSION_KEY); }
export async function openVault(passphrase: string, migrate: (keys: VaultKeys) => Promise<void>) {
  if (passphrase.length < MIN_PASSPHRASE_LENGTH || passphrase.length > 1024 || !passphrase.trim()) {
    throw new Error(`Use a passphrase of ${MIN_PASSPHRASE_LENGTH}–1024 characters.`);
  }
  await navigator.locks.request('tokint-vault-unlock', async () => {
    let header = await vaultHeader();
    if (header && header.version !== 1) throw new Error('Unsupported vault version.');
    const salt = header?.salt ?? base64(crypto.getRandomValues(new Uint8Array(16)));
    const { keys, material } = await deriveVaultKeys(passphrase, salt, header?.iterations);
    try {
      if (header) {
        try {
          if (await unsealJson<string>(keys, 'check', unpack(header.check)) !== 'TOKINT vault v1') throw new Error();
        } catch { throw new Error('Incorrect passphrase, or saved data is damaged.'); }
      } else {
        header = { version: 1, salt, iterations: VAULT_ITERATIONS, check: pack(await sealJson(keys, 'check', 'TOKINT vault v1')) };
        // Retain a recoverable header if migration fails. A subsequent unlock
        // retries the idempotent migration before publishing the session key.
        await chrome.storage.local.set({ vaultHeader: header });
      }
      await migrate(keys);
      await chrome.storage.session.setAccessLevel({ accessLevel: 'TRUSTED_CONTEXTS' });
      await chrome.storage.session.set({ [SESSION_KEY]: { salt, material: base64(material) } });
    } finally { material.fill(0); }
  });
}
export async function readPrivate<T>(name: string): Promise<T | undefined> {
  const keys = await vaultKeys();
  const value = (await chrome.storage.local.get(name))[name];
  if (value === undefined) return undefined;
  if (!isSealed(value)) throw new Error('Saved data needs migration. Lock and unlock TOKINT to continue.');
  return unsealJson<T>(keys, name, unpack(value as unknown as JsonSealed));
}
export async function writePrivate(name: string, value: unknown) {
  await chrome.storage.local.set({ [name]: pack(await sealJson(await vaultKeys(), name, value)) });
}
export async function migratePreferences(keys: VaultKeys) {
  const names = ['settings', 'lastContract', 'theme'];
  const stored = await chrome.storage.local.get(names);
  const changes: Record<string, JsonSealed> = {};
  for (const name of names) {
    if (stored[name] !== undefined && !isSealed(stored[name])) changes[name] = pack(await sealJson(keys, name, stored[name]));
  }
  if (typeof localStorage !== 'undefined') {
    const theme = localStorage.getItem('tokint-theme');
    if (stored.theme === undefined && (theme === 'dark' || theme === 'light')) changes.theme = pack(await sealJson(keys, 'theme', theme));
  }
  if (Object.keys(changes).length) await chrome.storage.local.set(changes);
  if (typeof localStorage !== 'undefined') {
    for (const name of Object.keys(localStorage)) if (name.endsWith('-theme')) localStorage.removeItem(name);
  }
}
