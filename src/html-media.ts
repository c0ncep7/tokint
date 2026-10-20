import { loadHtmlDependencies } from './html-dependencies';

export type HtmlMedia = {
  width: number; height: number; capture: boolean;
  pixels(milliseconds: number, width: number, height: number, background: string): Promise<ImageData>;
  dispose(): void;
};

export async function createHtmlMedia(blob: Blob, host: HTMLElement, signal: AbortSignal, manual = false, clickBeforeRecording = false): Promise<HtmlMedia> {
  if (blob.size > 2 * 1024 * 1024) throw new Error('HTML artwork exceeds the 2 MiB preview limit.');
  const html = await blob.text();
  signal.throwIfAborted();
  const element = document.createElement('iframe');
  element.className = 'html-media'; element.title = 'Token HTML animation';
  element.setAttribute('sandbox', 'allow-scripts');
  element.referrerPolicy = 'no-referrer';
  // This packaged page has a unique sandbox origin, no extension APIs, and no
  // network, frames, forms or popup access. Artwork never enters our page DOM.
  element.src = chrome.runtime.getURL('html-media.html');
  let disposed = false, sequence = 0, dependenciesRequested = false;
  const dependencies = new AbortController();
  type Pending = { resolve: (value: any) => void; reject: (error: Error) => void; timer: ReturnType<typeof setTimeout> };
  const pending = new Map<number, Pending>();
  function dispose() {
    if (disposed) return;
    disposed = true; dependencies.abort(); window.removeEventListener('message', receive); signal.removeEventListener('abort', dispose); element.remove();
    for (const item of pending.values()) { clearTimeout(item.timer); item.reject(new DOMException('Media cancelled', 'AbortError')); }
    pending.clear();
  }
  function receive(event: MessageEvent) {
    if (disposed || event.source !== element.contentWindow || event.origin !== 'null') return;
    const data = event.data;
    if (!data || data.channel !== 'tokint-html' || !Number.isInteger(data.id)) return;
    const item = pending.get(data.id);
    if (!item) return;
    if (data.id === 0 && data.kind === 'dependencies') {
      if (dependenciesRequested) return;
      dependenciesRequested = true;
      void loadHtmlDependencies(data.urls, { signal: dependencies.signal }).then(sources => {
        if (!disposed && pending.has(0)) element.contentWindow?.postMessage({ channel: 'tokint-html', kind: 'dependencies', sources }, '*');
      }).catch(error => {
        if (disposed || !pending.has(0)) return;
        pending.delete(0); clearTimeout(item.timer); item.reject(error);
      });
      return;
    }
    pending.delete(data.id); clearTimeout(item.timer);
    if (typeof data.error === 'string') item.reject(new Error(data.error.slice(0, 300)));
    else item.resolve(data);
  }
  function request(id: number, data?: object): Promise<any> {
    return new Promise((resolve, reject) => {
      if (disposed) { reject(new DOMException('Media cancelled', 'AbortError')); return; }
      pending.set(id, { resolve, reject, timer: setTimeout(() => {
        pending.delete(id); reject(new Error('HTML artwork did not respond. Try reloading the media.'));
      }, id === 0 ? 45_000 : 15_000) });
      if (data) element.contentWindow?.postMessage({ channel: 'tokint-html', id, ...data }, '*');
    });
  }
  window.addEventListener('message', receive); signal.addEventListener('abort', dispose, { once: true });
  const ready = request(0);
  element.onload = () => { element.onload = null; element.contentWindow?.postMessage({ channel: 'tokint-html', kind: 'load', html, manual, clickBeforeRecording }, '*'); };
  host.append(element);
  try {
    const info = await ready;
    if (![info.width, info.height].every(v => Number.isInteger(v) && v > 0 && v <= 32768) || info.width * info.height > 32_000_000) throw new Error('HTML canvas dimensions exceed the preview limit.');
    return {
      width: info.width, height: info.height, capture: info.capture === true, dispose,
      async pixels(milliseconds, width, height, background) {
        if (![width, height].every(v => Number.isInteger(v) && v >= 1 && v <= 2000)) throw new Error('Invalid HTML export dimensions.');
        const result = await request(++sequence, { kind: 'frame', milliseconds, width, height, background });
        if (!(result.pixels instanceof ArrayBuffer) || result.pixels.byteLength !== width * height * 4) throw new Error('HTML artwork returned an invalid frame.');
        return new ImageData(new Uint8ClampedArray(result.pixels), width, height);
      },
    };
  } catch (error) { dispose(); throw error; }
}
