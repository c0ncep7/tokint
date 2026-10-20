import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createContext, runInContext } from 'node:vm';
import { buildSync, transformSync } from 'esbuild';

const source = readFileSync(new URL('../src/html-media-sandbox.ts', import.meta.url), 'utf8');
const compiled = transformSync(source, { loader: 'ts', format: 'iife', minify: true, target: 'chrome109' }).code;

function sandbox() {
  const listeners = new Map<string, Array<(event: any) => void>>();
  const messages: any[] = [];
  const tasks: Array<() => void> = [];
  const canvas = {
    width: 32, height: 16, color: 0, imageRendering: 'auto', clicks: 0,
    getBoundingClientRect: () => ({ left: 0, top: 0, width: 32, height: 16 }),
    dispatchEvent(event: { type: string }) { if (event.type === 'click') this.clicks++; return true; },
  };
  const captures: boolean[] = [];
  let allocations = 0;
  let written = '';
  const parent = { postMessage: (message: unknown) => { messages.push(message); } };
  const context = createContext({
    parent, performance: { now: () => 0 }, innerWidth: 512, innerHeight: 512,
    ErrorEvent: class {},
    MouseEvent: class { constructor(public type: string) {} },
    DOMParser: class { parseFromString(html: string) { return { querySelectorAll: () => [], documentElement: { outerHTML: html } }; } },
    addEventListener: (name: string, fn: (event: any) => void) => listeners.set(name, [...listeners.get(name) ?? [], fn]),
    removeEventListener: (name: string, fn: (event: any) => void) => listeners.set(name, (listeners.get(name) ?? []).filter(f => f !== fn)),
    requestAnimationFrame: () => 1,
    getComputedStyle: () => ({ imageRendering: canvas.imageRendering }),
    setTimeout: (fn: () => void) => { tasks.push(fn); return 1; },
    document: {
      open: () => listeners.clear(),
      write: (html: string) => { written = html; runInContext(html.match(/<script>([\s\S]*?)<\/script>/)![1], context); },
      close: () => {},
      querySelectorAll: () => [canvas], getAnimations: () => [],
    },
    OffscreenCanvas: class {
      constructor(public width: number, public height: number) { allocations++; }
      getContext() {
        return { imageSmoothingEnabled: true, fillRect() {}, drawImage() { captures.push(this.imageSmoothingEnabled); }, getImageData: () => ({ data: new Uint8ClampedArray(this.width * this.height * 4).fill(canvas.color) }) };
      }
    },
    canvas,
  });
  runInContext('globalThis.window = globalThis', context);
  runInContext(compiled, context);
  function event(kind: string, data?: object, from = parent) { for (const fn of [...listeners.get(kind) ?? []]) fn({ source: from, data, preventDefault() {} }); }
  return { context, canvas, messages, tasks, event, parent, captures, allocations: () => allocations, written: () => written };
}

test('sandbox bootstrap isolates artwork and the manual clock samples changing frames without duplicate frame zero', () => {
  const app = sandbox();
  app.event('message', { channel: 'tokint-html', kind: 'load', html: '<canvas></canvas>', manual: true });
  assert.ok(app.written().endsWith('<canvas></canvas>'));
  runInContext('globalThis.calls = 0; requestAnimationFrame(function draw(t) { calls++; canvas.color = Math.floor(t / 100); requestAnimationFrame(draw); });', app.context);
  app.event('load'); app.tasks.shift()!();
  assert.equal(app.messages[0].capture, true);
  assert.equal(app.messages[0].width, 32);
  assert.equal(runInContext('calls', app.context), 2);
  const frame = (id: number, milliseconds: number) => app.event('message', { channel: 'tokint-html', kind: 'frame', id, milliseconds, width: 16, height: 8, background: '#000000' });
  frame(1, 0);
  assert.equal(runInContext('calls', app.context), 2);
  frame(2, 200);
  assert.equal(new Uint8Array(app.messages.at(-1).pixels)[0], 2);
  assert.equal(runInContext('performance.now()', app.context), 200 + 1000 / 60);
  assert.equal(app.messages.at(-1).pixels.byteLength, 16 * 8 * 4);
  frame(3, 100);
  assert.match(app.messages.at(-1).error, /Invalid HTML frame/);
});

test('HTML bridge ignores unrelated messages and bounds capture requests', () => {
  const app = sandbox();
  app.event('message', { channel: 'tokint-html', kind: 'load', html: 'ignored', manual: true }, { postMessage() {} });
  assert.equal(app.written(), '');
  app.event('message', { channel: 'tokint-html', kind: 'load', html: '<canvas></canvas>', manual: true });
  app.event('load'); app.tasks.shift()!();
  const count = app.messages.length;
  app.event('message', { channel: 'tokint-html', kind: 'frame', id: 1, milliseconds: 100, width: 10, height: 10, background: '#000000' }, { postMessage() {} });
  assert.equal(app.messages.length, count);
  for (const invalid of [{ width: 2001 }, { height: 2001 }, { milliseconds: 60001 }, { background: 'url(https://example.com)' }]) {
    app.event('message', { channel: 'tokint-html', kind: 'frame', id: 2, milliseconds: 100, width: 10, height: 10, background: '#000000', ...invalid });
    assert.match(app.messages.at(-1).error, /Invalid HTML frame/);
  }
});

test('HTML startup failures are reported instead of presenting a successful blank preview', () => {
  for (const event of ['error', 'unhandledrejection']) {
    const app = sandbox();
    app.event('message', { channel: 'tokint-html', kind: 'load', html: '<canvas></canvas>', manual: true });
    app.event(event);
    app.event('load'); app.tasks.shift()!();
    assert.equal(app.messages[0].id, 0);
    assert.match(app.messages[0].error, /HTML artwork could not/);
    assert.equal(app.messages[0].capture, undefined);
  }
});

test('HTML export clicks once only when requested, with no click during ordinary preview', () => {
  for (const manual of [false, true]) for (const clickBeforeRecording of [false, true]) {
    const app = sandbox();
    app.event('message', { channel: 'tokint-html', kind: 'load', html: '<canvas></canvas>', manual, clickBeforeRecording });
    app.event('load'); app.tasks.shift()!();
    assert.equal(app.canvas.clicks, manual && clickBeforeRecording ? 1 : 0);
    if (manual) {
      for (const milliseconds of [0, 100, 200]) app.event('message', { channel: 'tokint-html', kind: 'frame', id: 1, milliseconds, width: 16, height: 8, background: '#000000' });
      assert.equal(app.canvas.clicks, clickBeforeRecording ? 1 : 0);
    }
  }
});

test('HTML artwork waits for a nonzero iframe viewport before executing', () => {
  const app = sandbox();
  runInContext('innerWidth = 0; innerHeight = 0', app.context);
  app.event('message', { channel: 'tokint-html', kind: 'load', html: '<canvas></canvas>', manual: true });
  assert.equal(app.written(), '');
  runInContext('innerWidth = 640; innerHeight = 480', app.context);
  app.tasks.shift()!();
  assert.ok(app.written().endsWith('<canvas></canvas>'));
  app.event('load'); app.tasks.shift()!();
  assert.equal(app.messages[0].capture, true);
});

test('HTML sandbox captures frames larger than the source canvas up to 2000 px', () => {
  const app = sandbox();
  app.event('message', { channel: 'tokint-html', kind: 'load', html: '<canvas></canvas>', manual: true });
  app.event('load'); app.tasks.shift()!();
  app.event('message', { channel: 'tokint-html', kind: 'frame', id: 1, milliseconds: 0, width: 2000, height: 1000, background: '#000000' });
  assert.equal(app.messages.at(-1).error, undefined);
  assert.equal(app.messages.at(-1).pixels.byteLength, 2000 * 1000 * 4);
});

test('HTML export honors pixel-art scaling and reuses its capture canvas', () => {
  const app = sandbox();
  app.event('message', { channel: 'tokint-html', kind: 'load', html: '<canvas></canvas>', manual: true });
  app.event('load'); app.tasks.shift()!();
  for (const imageRendering of ['pixelated', 'crisp-edges', 'auto']) {
    app.canvas.imageRendering = imageRendering;
    app.event('message', { channel: 'tokint-html', kind: 'frame', id: 1, milliseconds: 0, width: 2000, height: 1000, background: '#000000' });
    assert.equal(app.messages.at(-1).error, undefined);
  }
  assert.deepEqual(app.captures, [false, false, true]);
  assert.equal(app.allocations(), 1);
});

test('HTML media host accepts upscaled frames and rejects either dimension above 2000 px', async () => {
  const listeners = new Set<(event: any) => void>();
  const requests: any[] = [];
  const frameWindow = {
    postMessage(message: any) {
      const data = message.kind === 'load'
        ? { id: 0, width: 32, height: 16, capture: true }
        : { id: message.id, pixels: new ArrayBuffer(message.width * message.height * 4) };
      if (message.kind === 'frame') requests.push(message);
      for (const receive of listeners) receive({ source: frameWindow, origin: 'null', data: { channel: 'tokint-html', ...data } });
    },
  };
  const frame = { contentWindow: frameWindow, onload: null as (() => void) | null, setAttribute() {}, remove() {} };
  const context = createContext({
    input: new Blob(['<canvas width="32" height="16"></canvas>']),
    host: { append: () => frame.onload!() },
    window: {
      addEventListener: (_name: string, fn: (event: any) => void) => listeners.add(fn),
      removeEventListener: (_name: string, fn: (event: any) => void) => listeners.delete(fn),
    },
    document: { createElement: () => frame },
    chrome: { runtime: { getURL: (path: string) => path } },
    AbortController, ArrayBuffer, Uint8ClampedArray, setTimeout, clearTimeout,
    ImageData: class { constructor(public data: Uint8ClampedArray, public width: number, public height: number) {} },
  });
  runInContext(buildSync({ entryPoints: ['src/html-media.ts'], bundle: true, write: false, format: 'iife', globalName: 'media', target: 'chrome109' }).outputFiles[0].text, context);
  const media = await runInContext('media.createHtmlMedia(input, host, new AbortController().signal, true)', context);
  try {
    const pixels = await media.pixels(0, 2000, 1000, '#000000');
    assert.equal(pixels.width, 2000); assert.equal(pixels.height, 1000);
    assert.equal(pixels.data.byteLength, 2000 * 1000 * 4);
    for (const [width, height] of [[2001, 1000], [1000, 2001], [0, 1], [1.5, 1]]) {
      await assert.rejects(media.pixels(0, width, height, '#000000'), /Invalid HTML export dimensions/);
    }
    assert.equal(requests.length, 1);
  } finally { media.dispose(); }
});

test('HTML artwork is restricted to an opaque manifest sandbox without extension, network, or navigation privileges', () => {
  const manifest = JSON.parse(readFileSync(new URL('../public/manifest.json', import.meta.url), 'utf8'));
  assert.deepEqual(manifest.sandbox.pages, ['html-media.html']);
  const policy = manifest.content_security_policy;
  assert.match(policy.sandbox, /sandbox allow-scripts;/);
  assert.doesNotMatch(policy.sandbox, /allow-same-origin|allow-popups|allow-forms|allow-top-navigation|unsafe-eval/);
  for (const directive of ['connect-src', 'frame-src', 'object-src', 'worker-src', 'form-action', 'base-uri']) assert.ok(policy.sandbox.includes(`${directive} 'none'`));
  assert.doesNotMatch(policy.extension_pages, /'unsafe-inline'|'unsafe-eval'/);
  assert.match(policy.extension_pages, /frame-src 'self'/);
});
