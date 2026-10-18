import { chromium } from 'playwright';
import { build } from 'esbuild';
import { readFile, mkdir, mkdtemp, cp, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
const file = process.env.SVG_FILE;
if (!file) throw new Error('Set SVG_FILE.');
const svg = await readFile(file, 'utf8');
const existing = process.env.EXISTING_FILE ? (await readFile(process.env.EXISTING_FILE)).toString('base64') : undefined;
const edge = Number(process.env.EDGE || 750), fps = Number(process.env.FPS || 25), seconds = Number(process.env.CLIP_SECONDS || 10);
const colors = Number(process.env.COLORS || 256), quality = Number(process.env.QUALITY || 0.9);
const formats = process.env.SKIP_EXPORT ? [] : (process.env.FORMATS || 'gif,webp').split(',');
await mkdir('test-results', { recursive: true });
const root = await mkdtemp(path.resolve('test-results/review-'));
await cp('extension', `${root}/extension`, { recursive: true });
await build({ stdin: { contents: `import { prepareSvg, svgPixels, svgExportSize } from './src/svg'; globalThis.review = { prepareSvg, svgPixels, svgExportSize };`, resolveDir: process.cwd() }, outfile: `${root}/extension/review.js`, bundle: true, format: 'iife' });
const context = await chromium.launchPersistentContext(`${root}/profile`, { executablePath: process.env.CHROMIUM_EXECUTABLE || undefined, channel: process.env.CHROMIUM_EXECUTABLE ? undefined : 'chromium', headless: true, viewport: { width: 500, height: 500 }, args: [`--disable-extensions-except=${root}/extension`, `--load-extension=${root}/extension`] });
try {
  const worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker');
  const origin = `chrome-extension://${new URL(worker.url()).host}`;
  const page = await context.newPage();
  page.on('console', msg => { if ((msg.type() === 'error' && !msg.text().includes('inline style')) || msg.text().startsWith('Optimizing')) console.log('BROWSER ERROR', msg.text()); });
  await page.goto(`${origin}/results.html`); await page.addScriptTag({ url: `${origin}/review.js` });
  await page.evaluate(async svg => { globalThis.plan = await review.prepareSvg(new Blob([svg], { type: 'image/svg+xml' })); }, svg);
  const report = { edge, fps, seconds, reference: [], exports: [] };
  if (process.env.SKIP_REFERENCE !== '1') {
    // A separate test-only SVG document uses the browser's native paused SMIL clock.
    // This fixture was inspected for scripts/external assets and passed prepareSvg.
    await context.route('https://svg-review.test/art.svg', route => route.fulfill({ contentType: 'image/svg+xml', body: svg }));
    const reference = await context.newPage(); await reference.goto('https://svg-review.test/art.svg');
    await reference.evaluate(() => { const svg = document.documentElement; svg.setAttribute('width', '500'); svg.setAttribute('height', '500'); svg.pauseAnimations(); });
    for (const time of [0, 0.075, 0.12, 0.3, 1.13, 5.19, 9.99, 11.19, 11.2]) {
      await reference.evaluate(time => document.documentElement.setCurrentTime(time), time);
      const png = await reference.screenshot();
      const metrics = await page.evaluate(async ({ time, png }) => {
        const pixels = await review.svgPixels(plan, time, 500, 500, '#000000', new AbortController().signal);
        const next = await review.svgPixels(plan, time + 0.04, 500, 500, '#000000', new AbortController().signal);
        const blob = new Blob([Uint8Array.from(atob(png), c => c.charCodeAt(0))], { type: 'image/png' });
        const image = await createImageBitmap(blob); const canvas = new OffscreenCanvas(500, 500); const ctx = canvas.getContext('2d'); ctx.drawImage(image, 0, 0); image.close();
        const reference = ctx.getImageData(0, 0, 500, 500).data;
        let error = 0, changed = 0, nextError = 0;
        for (let i = 0; i < reference.length; i += 4) { let max = 0; for (let c = 0; c < 3; c++) { const d = Math.abs(reference[i+c] - pixels.data[i+c]); error += d; nextError += Math.abs(reference[i+c] - next.data[i+c]); max = Math.max(max, d); } if (max > 8) changed++; }
        ctx.putImageData(pixels, 0, 0); const rendered = await canvas.convertToBlob({type:'image/png'}); const reader = new FileReader(); const encoded = await new Promise(resolve => {reader.onload = () => resolve(reader.result.split(',')[1]); reader.readAsDataURL(rendered);});
        return { time, meanError: error / (500*500*3), nextMeanError: nextError / (500*500*3), differingPixels: changed / (500*500), encoded };
      }, { time, png: png.toString('base64') });
      if (time === 0) { await writeFile('test-results/native.png', png); await writeFile('test-results/sampled.png', Buffer.from(metrics.encoded,'base64')); } delete metrics.encoded;
      report.reference.push(metrics); console.log('REFERENCE', metrics);
    }
    await reference.close();
  }
  for (const format of formats) {
    const start = Date.now();
    const result = await page.evaluate(async ({ origin, edge, fps, seconds, format, colors, quality, existing }) => {
      const size = review.svgExportSize(plan, { maxEdge: edge, fps }, seconds);
      const result = existing ? { blob: new Blob([Uint8Array.from(atob(existing), c => c.charCodeAt(0))], { type: `image/${format}` }) } : await new Promise((resolve, reject) => {
        const w = new Worker(`${origin}/svg-worker.js`, { type: 'module' });
        const timer = setTimeout(() => { w.terminate(); reject(new Error('Review timed out')); }, 300000);
        const stop = () => { clearTimeout(timer); w.terminate(); };
        w.onerror = event => { stop(); reject(new Error(event.message)); };
        w.onmessage = async ({ data }) => {
          try {
            if (data.kind === 'frame') {
              const precision = format === 'gif' ? 10 : 1;
              const seconds = Math.round(data.index * size.duration / size.frames / precision) * precision / 1000;
              const pixels = await review.svgPixels(plan, seconds, size.width, size.height, '#000000', new AbortController().signal);
              w.postMessage({ kind: 'frame', index: data.index, pixels: pixels.data }, [pixels.data.buffer]);
            } else if (data.kind === 'done') { stop(); resolve(data.result); }
            else if (data.kind === 'error') { stop(); reject(new Error(data.message)); }
            else if (data.kind === 'progress' && data.value === 100) console.log(data.text);
          } catch (error) { stop(); reject(error); }
        };
        w.postMessage({ kind: 'start', ...size, format, colors, quality, limit: 15000000 });
      });
      const bytes = await result.blob.arrayBuffer();
      const decoder = new ImageDecoder({ data: bytes, type: result.blob.type }); await decoder.tracks.ready; await decoder.completed;
      const count = decoder.tracks.selectedTrack.frameCount;
      let duration = 0, error = 0, samples = 0, maxMeanError = 0;
      for (let i = 0; i < count; i++) {
        const { image } = await decoder.decode({ frameIndex: i });
        const expected = await review.svgPixels(plan, duration / 1000, size.width, size.height, '#000000', new AbortController().signal);
        const canvas = new OffscreenCanvas(size.width, size.height); const ctx = canvas.getContext('2d'); ctx.drawImage(image, 0, 0); const actual = ctx.getImageData(0, 0, size.width, size.height).data;
        let frameError = 0;
        for (let p = 0; p < actual.length; p += 4) for (let c = 0; c < 3; c++) frameError += Math.abs(actual[p+c] - expected.data[p+c]);
        const mean = frameError / (size.width*size.height*3); error += mean; maxMeanError = Math.max(maxMeanError, mean); samples++;
        duration += image.duration / 1000; image.close();
      }
      decoder.close();
      const base64 = await new Promise(resolve => { const r = new FileReader(); r.onload = () => resolve(r.result.split(',')[1]); r.readAsDataURL(result.blob); });
      return { ...size, count, duration, bytes: bytes.byteLength, meanError: error / samples, maxMeanError, base64 };
    }, { origin, edge, fps, seconds, format, colors, quality, existing }).catch(error => ({ error: error.message }));
    if (result.base64) { await writeFile(`test-results/review-${edge}-${fps}-${seconds}.${format}`, Buffer.from(result.base64, 'base64')); delete result.base64; }
    report.exports.push({ format, ...result, elapsed: (Date.now()-start)/1000 }); console.log('EXPORT', report.exports.at(-1));
  }
  await writeFile(`test-results/review-${edge}-${fps}-${seconds}-${process.env.LABEL || 'current'}.json`, JSON.stringify(report, null, 2));
} finally { await context.close(); await rm(root, { recursive: true, force: true }); }
