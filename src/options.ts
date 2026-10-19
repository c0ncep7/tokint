import { setBusy } from './loading';
import { RPC_PRESETS, rpcPreset, validateAlchemyRpc } from './rpc-presets';
import { DEFAULTS, GATEWAYS, settings, type Settings } from './core';
import { getSettings, saveSettings } from './storage';
const rpc = document.querySelector<HTMLInputElement>('#rpc-url')!;
const rpcSelect = document.querySelector<HTMLSelectElement>('#rpc-preset')!;
const rpcNote = document.querySelector<HTMLElement>('#rpc-note')!;
const alchemyHelp = document.querySelector<HTMLElement>('#alchemy-help')!;
for (const item of RPC_PRESETS) rpcSelect.add(new Option(item.name, item.id));
rpcSelect.add(new Option('Alchemy (optional)', 'alchemy'));
rpcSelect.add(new Option('Custom RPC…', 'custom'));
let alchemyUrl = '';
function updateRpc(changed = false) {
  const selected = RPC_PRESETS.find(item => item.id === rpcSelect.value);
  rpc.disabled = !!selected;
  alchemyHelp.hidden = rpcSelect.value !== 'alchemy';
  if (selected) rpc.value = selected.url;
  else if (changed && rpcSelect.value === 'alchemy') rpc.value = alchemyUrl;
  rpc.placeholder = rpcSelect.value === 'alchemy' ? 'https://eth-mainnet.g.alchemy.com/v2/…' : 'https://…';
  rpcNote.textContent = selected?.note ?? (rpcSelect.value === 'alchemy' ? 'Optional personal endpoint. Requires an Alchemy account.' : 'Enter an Ethereum mainnet HTTPS RPC endpoint. HTTP is supported only for localhost or 127.0.0.1.');
}
rpc.addEventListener('input', () => { if (rpcSelect.value === 'alchemy') alchemyUrl = rpc.value; });
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
function show(value: Settings) {
  rpc.value = value.rpcUrl; rpcSelect.value = rpcPreset(value.rpcUrl);
  if (rpcSelect.value === 'alchemy') alchemyUrl = value.rpcUrl;
  updateRpc(); gateway.value = value.gatewayUrl; style.value = value.gatewayStyle;
  preset.value = GATEWAYS.find(item => item.gatewayUrl === value.gatewayUrl && item.gatewayStyle === value.gatewayStyle)?.id ?? 'custom';
  updatePreset();
}
preset.addEventListener('change', updatePreset);
getSettings().then(show).catch(e => { show(DEFAULTS); status.textContent = e.message; });
document.querySelector('#settings-form')!.addEventListener('submit', event => {
  event.preventDefault();
  void (async () => {
    try {
      if (rpcSelect.value === 'alchemy') validateAlchemyRpc(rpc.value.trim());
      const value = settings({ rpcUrl: rpc.value, gatewayUrl: gateway.value, gatewayStyle: style.value as Settings['gatewayStyle'] });
      setBusy(status, true); status.textContent = 'Saving…';
      await saveSettings(value);
      show(value);
      status.textContent = 'Saved. The next lookup will use these settings. New hosts will ask for access when needed.';
    } catch (e) { status.textContent = e instanceof Error ? e.message : 'Could not save settings.'; } finally { setBusy(status, false); }
  })();
});
document.querySelector('#defaults')!.addEventListener('click', () => { show(DEFAULTS); status.textContent = 'Defaults filled in. Click Save settings to apply.'; });
