// Only ciphertext, the salt, and KDF parameters are persisted. Key material is
// derived from the user's passphrase and is never stored with the ciphertext.
export const VAULT_ITERATIONS = 600_000;
export type Sealed = { sealed: 1; iv: string; ciphertext: ArrayBuffer };
export type VaultHeader = { version: 1; salt: string; iterations: number; check: Sealed };
export type VaultKeys = { encryption: CryptoKey; index: CryptoKey };
const utf8 = new TextEncoder();
export function base64(bytes: Uint8Array): string {
  return btoa(Array.from(bytes, byte => String.fromCharCode(byte)).join(''));
}
export function unbase64(text: string): Uint8Array<ArrayBuffer> {
  return Uint8Array.from(atob(text), char => char.charCodeAt(0));
}
export function isSealed(value: unknown): value is Sealed {
  return !!value && typeof value === 'object' && (value as Sealed).sealed === 1;
}
export async function importVaultKeys(material: Uint8Array<ArrayBuffer>): Promise<VaultKeys> {
  if (material.byteLength !== 64) throw new Error('Invalid vault key.');
  return {
    encryption: await crypto.subtle.importKey('raw', material.slice(0, 32), 'AES-GCM', false, ['encrypt', 'decrypt']),
    index: await crypto.subtle.importKey('raw', material.slice(32), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']),
  };
}
export async function deriveVaultKeys(passphrase: string, salt: string, iterations = VAULT_ITERATIONS) {
  if (iterations !== VAULT_ITERATIONS || unbase64(salt).length !== 16) throw new Error('Unsupported vault format.');
  const input = await crypto.subtle.importKey('raw', utf8.encode(passphrase), 'PBKDF2', false, ['deriveBits']);
  const material = new Uint8Array(await crypto.subtle.deriveBits({
    name: 'PBKDF2', hash: 'SHA-256', salt: unbase64(salt), iterations,
  }, input, 512));
  return { material, keys: await importVaultKeys(material) };
}
export async function seal(keys: VaultKeys, purpose: string, bytes: Uint8Array<ArrayBuffer>): Promise<Sealed> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  return {
    sealed: 1, iv: base64(iv),
    ciphertext: await crypto.subtle.encrypt({
      name: 'AES-GCM', iv, additionalData: utf8.encode(`tokint-vault-v1:${purpose}`), tagLength: 128,
    }, keys.encryption, bytes),
  };
}
export async function unseal(keys: VaultKeys, purpose: string, value: Sealed): Promise<Uint8Array<ArrayBuffer>> {
  if (!isSealed(value) || unbase64(value.iv).length !== 12) throw new Error('Invalid encrypted record.');
  return new Uint8Array(await crypto.subtle.decrypt({
    name: 'AES-GCM', iv: unbase64(value.iv), additionalData: utf8.encode(`tokint-vault-v1:${purpose}`), tagLength: 128,
  }, keys.encryption, value.ciphertext));
}
export async function recordId(keys: VaultKeys, value: string): Promise<string> {
  return base64(new Uint8Array(await crypto.subtle.sign('HMAC', keys.index, utf8.encode(value))));
}
export async function sealJson(keys: VaultKeys, purpose: string, value: unknown) {
  return seal(keys, purpose, utf8.encode(JSON.stringify(value)));
}
export async function unsealJson<T>(keys: VaultKeys, purpose: string, value: Sealed): Promise<T> {
  return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(await unseal(keys, purpose, value))) as T;
}
