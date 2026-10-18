import { setBusy } from './loading';
import { toolbarDestination, toolbarPage } from './toolbar';

const status = document.querySelector<HTMLParagraphElement>('#launch-status')!;
const retry = document.querySelector<HTMLButtonElement>('#launch-retry')!;
let opening = false;

async function launch() {
  if (opening) return;
  opening = true;
  retry.hidden = true;
  setBusy(status, true); status.textContent = 'Opening tokint…';
  try {
    // The action popup is not a tab: the source tab remains active while this
    // query runs. Capture it before creating the inspector, without a worker
    // message or an action.onClicked event.
    const [active] = await chrome.tabs.query({ active: true, currentWindow: true });
    const page = active ? await toolbarPage(active, chrome.tabs) : { via: 'unavailable' as const };
    await chrome.tabs.create({ url: chrome.runtime.getURL(toolbarDestination(page)), active: true });
    window.close();
  } catch (error) {
    status.textContent = `Could not open tokint: ${error instanceof Error ? error.message : String(error)}`;
    retry.hidden = false;
  } finally { opening = false; setBusy(status, false); }
}
retry.addEventListener('click', () => { void launch(); });
void launch();
