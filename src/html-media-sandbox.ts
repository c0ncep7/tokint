// Compiled as a standalone classic script and executed only in a manifest
// sandbox. Keep this bootstrap self-contained: it is inserted before the art.
function artworkBridge(manual: boolean, clickBeforeRecording: boolean) {
  const send = parent.postMessage.bind(parent);
  const listen = window.addEventListener.bind(window);
  const nativeFrame = window.requestAnimationFrame.bind(window);
  const nativeTimeout = window.setTimeout.bind(window);
  const nativeNow = performance.now.bind(performance);
  const epoch = Date.now();
  let startupError = '';
  let started = false;
  listen('error', event => {
    if (started) return;
    startupError = event instanceof ErrorEvent && event.message
      ? `HTML artwork could not start: ${event.message.slice(0, 200)}`
      : 'HTML artwork could not load a required resource. Use Open selected media to view it in your browser.';
    event.preventDefault();
  }, true);
  listen('unhandledrejection', event => {
    if (started) return;
    startupError = 'HTML artwork could not start. Use Open selected media to view it in your browser.';
    event.preventDefault();
  });
  let time = 0, captureStart = 0, nextId = 0, stepped = false;
  let output: OffscreenCanvas | undefined;
  const frames = new Map<number, FrameRequestCallback>();
  const timers = new Map<number, { callback: () => void; at: number; interval: number }>();
  const report = (id: number, data: object, transfer: Transferable[] = []) => send({ channel: 'tokint-html', id, ...data }, '*', transfer);
  // Sampling drives the same clock in a fresh export frame, so encoder speed
  // cannot skip artwork frames or change the requested clip duration.
  Object.defineProperty(performance, 'now', { value: () => time });
  Date.now = () => epoch + time;
  window.requestAnimationFrame = callback => { const id = ++nextId; frames.set(id, callback); return id; };
  window.cancelAnimationFrame = id => { frames.delete(id); };
  function timer(callback: TimerHandler, delay = 0, interval = false, args: unknown[] = []) {
    if (typeof callback !== 'function') return 0;
    const id = ++nextId;
    timers.set(id, { callback: () => callback(...args), at: time + Math.max(0, Number(delay) || 0), interval: interval ? Math.max(1, Number(delay) || 1) : 0 });
    return id;
  }
  window.setTimeout = ((callback: TimerHandler, delay?: number, ...args: unknown[]) => timer(callback, delay, false, args)) as typeof window.setTimeout;
  window.setInterval = ((callback: TimerHandler, delay?: number, ...args: unknown[]) => timer(callback, delay, true, args)) as typeof window.setInterval;
  window.clearTimeout = window.clearInterval = id => { if (typeof id === 'number') timers.delete(id); };
  function step(target: number) {
    if (stepped && target <= time) return;
    stepped = true;
    time = target;
    for (const [id, item] of [...timers]) {
      if (item.at > time || !timers.has(id)) continue;
      if (item.interval) item.at = time + item.interval; else timers.delete(id);
      item.callback();
    }
    const callbacks = [...frames]; frames.clear();
    for (const [, callback] of callbacks) callback(time);
  }
  function canvas() {
    return Array.from(document.querySelectorAll('canvas')).filter(c => c.width > 0 && c.height > 0).sort((a, b) => b.width * b.height - a.width * a.height)[0];
  }
  listen('message', event => {
    const data = event.data;
    if (event.source !== parent || data?.channel !== 'tokint-html' || data.kind !== 'frame' || !Number.isInteger(data.id)) return;
    try {
      const target = data.milliseconds + captureStart;
      if (!manual || !Number.isFinite(data.milliseconds) || data.milliseconds < 0 || target < time || data.milliseconds > 60_000 || ![data.width, data.height].every(v => Number.isInteger(v) && v > 0 && v <= 2000) || !['#000000', '#ffffff'].includes(data.background)) throw new Error('Invalid HTML frame request.');
      while (time + 1000 / 60 < target) step(time + 1000 / 60);
      step(target);
      for (const animation of document.getAnimations()) { animation.pause(); animation.currentTime = time; }
      const source = canvas();
      if (!source || source.width * source.height > 32_000_000) throw new Error('HTML conversion requires a canvas within 32 megapixels.');
      if (!output || output.width !== data.width || output.height !== data.height) output = new OffscreenCanvas(data.width, data.height);
      const ctx = output.getContext('2d', { willReadFrequently: true })!;
      // Honor pixel-art scaling, including small on-chain canvases. Smoothing
      // invents gradients, changes the artwork, and greatly increases GIF cost.
      ctx.imageSmoothingEnabled = !['pixelated', 'crisp-edges'].includes(getComputedStyle(source).imageRendering);
      ctx.fillStyle = data.background; ctx.fillRect(0, 0, output.width, output.height);
      ctx.drawImage(source, 0, 0, output.width, output.height);
      const pixels = ctx.getImageData(0, 0, output.width, output.height).data;
      report(data.id, { pixels: pixels.buffer }, [pixels.buffer]);
    } catch (error) { report(data.id, { error: error instanceof Error ? error.message : 'HTML frame capture failed.' }); }
  });
  listen('load', () => {
    nativeTimeout(() => {
      try {
        if (startupError) throw new Error(startupError);
        step(0);
        // Libraries such as p5 defer their first draw until the next frame.
        // Start recording after that draw, keeping the requested clip duration.
        if (manual) { step(1000 / 60); captureStart = time; }
        if (startupError) throw new Error(startupError);
        const source = canvas();
        if (manual && clickBeforeRecording && source) {
          const rect = source.getBoundingClientRect();
          source.dispatchEvent(new MouseEvent('click', {
            bubbles: true, cancelable: true, view: window,
            clientX: rect.left + rect.width / 2, clientY: rect.top + rect.height / 2, button: 0,
          }));
          if (startupError) throw new Error(startupError);
        }
        started = true;
        report(0, { width: source?.width || innerWidth || 512, height: source?.height || innerHeight || 512, capture: !!source });
        if (!manual) {
          let previous = nativeNow();
          const tick = () => {
            const now = nativeNow(); step(time + Math.min(100, now - previous)); previous = now; nativeFrame(tick);
          };
          nativeFrame(tick);
        }
      } catch (error) { report(0, { error: error instanceof Error ? error.message : 'HTML animation could not start.' }); }
    }, 0);
  }, { once: true });
}
window.addEventListener('message', function initialize(event) {
  const data = event.data;
  if (event.source !== parent || data?.channel !== 'tokint-html' || data.kind !== 'load' || typeof data.html !== 'string' || data.html.length > 2 * 1024 * 1024) return;
  window.removeEventListener('message', initialize);
  const fail = (error: unknown) => parent.postMessage({ channel: 'tokint-html', id: 0, error: error instanceof Error ? error.message : 'HTML artwork could not be prepared.' }, '*');
  try {
    // Parse only inside the network-isolated sandbox, never in the extension DOM.
    // The parent fetches only allowlisted, hash-pinned dependencies as bytes.
    // No artwork executes until dependency preparation has completed.
    const parsed = new DOMParser().parseFromString(data.html, 'text/html');
    const scripts = Array.from(parsed.querySelectorAll('script[src]'));
    if (scripts.length > 8) throw new Error('HTML artwork exceeds the external script limit. Open the source in your browser.');
    function render(sources: Record<string, string>) {
      // A newly opened dialog can load its iframe before layout gives it a
      // viewport. Responsive artworks otherwise permanently create a 0x0 canvas.
      if (!innerWidth || !innerHeight) {
        setTimeout(() => { try { render(sources); } catch (error) { fail(error); } }, 16);
        return;
      }
      for (const script of scripts) {
        const source = sources[script.getAttribute('src')!];
        if (typeof source !== 'string' || source.length > 1024 * 1024) throw new Error('HTML artwork dependency was not supplied.');
        script.removeAttribute('src'); script.removeAttribute('crossorigin'); script.removeAttribute('integrity');
        script.textContent = source.replace(/<\/script/gi, '<\\/script');
      }
      const html = parsed.documentElement.outerHTML;
      document.open();
      document.write('<!doctype html><meta charset="utf-8"><script>(' + artworkBridge.toString() + ')(' + String(data.manual === true) + ',' + String(data.clickBeforeRecording === true) + ');<\/script>' + html);
      document.close();
    }
    if (!scripts.length) { render({}); return; }
    const urls = [...new Set(scripts.map(script => script.getAttribute('src')))];
    window.addEventListener('message', function dependencies(event) {
      if (event.source !== parent || event.data?.channel !== 'tokint-html' || event.data.kind !== 'dependencies') return;
      window.removeEventListener('message', dependencies);
      try { render(event.data.sources); } catch (error) { fail(error); }
    });
    parent.postMessage({ channel: 'tokint-html', id: 0, kind: 'dependencies', urls }, '*');
  } catch (error) { fail(error); }
});
