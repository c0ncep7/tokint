import { setBusy } from './loading';
import type { ConversionCapabilities } from './conversion-capabilities-worker';
import { createHtmlMedia, type HtmlMedia, type HtmlArtworkConsent } from './html-media';
import { downloadName, embeddedMediaBlob, mediaExtension } from './downloads';
import { prepareSvg, svgPixels, svgExportSize, staticSvgResult, type SvgPlan } from './svg';
import { Failure } from './core';
import { loadMedia } from './network';
import { SHARE_SOURCE_LIMIT, SHARE_TIMEOUT, animationFrameTime, assertExportDimensions, sizeLabel, targetBytes, validateOptions, type ShareMessage, type ShareOptions } from './share-core';

type Source = { url: string; contract: string; id: bigint; title: string; blob?: Blob; width?: number; height?: number; frames?: number; decoderType?: string; inspectionError?: string; svg?: SvgPlan; html?: boolean };
export function createShareModal() {
  const el = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
  const open = el<HTMLButtonElement>('share-media');
  const dialog = el<HTMLDialogElement>('share-modal');
  const form = el<HTMLFormElement>('share-form');
  const generate = el<HTMLButtonElement>('share-generate');
  const cancel = el<HTMLButtonElement>('share-cancel');
  const progress = el<HTMLProgressElement>('share-progress');
  const status = el('share-status');
  const capabilityStatus = el('share-capabilities');
  const original = el('share-original');
  const preview = el<HTMLImageElement>('share-preview');
  const download = el<HTMLAnchorElement>('share-download');
  const edge = el<HTMLSelectElement>('share-edge');
  const customEdge = el<HTMLInputElement>('share-custom-edge');
  const format = el<HTMLSelectElement>('share-format');
  const fps = el<HTMLSelectElement>('share-fps');
  const svgDuration = el<HTMLInputElement>('share-svg-duration');
  const htmlClick = el<HTMLInputElement>('share-html-click');
  let source: Source | undefined;
  let htmlConsent: HtmlArtworkConsent | undefined;
  let capabilities: ConversionCapabilities | undefined;
  let capabilityError = '';
  let capabilityCheck: Promise<void> | undefined;
  function checkCapabilities() {
    if (capabilityCheck) return capabilityCheck;
    capabilityCheck = new Promise<void>(resolve => {
      let checker: Worker | undefined;
      const timer = setTimeout(() => finish('Browser conversion checks timed out. Reload this tab to retry.'), 10_000);
      function finish(error = '') {
        clearTimeout(timer); checker?.terminate(); capabilityError = error;
        updateControls(); resolve();
      }
      try {
        checker = new Worker(chrome.runtime.getURL('conversion-capabilities-worker.js'), { type: 'module' });
        checker.onmessage = (event: MessageEvent<ConversionCapabilities>) => { capabilities = event.data; finish(); };
        checker.onerror = () => finish('This browser cannot start the image converter.');
        checker.postMessage(null);
      } catch { finish('This browser cannot start the image converter.'); }
    });
    return capabilityCheck;
  }
  let originalUrl: string | undefined;
  let originalBlob: Blob | undefined;
  let originalController: AbortController | undefined;
  let originalPermission: string | undefined;
  const originalDownload = el<HTMLAnchorElement>('download-media');
  const fetchOriginal = el<HTMLButtonElement>('fetch-original-media');
  const originalStatus = el('original-status');
  async function originalReady(current: Source, blob: Blob) {
    const extension = await mediaExtension(blob, current.url);
    if (source !== current || originalBlob === blob) return;
    if (originalUrl) URL.revokeObjectURL(originalUrl);
    originalBlob = blob; originalUrl = URL.createObjectURL(blob);
    originalDownload.href = originalUrl;
    originalDownload.download = downloadName(current.contract, current.id, 'media', extension);
    originalDownload.hidden = false; fetchOriginal.hidden = true;
  }
  fetchOriginal.addEventListener('click', () => {
    const current = source;
    if (!current || originalController) return;
    const grant = originalPermission ? chrome.permissions.request({ origins: [originalPermission] }) : Promise.resolve(true);
    const controller = originalController = new AbortController();
    fetchOriginal.disabled = true; setBusy(originalStatus, true); originalStatus.textContent = 'Downloading original…';
    const active = () => source === current && originalController === controller && dialog.open;
    void (async () => {
      if (!await grant) throw new Error('Host access was not granted.');
      if (!active()) return;
      const blob = current.blob ?? (current.url.startsWith('data:') ? embeddedMediaBlob(current.url) : await loadMedia(current.url, { signal: controller.signal }));
      if (!active()) return;
      current.blob = blob;
      await originalReady(current, blob);
      if (!active()) return;
      originalPermission = undefined; originalStatus.textContent = '';
      sourceLabel(); void inspectSource(); originalDownload.click();
    })().catch(error => {
      if (!active()) return;
      if (error instanceof Failure && error.kind === 'permission') originalPermission = error.origin;
      originalStatus.textContent = error instanceof Error ? error.message : 'Could not download original.';
      fetchOriginal.querySelector('span')!.textContent = originalPermission ? 'Allow and download original' : 'Retry original download';
    }).finally(() => {
      if (originalController === controller) { originalController = undefined; fetchOriginal.disabled = false; setBusy(originalStatus, false); }
    });
  });
  let htmlExport: HtmlMedia | undefined;
  let htmlHost: HTMLElement | undefined;
  let worker: Worker | undefined;
  let probe: Worker | undefined;
  let probeSequence = 0;
  let preparingProbe = false;
  let probeTimeout: ReturnType<typeof setTimeout> | undefined;
  let controller: AbortController | undefined;
  let timeout: ReturnType<typeof setTimeout> | undefined;
  let outputUrl: string | undefined;
  let generation = 0;
  let permissionOrigin: string | undefined;
  function message(text: string, warning = false) { status.textContent = text; status.dataset.warning = String(warning); }
  function clearOutput() {
    preview.hidden = true; preview.removeAttribute('src');
    download.hidden = true; download.removeAttribute('href'); download.removeAttribute('download');
    el('share-output').textContent = '';
    el('share-preview-stage').hidden = true;
    if (outputUrl) URL.revokeObjectURL(outputUrl);
    outputUrl = undefined;
  }
  function stop() {
    htmlExport?.dispose(); htmlExport = undefined; htmlHost?.remove(); htmlHost = undefined;
    stopProbe();
    generation++; worker?.terminate(); worker = undefined;
    controller?.abort(); controller = undefined;
    if (timeout) clearTimeout(timeout);
    timeout = undefined;
    generate.disabled = false; cancel.hidden = true; progress.hidden = true;
    generate.textContent = permissionOrigin ? 'Allow and convert' : 'Convert';
    form.removeAttribute('aria-busy');
    updateControls();
  }
  function cleanup() {
    originalController?.abort(); originalController = undefined; fetchOriginal.disabled = false; setBusy(originalStatus, false);
    stop(); clearOutput();
    if (!open.hidden) open.focus();
  }
  function dismiss() { if (dialog.open) dialog.close(); cleanup(); }
  function updateControls() {
    form.hidden = !source; original.hidden = !source; fetchOriginal.hidden = !source || !!originalUrl;
    customEdge.disabled = edge.value !== 'custom';
    el('share-custom-edge-label').hidden = customEdge.disabled;
    const animated = (source?.frames ?? 0) > 1;
    el('share-animation-controls').hidden = !animated;
    fps.disabled = !animated;
    format.disabled = !animated;
    el('share-format-label').hidden = !animated;
    svgDuration.disabled = !source?.svg?.animated && !source?.html;
    el('share-svg-duration-label').hidden = svgDuration.disabled;
    htmlClick.disabled = !source?.html;
    el('share-html-click-control').hidden = htmlClick.disabled;
    fps.options[0].textContent = source?.svg || source?.html ? '20 fps' : 'Original';
    const gif = !!capabilities?.canvas && !!capabilities?.wasm;
    const webp = !!capabilities?.canvas && !!capabilities?.webp;
    for (const option of format.options) option.disabled = option.value === 'gif' ? !gif : !webp;
    if (format.selectedOptions[0]?.disabled) {
      const supported = Array.from(format.options).find(option => !option.disabled);
      if (supported) format.value = supported.value;
    }
    let unavailable = capabilityError;
    if (!unavailable && !capabilities) unavailable = 'Checking browser conversion support…';
    else if (!unavailable && !capabilities?.canvas) unavailable = 'Image conversion is unavailable in this browser.';
    else if (!unavailable && source?.decoderType && !capabilities?.decoders[source.decoderType]) unavailable = 'This browser cannot decode this image for conversion.';
    else if (!unavailable && animated && !gif && !webp) unavailable = 'Animated image export is unavailable in this browser.';
    else if (!unavailable && !animated && !capabilities?.jpeg) unavailable = 'JPEG export is unavailable in this browser.';
    capabilityStatus.textContent = unavailable
      ? `${unavailable}${capabilities || capabilityError ? ' Original download is still available.' : ''}`
      : animated && (!gif || !webp) ? `${gif ? 'WebP export' : 'GIF optimization'} is unavailable in this browser. ${gif ? 'GIF' : 'WebP'} is selected.` : '';
    const needsConsent = !!source?.html && (!htmlConsent || htmlConsent.blob !== source.blob || htmlConsent.signal.aborted);
    el('share-html-consent-note').hidden = !needsConsent;
    generate.disabled = needsConsent || !!unavailable || form.getAttribute('aria-busy') === 'true';
  }
  function stopProbe() {
    setBusy(original, false);
    probeSequence++; preparingProbe = false;
    probe?.terminate(); probe = undefined;
    if (probeTimeout) clearTimeout(probeTimeout);
    probeTimeout = undefined;
  }
  async function inspectSource() {
    const current = source;
    if (!dialog.open || !current?.blob || current.frames !== undefined || current.inspectionError || probe || preparingProbe || worker) return;
    // Inspect cached bytes in a worker without fetching or decoding any frames.
    // Keep controls hidden until the decoder confirms multiple frames.
    const sequence = ++probeSequence; preparingProbe = true; setBusy(original, true);
    const active = () => sequence === probeSequence && source === current && dialog.open;
    try {
      const extension = await mediaExtension(current.blob, current.url);
      if (!active()) return;
      current.decoderType = ({ jpg: 'image/jpeg', png: 'image/png', gif: 'image/gif', webp: 'image/webp' } as Record<string, string>)[extension];
      updateControls();
      if (extension === 'html') {
        current.html = true; current.frames = 2; svgDuration.value = '3';
        sourceLabel(); updateControls(); stopProbe(); return;
      }
      if (extension === 'svg') {
        const plan = await prepareSvg(current.blob);
        if (!active()) return;
        current.svg = plan; current.frames = plan.animated ? 2 : 1;
        svgDuration.value = String(plan.duration || 3);
        sourceLabel(); updateControls(); stopProbe(); return;
      }
      preparingProbe = false;
      probe = new Worker(chrome.runtime.getURL('share-worker.js'), { type: 'module' });
      const inspection = probe;
      probeTimeout = setTimeout(stopProbe, 10_000);
      probe.onerror = () => { if (probe === inspection) stopProbe(); };
      probe.onmessage = (event: MessageEvent<ShareMessage>) => {
        if (probe !== inspection) return;
        if (source !== current || !dialog.open) { stopProbe(); return; }
        if (event.data.kind === 'info') {
          current.frames = event.data.info.frames; current.width = event.data.info.width; current.height = event.data.info.height;
          sourceLabel(); updateControls(); stopProbe();
        } else if (event.data.kind === 'error') {
          current.inspectionError = event.data.message;
          message(event.data.message, true); stopProbe();
        }
      };
      probe.postMessage({ blob: current.blob });
    } catch (error) {
      if (!active()) return;
      current.inspectionError = error instanceof Error ? error.message : 'Could not inspect this image.';
      message(current.inspectionError, true); stopProbe();
    }
  }
  function sourceLabel() {
    const width = source?.svg?.width ?? source?.width;
    const height = source?.svg?.height ?? source?.height;
    original.textContent = source?.blob ? `${width && height ? `${width} × ${height} · ` : ''}${sizeLabel(source.blob.size)} original` : '';
  }

  open.addEventListener('click', () => {
    if (!source || dialog.open) return;
    clearOutput(); sourceLabel(); updateControls();
    message(source?.inspectionError ?? '', !!source?.inspectionError); originalStatus.textContent = '';
    dialog.showModal();
    void checkCapabilities();
    el('close-share-modal').focus();
    void inspectSource();
  });
  el('close-share-modal').addEventListener('click', dismiss);
  dialog.addEventListener('cancel', event => { event.preventDefault(); dismiss(); });
  dialog.addEventListener('close', () => { if (!dialog.open) cleanup(); });
  dialog.addEventListener('click', event => {
    if (event.target !== dialog) return;
    const rect = dialog.getBoundingClientRect();
    if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) dismiss();
  });
  form.addEventListener('input', () => {
    stop(); clearOutput(); updateControls(); message(source?.inspectionError ?? '', !!source?.inspectionError); void inspectSource();
  });
  cancel.addEventListener('click', () => { stop(); clearOutput(); message('Cancelled.'); });
  form.addEventListener('submit', event => {
    event.preventDefault();
    if (!source || generate.disabled) return;
    // Preserve the user gesture for optional host permission requests.
    const grant = permissionOrigin ? chrome.permissions.request({ origins: [permissionOrigin] }) : Promise.resolve(true);
    stop(); clearOutput();
    const run = generation;
    const current = source;
    const clickBeforeRecording = htmlClick.checked;
    const options: ShareOptions = {
      target: 'web', maxEdge: Number(edge.value === 'custom' ? customEdge.value : edge.value),
      format: format.value as ShareOptions['format'],
      maxMB: 15, fps: (current.frames ?? 0) > 1 ? Number(fps.value) : 0,
      background: el<HTMLSelectElement>('share-background').value as ShareOptions['background'],
    };
    try { validateOptions(options); } catch (error) { message((error as Error).message, true); return; }
    controller = new AbortController(); const signal = controller.signal;
    generate.disabled = true; cancel.hidden = false; progress.hidden = false; progress.value = 0;
    form.setAttribute('aria-busy', 'true');
    message('Preparing original…');
    const active = () => generation === run && source === current && dialog.open;
    const fail = (error: unknown) => {
      if (!active()) return;
      if (error instanceof Failure && error.kind === 'permission') permissionOrigin = error.origin;
      stop(); clearOutput();
      message(error instanceof Error ? error.message : 'Conversion failed. Try smaller dimensions.', true);
    };
    timeout = setTimeout(() => fail(new Error('Conversion exceeded two minutes. Try smaller dimensions or a lower frame rate.')), SHARE_TIMEOUT);
    void (async () => {
      if (!await grant) throw new Error('Host access was not granted. The original source link remains available.');
      if (!active()) return;
      permissionOrigin = undefined;
      const blob = current.blob ?? (current.url.startsWith('data:') ? embeddedMediaBlob(current.url) : await loadMedia(current.url, { signal, timeoutMs: 60_000 }, SHARE_SOURCE_LIMIT));
      if (!active()) return;
      if (blob.size > SHARE_SOURCE_LIMIT) throw new Error('Original exceeds the 100 MiB conversion limit. Use a dedicated editor.');
      current.blob = blob; void originalReady(current, blob); sourceLabel();
      const extension = await mediaExtension(blob, current.url);
      if (!active()) return;
      const svg = extension === 'svg' ? current.svg ?? await prepareSvg(blob) : undefined;
      if (!active()) return;
      if (svg) {
        if (!current.svg) svgDuration.value = String(svg.duration || 3);
        current.svg = svg; current.frames = svg.animated ? 2 : 1;
        options.fps = svg.animated ? Number(fps.value) : 0;
        updateControls();
      }
      let html: HtmlMedia | undefined;
      if (extension === 'html') {
        current.html = true; current.frames = 2;
        htmlHost = document.createElement('div'); htmlHost.className = 'html-export-stage'; document.body.append(htmlHost);
        html = await createHtmlMedia(blob, htmlHost, signal, htmlConsent, true, clickBeforeRecording);
        if (!active()) { html.dispose(); return; }
        htmlExport = html;
        if (!html.capture) throw new Error('This HTML artwork has no canvas to export. The original HTML download is available.');
        current.width = html.width; current.height = html.height; options.fps = Number(fps.value);
        sourceLabel(); updateControls();
      }
      const complete = (result: import('./share-core').ShareResult) => {
        if (!active()) return;
        try { assertExportDimensions(result, { width: current.svg?.width ?? current.width ?? NaN, height: current.svg?.height ?? current.height ?? NaN }, options.maxEdge, extension === 'svg' || extension === 'html'); }
        catch (error) { fail(error); return; }
        if (result.width > options.maxEdge || result.height > options.maxEdge || result.blob.size > targetBytes(options, result.frames > 1)) { fail(new Error('Export exceeded the selected limits. Choose smaller dimensions and retry.')); return; }
        stop();
        outputUrl = URL.createObjectURL(result.blob);
        preview.src = outputUrl; preview.hidden = false;
        el('share-preview-stage').hidden = false;
        download.href = outputUrl; download.download = downloadName(current.contract, current.id, 'web', result.extension, current.title); download.hidden = false;
        el('share-output').textContent = `${result.width} × ${result.height} · ${sizeLabel(result.blob.size)} · ${result.extension.toUpperCase()}${result.frames > 1 ? ` · ${result.frames} frames · ${(result.duration / 1000).toFixed(2)} s` : ''}`;
        
        message('');
      };
      if (svg && !svg.animated) { complete(await staticSvgResult(svg, options, signal)); return; }
      if (svg || html) {
        const plan = svg ?? { width: html!.width, height: html!.height, animated: true };
        // Preserve the requested timeline on every pass. Compression comes
        // first; only then reduce the maximum edge, with an explicit note.
        const seconds = Number(svgDuration.value);
        const originalSize = svgExportSize(plan, options, seconds);
        const baseEdge = Math.max(originalSize.width, originalSize.height);
        const attempts = options.format === 'webp'
          ? [{ edge: baseEdge, quality: 0.9 }, { edge: baseEdge, quality: 0.65 }, { edge: baseEdge, quality: 0.4 }, { edge: Math.floor(baseEdge * 0.8), quality: 0.65 }, { edge: Math.floor(baseEdge * 0.64), quality: 0.65 }, { edge: Math.floor(baseEdge * 0.5), quality: 0.65 }, { edge: Math.floor(baseEdge * 0.4), quality: 0.65 }]
          : [1, 0.8, 0.64, 0.5].map(scale => ({ edge: Math.max(1, Math.floor(baseEdge * scale)), quality: 0.9 }));
        if (timeout) clearTimeout(timeout);
        timeout = setTimeout(() => fail(new Error(`Animation conversion exceeded five minutes (${status.textContent}). Try smaller dimensions or a shorter clip.`)), 300_000);
        const encode = async (pass: number) => {
          if (!active()) return;
          if (html && pass) {
            html.dispose();
            html = await createHtmlMedia(blob, htmlHost!, signal, htmlConsent, true, clickBeforeRecording);
            if (!active()) { html.dispose(); return; }
            htmlExport = html;
          }
          const settings = attempts[pass];
          const size = svgExportSize(plan, { ...options, maxEdge: Math.max(1, settings.edge) }, seconds);
          worker?.terminate();
          worker = new Worker(chrome.runtime.getURL('svg-worker.js'), { type: 'module' });
          const encoder = worker;
          encoder.onerror = () => fail(new Error('The animation encoder stopped unexpectedly. Try smaller dimensions.'));
          encoder.onmessage = (event: MessageEvent<ShareMessage | { kind: 'frame'; index: number }>) => {
            if (!active() || worker !== encoder) return;
            const data = event.data;
            if (data.kind === 'error') {
              if (data.code === 'size' && pass + 1 < attempts.length) {
                const next = attempts[pass + 1];
                if (options.format !== 'webp' || pass >= 2) next.edge = Math.min(next.edge, Math.max(1, Math.max(size.width, size.height) - 1), Math.max(1, data.suggestedEdge ?? next.edge));
                void encode(pass + 1).catch(fail); return;
              }
              fail(new Error(data.message));
            } else if (data.kind === 'progress') {
              progress.value = data.value; message(`${data.text} · ${size.width} × ${size.height}${pass ? ` · fit attempt ${pass + 1}` : ''}`);
            } else if (data.kind === 'done') {
              if (size.width < originalSize.width || size.height < originalSize.height) data.result.notes.unshift(`Dimensions reduced from ${originalSize.width} × ${originalSize.height} to fit 15 MB. Frame rate and clip length retained.`);
              complete(data.result);
            } else if (data.kind === 'frame') {
              const milliseconds = animationFrameTime(data.index, size.frames, size.duration, options.format);
              void (html ? html.pixels(milliseconds, size.width, size.height, options.background)
                : svgPixels(svg!, milliseconds / 1000, size.width, size.height, options.background, signal)).then(pixels => {
                if (active() && worker === encoder) encoder.postMessage({ kind: 'frame', index: data.index, pixels: pixels.data }, [pixels.data.buffer]);
              }).catch(fail);
            }
          };
          encoder.postMessage({ kind: 'start', label: html ? 'HTML' : 'SVG', ...size, format: options.format, quality: settings.quality, limit: targetBytes(options, true) });
        };
        void encode(0).catch(fail);
        return;
      }
      worker = new Worker(chrome.runtime.getURL('share-worker.js'), { type: 'module' });
      worker.onerror = () => fail(new Error('The image converter could not start or stopped unexpectedly. Reload the extension and retry.'));
      worker.onmessage = (event: MessageEvent<ShareMessage>) => {
        if (!active()) return;
        const data = event.data;
        if (data.kind === 'error') { fail(new Error(data.message)); return; }
        if (data.kind === 'info') {
          current.frames = data.info.frames; current.width = data.info.width; current.height = data.info.height;
          sourceLabel(); updateControls();
        } else if (data.kind === 'progress') { progress.value = data.value; message(data.text); }
        else if (data.kind === 'done') complete(data.result);
      };
      worker.postMessage({ blob, options });
    })().catch(fail);
  });
  return {
    setHtmlConsent(consent: HtmlArtworkConsent | undefined) {
      const wasAllowed = !!htmlConsent; htmlConsent = consent;
      if (!consent && wasAllowed) dismiss();
      updateControls();
    },
    setSource(url: string, identity: { contract: string; id: bigint; title: string }) {
      source = { url, ...identity }; htmlClick.checked = false; permissionOrigin = undefined; open.hidden = false; updateControls();
    },
    setBlob(url: string, blob: Blob, width?: number, height?: number) {
      if (source?.url === url) { source.blob = blob; void originalReady(source, blob); source.width = width; source.height = height; if (dialog.open) { sourceLabel(); updateControls(); } void inspectSource(); }
    },
    reset() {
      htmlConsent = undefined;
      source = undefined; permissionOrigin = originalPermission = undefined; open.hidden = true; dismiss();
      if (originalUrl) URL.revokeObjectURL(originalUrl);
      originalUrl = undefined; originalBlob = undefined;
      originalDownload.hidden = true; originalDownload.removeAttribute('href'); originalDownload.removeAttribute('download');
      originalStatus.textContent = ''; fetchOriginal.querySelector('span')!.textContent = 'Original';
    },
  };
}
