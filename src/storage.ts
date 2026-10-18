import { DEFAULTS, settings, type Settings } from './core';
const SETTINGS_VERSION = 2;
export function restoreSettings(saved?: Partial<Settings>, version?: number): Settings {
  const value = settings({ ...DEFAULTS, ...saved });
  // v1 did not distinguish its default from an explicitly saved dweb setting.
  // Migrate that old pair once; preserve custom gateways and the user's RPC.
  if (version !== SETTINGS_VERSION && value.gatewayUrl === 'https://dweb.link' && value.gatewayStyle === 'subdomain') {
    value.gatewayUrl = DEFAULTS.gatewayUrl;
    value.gatewayStyle = DEFAULTS.gatewayStyle;
  }
  return value;
}
export async function getSettings(): Promise<Settings> {
  const stored = await chrome.storage.local.get(['settings', 'settingsVersion']);
  const value = restoreSettings(stored.settings, stored.settingsVersion);
  if (stored.settings && stored.settingsVersion !== SETTINGS_VERSION) await saveSettings(value);
  return value;
}
export async function saveSettings(value: Settings) { await chrome.storage.local.set({ settings: settings(value), settingsVersion: SETTINGS_VERSION }); }
export async function getLastContract(): Promise<string> { return (await chrome.storage.local.get('lastContract')).lastContract ?? ''; }
export async function saveLastContract(value: string) { await chrome.storage.local.set({ lastContract: value }); }
