// Inspect generated GIF timing without decoding its pixel buffers.
export function gifInfo(bytes: Uint8Array) {
  if (bytes.length < 13 || String.fromCharCode(...bytes.subarray(0, 6)) !== 'GIF89a') throw new Error('Invalid generated GIF.');
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const width = view.getUint16(6, true), height = view.getUint16(8, true);
  let offset = 13 + (bytes[10] & 0x80 ? 3 * (2 << (bytes[10] & 7)) : 0);
  let frames = 0, duration = 0, delay = 0;
  const skipBlocks = () => {
    while (offset < bytes.length) { const size = bytes[offset++]; if (!size) return; offset += size; }
    throw new Error('Incomplete generated GIF.');
  };
  while (offset < bytes.length) {
    const marker = bytes[offset++];
    if (marker === 0x3b) return { width, height, frames, duration };
    if (marker === 0x21) {
      const label = bytes[offset++];
      if (label === 0xf9) {
        if (offset + 6 > bytes.length || bytes[offset] !== 4 || bytes[offset+5] !== 0) throw new Error('Invalid GIF timing block.');
        delay = view.getUint16(offset + 2, true) * 10; offset += 6;
      } else skipBlocks();
    } else if (marker === 0x2c) {
      if (offset + 9 > bytes.length) throw new Error('Incomplete GIF frame.');
      const flags = bytes[offset + 8]; offset += 9;
      if (flags & 0x80) offset += 3 * (2 << (flags & 7));
      offset++; skipBlocks(); frames++; duration += delay; delay = 0;
    } else throw new Error('Unexpected generated GIF block.');
  }
  throw new Error('Missing GIF end marker.');
}
