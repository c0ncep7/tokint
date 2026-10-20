export function createMediaModal(preview: HTMLImageElement) {
  const open = document.querySelector<HTMLButtonElement>('#fullscreen-media')!;
  const dialog = document.querySelector<HTMLDialogElement>('#media-modal')!;
  const image = document.querySelector<HTMLImageElement>('#fullscreen-image')!;
  const title = document.querySelector<HTMLElement>('#media-modal-title')!;
  const close = document.querySelector<HTMLButtonElement>('#close-media-modal')!;
  const htmlStage = document.createElement('div'); htmlStage.className = 'fullscreen-html-stage'; htmlStage.hidden = true;
  document.getElementById('fullscreen-stage')!.append(htmlStage);
  let html: ((host: HTMLElement, signal: AbortSignal) => Promise<{ dispose(): void }>) | undefined;
  let htmlController: AbortController | undefined;

  open.addEventListener('click', () => {
    if (dialog.open || (!html && (preview.hidden || !preview.complete || !preview.naturalWidth))) return;
    image.hidden = !!html;
    htmlStage.hidden = !html;
    if (!html) image.src = preview.currentSrc || preview.src;
    image.alt = preview.alt;
    title.textContent = preview.alt || 'Media';
    dialog.showModal();
    close.focus();
    if (html) {
      const controller = htmlController = new AbortController();
      void html(htmlStage, controller.signal).catch(error => {
        if (!controller.signal.aborted) htmlStage.textContent = error instanceof Error ? error.message : 'HTML preview unavailable.';
      });
    }
  });
  function cleanup() {
    htmlController?.abort(); htmlController = undefined; htmlStage.replaceChildren();
    image.removeAttribute('src');
    if (!open.hidden) open.focus();
  }
  function dismiss() {
    if (dialog.open) dialog.close();
    cleanup();
  }
  close.addEventListener('click', dismiss);
  dialog.addEventListener('click', event => {
    if (event.target === dialog || event.target === document.getElementById('fullscreen-stage')) dismiss();
  });
  // Keep cleanup synchronous on Escape; the native close event is queued.
  dialog.addEventListener('cancel', event => { event.preventDefault(); dismiss(); });
  dialog.addEventListener('close', () => {
    // A queued event from an earlier close must not clear a reopened modal.
    if (!dialog.open) cleanup();
  });
  return {
    ready() { open.hidden = false; },
    setHtml(render: NonNullable<typeof html>) { html = render; open.hidden = false; },
    reset() {
      open.hidden = true;
      dismiss();
      html = undefined;
    },
  };
}
