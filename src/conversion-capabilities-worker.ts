// Probe in the same execution environment as the conversion workers.
export type ConversionCapabilities = { canvas: boolean; jpeg: boolean; webp: boolean; wasm: boolean; decoders: Record<string, boolean> };
self.onmessage = async () => {
  const capabilities: ConversionCapabilities = { canvas: false, jpeg: false, webp: false, wasm: false, decoders: {} };
  try {
    const canvas = new OffscreenCanvas(1, 1);
    capabilities.canvas = !!canvas.getContext('2d');
    for (const format of ['jpeg', 'webp'] as const) {
      try { capabilities[format] = (await canvas.convertToBlob({ type: `image/${format}` })).type === `image/${format}`; } catch { /* Unsupported encoder. */ }
    }
  } catch { /* No worker canvas. */ }
  try {
    // An empty module checks both runtime availability and the extension CSP.
    await WebAssembly.compile(new Uint8Array([0, 97, 115, 109, 1, 0, 0, 0]));
    capabilities.wasm = true;
  } catch { /* GIF optimization requires WebAssembly. */ }
  for (const type of ['image/jpeg', 'image/png', 'image/gif', 'image/webp']) {
    try { capabilities.decoders[type] = typeof ImageDecoder !== 'undefined' && await ImageDecoder.isTypeSupported(type); }
    catch { capabilities.decoders[type] = false; }
  }
  self.postMessage(capabilities);
};
