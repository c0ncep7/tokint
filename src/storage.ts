import { DEFAULTS, Failure, settings, type Settings } from './core';
import { RPC_PRESETS, rpcPreset } from './rpc-presets';

const SETTINGS_VERSION = 2;
export const SESSION_RPC_KEY = 'tokintSessionRpc';
type RpcStorage = { mode: 'public' | 'session' | 'remember'; provider: string; id?: string };
export type SettingsState = { value: Settings; rememberRpc: boolean; sessionExpired: boolean; provider: string };
export function restoreSettings(saved?: Partial<Settings>, version?: number): Settings {
  const value = settings({ ...DEFAULTS, ...saved });
  // v1 did not distinguish its default from an explicitly saved dweb setting.
  if (version !== SETTINGS_VERSION && value.gatewayUrl === 'https://dweb.link' && value.gatewayStyle === 'subdomain') {
    value.gatewayUrl = DEFAULTS.gatewayUrl;
    value.gatewayStyle = DEFAULTS.gatewayStyle;
  }
  return value;
}
async function readSavedSettings() {
  const stored = await chrome.storage.local.get(['settings', 'settingsVersion', 'rpcStorage', 'vaultHeader']);
  if (stored.vaultHeader || stored.settings?.sealed) {
    // The retired encrypted format is discarded, not decrypted or migrated.
    await chrome.storage.session.remove(['tokintVaultSession', SESSION_RPC_KEY]);
    await chrome.storage.local.remove(['vaultHeader', 'settings', 'settingsVersion', 'rpcStorage', 'lastContract', 'theme']);
    return {};
  }
  return stored;
}
async function restrictStorage() {
  await chrome.storage.local.setAccessLevel({ accessLevel: 'TRUSTED_CONTEXTS' });
  await chrome.storage.session.setAccessLevel({ accessLevel: 'TRUSTED_CONTEXTS' });
}
// Caller holds the settings lock. A random ID prevents a stale session endpoint
// from being combined with newer persistent settings after an interrupted save.
async function writeSettings(value: Settings, rememberRpc: boolean) {
  value = settings(value);
  const provider = rpcPreset(value.rpcUrl);
  const publicRpc = RPC_PRESETS.some(item => item.id === provider);
  const rpcStorage: RpcStorage = { mode: publicRpc ? 'public' : rememberRpc ? 'remember' : 'session', provider };
  await restrictStorage();
  const previous = (await chrome.storage.session.get(SESSION_RPC_KEY))[SESSION_RPC_KEY];
  if (rpcStorage.mode === 'session') {
    rpcStorage.id = crypto.randomUUID();
    await chrome.storage.session.set({ [SESSION_RPC_KEY]: { id: rpcStorage.id, rpcUrl: value.rpcUrl } });
  }
  try {
    await chrome.storage.local.set({
      settings: { ...value, rpcUrl: rpcStorage.mode === 'session' ? settings(DEFAULTS).rpcUrl : value.rpcUrl },
      settingsVersion: SETTINGS_VERSION, rpcStorage,
    });
  } catch (error) {
    if (rpcStorage.mode === 'session') {
      if (previous) await chrome.storage.session.set({ [SESSION_RPC_KEY]: previous });
      else await chrome.storage.session.remove(SESSION_RPC_KEY);
    }
    throw error;
  }
  if (rpcStorage.mode !== 'session') await chrome.storage.session.remove(SESSION_RPC_KEY);
  return rpcStorage;
}
export async function getSettingsState(): Promise<SettingsState> {
  return navigator.locks.request('tokint-settings-write', async () => {
    await restrictStorage();
    const stored = await readSavedSettings();
    let value = restoreSettings(stored.settings, stored.settingsVersion);
    let rpcStorage = stored.rpcStorage as RpcStorage | undefined;
    // Pre-vault installs also move custom endpoints into session storage. An old
    // save is not consent to persist a credential under the new storage policy.
    if (!rpcStorage) rpcStorage = await writeSettings(value, false);
    else if (stored.settingsVersion !== SETTINGS_VERSION) {
      await chrome.storage.local.set({ settings: value, settingsVersion: SETTINGS_VERSION });
    }
    let sessionExpired = false;
    if (rpcStorage.mode === 'session') {
      const session = (await chrome.storage.session.get(SESSION_RPC_KEY))[SESSION_RPC_KEY];
      sessionExpired = !session || session.id !== rpcStorage.id;
      value = { ...value, rpcUrl: sessionExpired ? '' : session.rpcUrl };
    }
    return { value, rememberRpc: rpcStorage.mode === 'remember', sessionExpired, provider: rpcStorage.provider };
  });
}
export async function getSettings(): Promise<Settings> {
  const state = await getSettingsState();
  if (state.sessionExpired) throw new Failure('rpc', 'Your session-only RPC URL has expired. Open Settings to enter it again or select a public provider.');
  return state.value;
}
export async function saveSettings(value: Settings, rememberRpc = false): Promise<void> {
  await navigator.locks.request('tokint-settings-write', async () => {
    await readSavedSettings();
    await writeSettings(value, rememberRpc);
  });
}
export async function getLastContract(): Promise<string> {
  const value = (await chrome.storage.local.get('lastContract')).lastContract;
  return typeof value === 'string' ? value : '';
}
export async function saveLastContract(value: string) { await chrome.storage.local.set({ lastContract: value }); }
