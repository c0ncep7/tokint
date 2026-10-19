import { contentUrl, Failure, MAX_METADATA, parseMetadata, permissionPattern, readDataJson } from './core';

export type NetworkOptions = {
  signal?: AbortSignal;
  fetcher?: typeof fetch;
  permitted?: (origin: string) => Promise<boolean>;
  timeoutMs?: number;
};
export async function requireAccess(url: string, opts: NetworkOptions = {}) {
  const origin = permissionPattern(url);
  const allowed = await (opts.permitted ?? (p => chrome.permissions.contains({ origins: [p] })))(origin);
  if (!allowed) throw new Failure('permission', `Allow access to ${new URL(url).origin} to continue.`, origin);
}
async function requestBody(url: string, kind: 'rpc' | 'metadata' | 'gateway' | 'image', limit: number, opts: NetworkOptions = {}, init: RequestInit = {}): Promise<{ blob: Blob; url: string; contentType: string }> {
  if (kind !== 'rpc' && (!init.method || init.method.toUpperCase() === 'GET')) url = contentUrl(url);
  await requireAccess(url, opts);
  opts.signal?.throwIfAborted();
  const controller = new AbortController();
  let timedOut = false;
  const abort = () => controller.abort();
  opts.signal?.addEventListener('abort', abort, { once: true });
  const timeoutMs = opts.timeoutMs ?? (kind === 'image' ? 0 : kind === 'rpc' ? 15_000 : 30_000);
  const timer = timeoutMs > 0 ? setTimeout(() => { timedOut = true; controller.abort(); }, timeoutMs) : undefined;
  try {
    // Fetch hides manual redirect destinations. Fail closed rather than contacting
    // an unapproved intermediate host (including an allowed A -> unknown B -> A).
    const response = await (opts.fetcher ?? fetch)(url, { ...init, signal: controller.signal, credentials: 'omit', referrerPolicy: 'no-referrer', cache: 'no-store', redirect: 'manual' });
    if (response.type === 'opaqueredirect' || response.redirected || (response.status >= 300 && response.status < 400)) throw new Failure(kind, 'This host redirects requests. Automatic redirects are blocked. Use a direct endpoint in Settings or open the source URL in a browser tab.');
    if (!response.ok) throw new Failure(kind, `${kind === 'rpc' ? 'RPC' : kind === 'gateway' ? 'IPFS gateway' : kind === 'image' ? 'Image host' : 'Metadata host'} returned HTTP ${response.status}${response.status === 429 ? ' (rate limited). Wait a moment, then retry.' : '.'}`);
    const contentType = response.headers.get('content-type') || '';
    // Let the browser spool unlimited originals into a Blob instead of collecting
    // chunks and allocating a second full-size JavaScript byte array.
    if (!Number.isFinite(limit)) return { blob: await response.blob(), url: response.url || url, contentType };
    const contentLength = Number(response.headers.get('content-length'));
    if (contentLength > limit) { await response.body?.cancel(); throw new Failure(kind, `Response exceeds the ${limit / 1024 / 1024} MB limit. Open its URL directly.`); }
    const reader = response.body?.getReader();
    const chunks: BlobPart[] = [];
    let length = 0;
    if (reader) {
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          length += value.length;
          if (length > limit) { await reader.cancel(); throw new Failure(kind, `Response exceeds the ${limit / 1024 / 1024} MB limit. Open its URL directly.`); }
          chunks.push(value);
        }
      } finally { reader.releaseLock(); }
    }
    return { blob: new Blob(chunks), url: response.url || url, contentType };
  } catch (error) {
    if (opts.signal?.aborted) throw new DOMException('Lookup cancelled', 'AbortError');
    if (timedOut) throw new Failure(kind, `${kind === 'rpc' ? 'RPC' : 'Download'} timed out. Retry or change the endpoint in Settings.`);
    if (error instanceof Failure) throw error;
    throw new Failure(kind, 'The request could not reach the host. Check your connection, host access, or endpoint settings, then retry.');
  } finally {
    // Stop the underlying transfer on rejected headers/status, not just its timer.
    controller.abort();
    clearTimeout(timer);
    opts.signal?.removeEventListener('abort', abort);
  }
}
export async function requestBytes(url: string, kind: 'rpc' | 'metadata' | 'gateway' | 'image', limit: number, opts: NetworkOptions = {}, init: RequestInit = {}): Promise<{ bytes: Uint8Array<ArrayBuffer>; url: string; contentType: string }> {
  const result = await requestBody(url, kind, limit, opts, init);
  return { bytes: new Uint8Array(await result.blob.arrayBuffer()), url: result.url, contentType: result.contentType };
}
export async function loadMetadata(url: string, opts: NetworkOptions = {}, ipfs = false) {
  if (url.startsWith('data:')) {
    if (url.length > MAX_METADATA * 3) throw new Failure('json', 'Embedded metadata exceeds the size limit.');
    return { data: readDataJson(url), url };
  }
  const result = await requestBytes(url, ipfs ? 'gateway' : 'metadata', MAX_METADATA, opts);
  return { data: parseMetadata(new TextDecoder().decode(result.bytes)), url: result.url };
}
export async function loadImage(url: string, opts: NetworkOptions = {}, maxBytes = Infinity): Promise<Blob> {
  return loadMedia(url, opts, maxBytes, false);
}
export const PREVIEW_BYTES = 100 * 1024 * 1024;
export async function loadPreview(url: string, opts: NetworkOptions = {}): Promise<Blob> {
  return loadMedia(url, { ...opts, timeoutMs: opts.timeoutMs ?? 30_000 }, PREVIEW_BYTES);
}
export async function loadMedia(url: string, opts: NetworkOptions = {}, maxBytes = Infinity, allowHtml = true): Promise<Blob> {
  const result = await requestBody(url, 'image', maxBytes, opts);
  const type = result.contentType.split(';')[0].trim().toLowerCase();
  // Some gateways send application/octet-stream. Blob images still use the browser's
  // image decoder, never an iframe, object element, or an HTML insertion point.
  if (type && !type.startsWith('image/') && type !== 'application/octet-stream' && !(allowHtml && type === 'text/html')) throw new Failure('image', 'This media is not a supported image or HTML artwork. Use Open selected media for video or audio.');
  return new Blob([result.blob], { type });
}
