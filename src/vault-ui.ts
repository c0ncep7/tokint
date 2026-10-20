import { migrateTokenCache } from './token-cache';
import { lockVault, migratePreferences, openVault, SESSION_KEY, vaultHeader, vaultIsUnlocked } from './vault';

export async function ensureVault(): Promise<void> {
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'session' && changes[SESSION_KEY]?.oldValue && !changes[SESSION_KEY].newValue) location.reload();
  });
  if (await vaultIsUnlocked()) return;
  const existing = !!await vaultHeader();
  const dialog = document.createElement('dialog');
  dialog.id = 'vault-dialog'; dialog.className = 'vault-dialog';
  dialog.setAttribute('aria-labelledby', 'vault-title');
  dialog.innerHTML = `<form id="vault-form">
    <h1 id="vault-title">${existing ? 'Unlock TOKINT' : 'Protect your saved data'}</h1>
    <p>${existing ? 'Enter your passphrase to unlock this Chrome session.' : 'Choose a passphrase to encrypt your settings, recent tokens, and cached artwork on this device.'}</p>
    <label>Passphrase<input id="vault-passphrase" type="password" minlength="12" maxlength="1024" required autocomplete="${existing ? 'current-password' : 'new-password'}"></label>
    ${existing ? '' : '<label>Confirm passphrase<input id="vault-confirm" type="password" minlength="12" maxlength="1024" required autocomplete="new-password"></label>'}
    <p class="field-help">Use at least 12 characters. Your passphrase is never saved or sent to a server. There is no recovery: if you forget it, remove and reinstall TOKINT to reset its saved data.</p>
    <button class="primary" type="submit">${existing ? 'Unlock' : 'Create encrypted vault'}</button>
    <p id="vault-status" role="status" aria-live="polite"></p>
  </form>`;
  document.body.append(dialog);
  dialog.addEventListener('cancel', event => event.preventDefault());
  dialog.showModal();
  await new Promise<void>(resolve => {
    dialog.querySelector('form')!.addEventListener('submit', event => {
      event.preventDefault();
      const input = dialog.querySelector<HTMLInputElement>('#vault-passphrase')!;
      const confirm = dialog.querySelector<HTMLInputElement>('#vault-confirm');
      const status = dialog.querySelector<HTMLElement>('#vault-status')!;
      const button = dialog.querySelector<HTMLButtonElement>('button')!;
      if (confirm && input.value !== confirm.value) { status.textContent = 'The passphrases do not match.'; return; }
      button.disabled = true; status.textContent = 'Securing saved data…';
      const passphrase = input.value;
      input.value = ''; if (confirm) confirm.value = '';
      void openVault(passphrase, async keys => {
        await migratePreferences(keys);
        await migrateTokenCache(keys);
      }).then(() => {
        dialog.close(); dialog.remove();
        window.dispatchEvent(new Event('tokint-vault-unlocked'));
        resolve();
      }).catch(error => {
        status.textContent = error instanceof Error ? error.message : 'Could not unlock saved data.';
        button.disabled = false; input.focus();
      });
    });
  });
}
export function addLockButton() {
  document.getElementById('lock-vault')?.addEventListener('click', () => { void lockVault(); });
}
