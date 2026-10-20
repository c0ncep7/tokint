import { readPrivate, writePrivate } from './vault';
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
  const stored = { settings: await readPrivate<Partial<Settings>>('settings'), settingsVersion: (await chrome.storage.local.get('settingsVersion')).settingsVersion };
  const value = restoreSettings(stored.settings, stored.settingsVersion);
  if (stored.settings && stored.settingsVersion !== SETTINGS_VERSION) await saveSettings(value);
  return value;
}
export async function saveSettings(value: Settings) { await writePrivate('settings', settings(value)); await chrome.storage.local.set({ settingsVersion: SETTINGS_VERSION }); }
export async function getLastContract(): Promise<string> { return (await readPrivate<string>('lastContract')) ?? ''; }
export async function saveLastContract(value: string) { await writePrivate('lastContract', value); }
