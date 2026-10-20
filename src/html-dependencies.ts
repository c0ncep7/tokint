import { requestBytes, type NetworkOptions } from './network';

export const HTML_DEPENDENCY_CACHE = 'tokint-html-dependencies-v1';
const MAX_BYTES = 1024 * 1024;
const dependencies: Readonly<Record<string, string>> = {
  'https://cdnjs.cloudflare.com/ajax/libs/p5.js/1.0.0/p5.min.js': '3e0d5d8be7c1179dd16e1f68651fc5783d71b05cd32c2f7ade571a7350f489ab',
};

async function verified(bytes: Uint8Array<ArrayBuffer>, expected: string) {
  if (bytes.length > MAX_BYTES) return false;
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('') === expected;
}

// Only public library bytes are stored here, never token URLs, artwork or user
// data. Cached bytes are checked again before being sent to the opaque sandbox.
export async function loadHtmlDependencies(urls: unknown, opts: NetworkOptions = {}, storage: CacheStorage | undefined = globalThis.caches): Promise<Record<string, string>> {
  if (!Array.isArray(urls) || urls.length > 8 || urls.some(url => typeof url !== 'string' || !Object.hasOwn(dependencies, url))) {
    throw new Error('This HTML artwork needs an unsupported external script. Use Open selected media to view it in your browser.');
  }
  const sources: Record<string, string> = {};
  for (const url of new Set<string>(urls)) {
    opts.signal?.throwIfAborted();
    let cache: Cache | undefined;
    let bytes: Uint8Array<ArrayBuffer> | undefined;
    try {
      cache = await storage?.open(HTML_DEPENDENCY_CACHE);
      const saved = await cache?.match(url);
      if (saved) {
        const blob = await saved.blob();
        const cached = blob.size <= MAX_BYTES ? new Uint8Array(await blob.arrayBuffer()) : undefined;
        if (cached && await verified(cached, dependencies[url])) bytes = cached;
        else await cache?.delete(url);
      }
    } catch { /* An unavailable cache does not prevent a verified network load. */ }
    opts.signal?.throwIfAborted();
    if (!bytes) {
      const result = await requestBytes(url, 'image', MAX_BYTES, { ...opts, timeoutMs: 15_000 });
      if (!await verified(result.bytes, dependencies[url])) throw new Error('HTML artwork dependency failed its integrity check. No script was executed. Retry or open the source in your browser.');
      bytes = result.bytes;
      opts.signal?.throwIfAborted();
      try { await cache?.put(url, new Response(bytes, { headers: { 'Content-Type': 'application/javascript' } })); }
      catch { /* Cache quota/storage failures must not block the current artwork. */ }
    }
    opts.signal?.throwIfAborted();
    sources[url] = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  }
  return sources;
}
