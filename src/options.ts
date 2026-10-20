import { setBusy } from './loading';
import { RPC_PRESETS, rpcPreset, validateAlchemyRpc } from './rpc-presets';
import { DEFAULTS, GATEWAYS, settings, type Settings } from './core';
import { getSettingsState, saveSettings } from './storage';
const rpc = document.querySelector<HTMLInputElement>('#rpc-url')!;
const rpcSelect = document.querySelector<HTMLSelectElement>('#rpc-preset')!;
const rpcNote = document.querySelector<HTMLElement>('#rpc-note')!;
const rememberRpc = document.querySelector<HTMLInputElement>('#remember-rpc')!;
const rememberControl = document.querySelector<HTMLElement>('#rpc-remember-control')!;
const alchemyHelp = document.querySelector<HTMLElement>('#alchemy-help')!;
for (const item of RPC_PRESETS) rpcSelect.add(new Option(item.name, item.id));
rpcSelect.add(new Option('Alchemy (optional)', 'alchemy'));
rpcSelect.add(new Option('Custom RPC…', 'custom'));
let alchemyUrl = '';
function updateRpc(changed = false) {
  const selected = RPC_PRESETS.find(item => item.id === rpcSelect.value);
  rpc.disabled = !!selected;
  rememberControl.hidden = !!selected;
  if (selected || changed) rememberRpc.checked = false;
  alchemyHelp.hidden = rpcSelect.value !== 'alchemy';
  if (selected) rpc.value = selected.url;
  else if (changed && rpcSelect.value === 'alchemy') rpc.value = alchemyUrl;
  rpc.placeholder = rpcSelect.value === 'alchemy' ? 'https://eth-mainnet.g.alchemy.com/v2/…' : 'https://…';
  rpcNote.textContent = selected?.note ?? (rpcSelect.value === 'alchemy' ? 'Optional personal endpoint. Requires an Alchemy account.' : 'Enter an Ethereum mainnet HTTPS RPC endpoint. HTTP is supported only for localhost or 127.0.0.1.');
}
rpc.addEventListener('input', () => { rememberRpc.checked = false; if (rpcSelect.value === 'alchemy') alchemyUrl = rpc.value; });
rpcSelect.addEventListener('change', () => updateRpc(true));
const gateway = document.querySelector<HTMLInputElement>('#gateway-url')!;
const style = document.querySelector<HTMLSelectElement>('#gateway-style')!;
const status = document.querySelector<HTMLElement>('#settings-status')!;
const preset = document.querySelector<HTMLSelectElement>('#gateway-preset')!;
const note = document.querySelector<HTMLElement>('#gateway-note')!;
for (const item of GATEWAYS) preset.add(new Option(item.name, item.id));
preset.add(new Option('Custom gateway…', 'custom'));
function updatePreset() {
  const selected = GATEWAYS.find(item => item.id === preset.value);
  gateway.disabled = style.disabled = !!selected;
  if (selected) { gateway.value = selected.gatewayUrl; style.value = selected.gatewayStyle; }
  note.textContent = selected?.note ?? 'Enter your gateway base URL and choose the URL style it supports.';
}
function show(value: Settings, remember = false, provider = rpcPreset(value.rpcUrl)) {
  rpc.value = value.rpcUrl; rpcSelect.value = provider; rememberRpc.checked = remember;
  if (rpcSelect.value === 'alchemy') alchemyUrl = value.rpcUrl;
  updateRpc(); gateway.value = value.gatewayUrl; style.value = value.gatewayStyle;
  preset.value = GATEWAYS.find(item => item.gatewayUrl === value.gatewayUrl && item.gatewayStyle === value.gatewayStyle)?.id ?? 'custom';
  updatePreset();
}
preset.addEventListener('change', updatePreset);
getSettingsState().then(state => {
  show(state.value, state.rememberRpc, state.provider);
  if (state.sessionExpired) status.textContent = 'Your session-only RPC URL has expired. Enter it again, or select a public provider and save.';
}).catch(e => { show(DEFAULTS); status.textContent = e.message; }).finally(() => document.querySelector<HTMLElement>('.shell')!.inert = false);
document.querySelector('#settings-form')!.addEventListener('submit', event => {
  event.preventDefault();
  void (async () => {
    try {
      if (rpcSelect.value === 'alchemy') validateAlchemyRpc(rpc.value.trim());
      const value = settings({ rpcUrl: rpc.value, gatewayUrl: gateway.value, gatewayStyle: style.value as Settings['gatewayStyle'] });
      setBusy(status, true); status.textContent = 'Saving…';
      await saveSettings(value, rememberRpc.checked);
      const state = await getSettingsState();
      show(state.value, state.rememberRpc, state.provider);
      status.textContent = `Saved. ${!rememberControl.hidden ? (state.rememberRpc ? 'RPC URL remembered on this device without encryption. ' : 'RPC URL kept only for this browser session. ') : ''}The next lookup will use these settings. New hosts will ask for access when needed.`;
    } catch (e) { status.textContent = e instanceof Error ? e.message : 'Could not save settings.'; } finally { setBusy(status, false); }
  })();
});
document.querySelector('#defaults')!.addEventListener('click', () => { show(DEFAULTS); status.textContent = 'Defaults filled in. Click Save settings to apply.'; });
