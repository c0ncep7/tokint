import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Failure } from '../src/core';
import { loadImage, loadMedia, loadMetadata, loadPreview, PREVIEW_BYTES, requestBytes, type NetworkOptions } from '../src/network';
const permitted = async () => true;
const mock = (response: Response): NetworkOptions => ({ permitted, fetcher: async () => response });
test('missing permission stops network access and identifies the host grant', async () => {
  let calls = 0;
  await assert.rejects(loadMetadata('https://metadata.example/item', { permitted: async () => false, fetcher: async () => { calls++; return new Response('{}'); } }), (e: unknown) => e instanceof Failure && e.kind === 'permission' && e.origin === 'https://metadata.example/*');
  assert.equal(calls, 0);
});
test('redirects fail closed before response bodies are read and cannot be enabled by callers', async () => {
  for (const kind of ['rpc', 'metadata', 'gateway', 'image'] as const) {
    for (const status of [301, 302, 303, 307, 308]) {
      let stopped = false;
      await assert.rejects(requestBytes('https://allowed.example/start', kind, 1000, {
        permitted,
        fetcher: async (_url, init) => {
          assert.equal(init?.redirect, 'manual');
          assert.equal(init?.credentials, 'omit');
          assert.equal(init?.referrerPolicy, 'no-referrer');
          init?.signal?.addEventListener('abort', () => { stopped = true; });
          return new Response(null, { status, headers: { Location: 'https://unapproved.example/' } });
        },
      }, { redirect: 'follow', credentials: 'include' }), (e: unknown) => e instanceof Failure && e.kind === kind && /redirects are blocked/.test(e.message));
      assert.equal(stopped, true);
    }
  }
  const response = new Response();
  Object.defineProperties(response, { type: { value: 'opaqueredirect' }, status: { value: 0 } });
  await assert.rejects(loadMetadata('https://allowed.example/start', mock(response)), /redirects are blocked/);
});
test('automatic previews reject oversized declared and streamed bodies while originals remain available', async () => {
  await assert.rejects(loadPreview('https://example.com/large.gif', mock(new Response('GIF89a', { headers: { 'Content-Type': 'image/gif', 'Content-Length': String(PREVIEW_BYTES + 1) } }))), /exceeds/);
  let cancelled = false;
  const chunk = new Uint8Array(1024 * 1024);
  const stream = new ReadableStream<Uint8Array>({ pull(controller) { controller.enqueue(chunk); }, cancel() { cancelled = true; } });
  await assert.rejects(loadPreview('https://example.com/large.gif', mock(new Response(stream, { headers: { 'Content-Type': 'image/gif' } }))), /exceeds/);
  assert.equal(cancelled, true);
  const original = await loadMedia('https://example.com/large.gif', mock(new Response('GIF89a', { headers: { 'Content-Type': 'image/gif', 'Content-Length': String(PREVIEW_BYTES + 1) } })));
  assert.equal(original.size, 6);
});
test('automatic previews honor their timeout while streaming', async () => {
  await assert.rejects(loadPreview('https://example.com/slow.gif', {
    permitted, timeoutMs: 5,
    fetcher: async (_url, init) => new Response(new ReadableStream({ start(stream) {
      init?.signal?.addEventListener('abort', () => stream.error(new DOMException('aborted', 'AbortError')));
    } }), { headers: { 'Content-Type': 'image/gif' } }),
  }), /timed out/);
});
test('HTTP 429 is classified as a gateway failure with retry advice', async () => {
  await assert.rejects(loadMetadata('https://example.com/a', mock(new Response('', { status: 429 })), true), (e: unknown) => e instanceof Failure && e.kind === 'gateway' && /rate limited/.test(e.message));
});
test('RPC transport and metadata host failures remain distinct', async () => {
  for (const kind of ['rpc', 'metadata'] as const) await assert.rejects(requestBytes('https://example.com', kind, 1000, mock(new Response('', { status: 503 }))), (e: unknown) => e instanceof Failure && e.kind === kind);
});
test('timeouts abort the in-flight request', async () => {
  let aborted = false;
  await assert.rejects(loadMetadata('https://example.com', { permitted, timeoutMs: 5, fetcher: async (_url, init) => new Promise((_resolve, reject) => { init?.signal?.addEventListener('abort', () => { aborted = true; reject(new DOMException('aborted', 'AbortError')); }); }) }), /timed out/);
  assert.equal(aborted, true);
});
test('caller cancellation is not reported as a network error', async () => {
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(loadMetadata('https://example.com', { permitted, signal: controller.signal }), (e: unknown) => e instanceof DOMException && e.name === 'AbortError');
});
test('malformed metadata retains a JSON failure category', async () => {
  await assert.rejects(loadMetadata('https://example.com', mock(new Response('<html>unavailable</html>'))), (e: unknown) => e instanceof Failure && e.kind === 'json');
});
test('size bounds apply to streamed responses without Content-Length', async () => {
  await assert.rejects(requestBytes('https://example.com', 'metadata', 3, mock(new Response('1234'))), /exceeds/);
});
test('embedded metadata does not require network permission', async () => {
  assert.deepEqual((await loadMetadata('data:application/json,%7B%22name%22%3A%22test%22%7D', { permitted: async () => { throw new Error('must not call'); } })).data, { name: 'test' });
});
test('image HTTP failure and non-image response are handled independently', async () => {
  await assert.rejects(loadImage('https://example.com/a', mock(new Response('', { status: 404 }))), /404/);
  await assert.rejects(loadImage('https://example.com/a', mock(new Response('<html/>', { headers: { 'Content-Type': 'text/html' } }))), /not a supported image/);
});
test('SVG is returned as a blob for isolated image decoding', async () => {
  const blob = await loadImage('https://example.com/a', mock(new Response('<svg xmlns="http://www.w3.org/2000/svg"/>', { headers: { 'Content-Type': 'image/svg+xml' } })));
  assert.equal(blob.type, 'image/svg+xml');
});
test('HTML artwork uses the media loader without broadening image-only loaders', async () => {
  const response = () => mock(new Response('<canvas></canvas>', { headers: { 'Content-Type': 'text/html; charset=utf-8' } }));
  const blob = await loadMedia('https://example.com/animation', response());
  assert.equal(blob.type, 'text/html');
  assert.equal(await blob.text(), '<canvas></canvas>');
  await assert.rejects(loadImage('https://example.com/image', response()), /not a supported image/);
});

test('original media loads actual streamed bodies above 20 MiB with and without Content-Length', async () => {
  const chunk = new Uint8Array(1024 * 1024).fill(73);
  for (const declared of [false, true]) {
    let count = 0;
    const stream = new ReadableStream<Uint8Array>({ pull(controller) { if (count++ < 21) controller.enqueue(chunk); else controller.close(); } });
    const headers: Record<string, string> = { 'Content-Type': 'image/gif' };
    if (declared) headers['Content-Length'] = String(21 * chunk.length);
    const blob = await loadImage('https://example.com/large.gif', mock(new Response(stream, { headers })));
    assert.equal(blob.size, 21 * chunk.length);
    assert.equal(new Uint8Array(await blob.slice(-1).arrayBuffer())[0], 73);
  }
});
test('an original above the former 100 MiB download cap is accepted by its declared length', async () => {
  const blob = await loadImage('https://example.com/large.gif', mock(new Response('GIF89a', { headers: { 'Content-Type': 'image/gif', 'Content-Length': String(101 * 1024 * 1024) } })));
  assert.equal(blob.size, 6);
});
test('unlimited media remains cancellable during body streaming and supports an explicit timeout', async () => {
  for (const timeout of [false, true]) {
    const controller = new AbortController(); let cancelled = false;
    const request = loadImage('https://example.com/large.gif', {
      permitted, signal: controller.signal, ...(timeout ? { timeoutMs: 5 } : {}),
      fetcher: async (_url, init) => new Response(new ReadableStream({ start(stream) {
        stream.enqueue(new Uint8Array(10));
        init?.signal?.addEventListener('abort', () => { cancelled = true; stream.error(new DOMException('aborted', 'AbortError')); });
        if (!timeout) queueMicrotask(() => controller.abort());
      } }), { headers: { 'Content-Type': 'image/gif' } }),
    });
    await assert.rejects(request, timeout ? /timed out/ : /cancelled/);
    assert.equal(cancelled, true);
  }
});
