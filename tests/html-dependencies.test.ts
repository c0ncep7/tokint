import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { Failure } from '../src/core';
import { loadHtmlDependencies, HTML_DEPENDENCY_CACHE } from '../src/html-dependencies';

const url = 'https://cdnjs.cloudflare.com/ajax/libs/p5.js/1.0.0/p5.min.js';
const runtime = await readFile(new URL('../node_modules/p5/lib/p5.min.js', import.meta.url));
const permitted = async () => true;
function cache() {
  const entries = new Map<string, Response>();
  const storage = { open: async (name: string) => {
    assert.equal(name, HTML_DEPENDENCY_CACHE);
    return {
      match: async (url: string) => entries.get(url)?.clone(),
      put: async (url: string, response: Response) => { entries.set(url, response.clone()); },
      delete: async (url: string) => entries.delete(url),
    };
  } } as unknown as CacheStorage;
  return { entries, storage };
}

test('HTML dependency loads the pinned bytes with consent, then reuses verified cache offline', async () => {
  const { entries, storage } = cache();
  let requests = 0;
  const sources = await loadHtmlDependencies([url, url], {
    permitted: async origin => { assert.equal(origin, 'https://cdnjs.cloudflare.com/*'); return true; },
    fetcher: async (input, init) => {
      requests++;
      assert.equal(input, url);
      assert.equal(init?.redirect, 'manual'); assert.equal(init?.credentials, 'omit');
      assert.equal(init?.referrerPolicy, 'no-referrer');
      return new Response(runtime);
    },
  }, storage);
  assert.equal(sources[url], runtime.toString());
  assert.equal(requests, 1); assert.equal(entries.size, 1);
  assert.deepEqual(await loadHtmlDependencies([url], {
    permitted: async () => false,
    fetcher: async () => { throw new Error('Offline'); },
  }, storage), sources);
});

test('HTML dependencies reject unknown URLs and missing access before a network request', async () => {
  const fetcher = async () => { throw new Error('Must not fetch'); };
  for (const urls of [[url + '?other'], ['https://attacker.example/p5.js'], ['__proto__'], [42], null, Array(9).fill(url)]) {
    await assert.rejects(loadHtmlDependencies(urls, { permitted, fetcher }, undefined), /unsupported external script/);
  }
  await assert.rejects(loadHtmlDependencies([url], { permitted: async () => false, fetcher }, undefined),
    (error: unknown) => error instanceof Failure && error.kind === 'permission' && error.origin === 'https://cdnjs.cloudflare.com/*');
});

test('HTML dependencies reject altered, oversized and redirected responses without caching them', async () => {
  const { entries, storage } = cache();
  for (const [response, message] of [
    [new Response('window.compromised=true'), /integrity check/],
    [new Response(runtime, { headers: { 'Content-Length': String(1024 * 1024 + 1) } }), /exceeds/],
    [new Response(null, { status: 302, headers: { Location: 'https://attacker.example/' } }), /redirects are blocked/],
  ] as const) {
    await assert.rejects(loadHtmlDependencies([url], { permitted, fetcher: async () => response }, storage), message);
    assert.equal(entries.size, 0);
  }
});

test('HTML dependencies reverify cache contents and replace corruption only with verified bytes', async () => {
  const { entries, storage } = cache();
  entries.set(url, new Response('altered cached script'));
  let requests = 0;
  const sources = await loadHtmlDependencies([url], { permitted, fetcher: async () => { requests++; return new Response(runtime); } }, storage);
  assert.equal(sources[url], runtime.toString()); assert.equal(requests, 1);
  assert.equal(await entries.get(url)!.text(), runtime.toString());
});

test('HTML dependency cache failure is nonfatal and cancelled loads never publish scripts', async () => {
  const storage = { open: async () => { throw new Error('Storage unavailable'); } } as unknown as CacheStorage;
  assert.equal((await loadHtmlDependencies([url], { permitted, fetcher: async () => new Response(runtime) }, storage))[url], runtime.toString());
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(loadHtmlDependencies([url], { signal: controller.signal }, storage), { name: 'AbortError' });
  const active = new AbortController();
  const loading = loadHtmlDependencies([url], {
    permitted, signal: active.signal,
    fetcher: async (_input, init) => {
      active.abort();
      assert.equal(init?.signal?.aborted, true);
      throw new DOMException('Cancelled', 'AbortError');
    },
  }, storage);
  await assert.rejects(loading, { name: 'AbortError' });
});
