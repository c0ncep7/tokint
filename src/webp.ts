// RIFF animation container around frames encoded by the browser's WebP encoder.
// https://developers.google.com/speed/webp/docs/riff_container
const ascii = (text: string) => Uint8Array.from(text, c => c.charCodeAt(0));
function uint24(bytes: Uint8Array, offset: number, value: number) {
  bytes[offset] = value; bytes[offset + 1] = value >>> 8; bytes[offset + 2] = value >>> 16;
}
function chunk(name: string, payload: Uint8Array): Uint8Array<ArrayBuffer> {
  const bytes = new Uint8Array(8 + payload.length + (payload.length % 2));
  bytes.set(ascii(name)); new DataView(bytes.buffer).setUint32(4, payload.length, true);
  bytes.set(payload, 8); return bytes;
}
export class WebPAnimation {
  private frames: Uint8Array<ArrayBuffer>[] = [];
  private alpha = false;
  // RIFF header + VP8X + ANIM.
  byteLength = 44;
  constructor(private width: number, private height: number) {
    if (![width, height].every(v => Number.isInteger(v) && v > 0 && v <= 2000)) throw new Error('Invalid WebP dimensions.');
  }
  addFrame(bytes: Uint8Array, duration: number, rect: { left: number; top: number; width: number; height: number; blend?: boolean } = { left: 0, top: 0, width: this.width, height: this.height }) {
    if (![rect.left, rect.top, rect.width, rect.height].every(Number.isInteger) || rect.left < 0 || rect.top < 0 || rect.left % 2 || rect.top % 2 || rect.width < 1 || rect.height < 1 || rect.left + rect.width > this.width || rect.top + rect.height > this.height) throw new Error('Invalid WebP frame rectangle.');
    const text = (a: number, b: number) => String.fromCharCode(...bytes.subarray(a, b));
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    if (bytes.length < 20 || text(0, 4) !== 'RIFF' || text(8, 12) !== 'WEBP' || view.getUint32(4, true) + 8 !== bytes.length) throw new Error('The browser did not produce a valid WebP frame.');
    if (!Number.isInteger(duration) || duration < 20 || duration > 0xffffff) throw new Error('Invalid WebP frame duration.');
    const parts: Uint8Array[] = [];
    let images = 0, length = 16;
    for (let offset = 12; offset < bytes.length;) {
      if (offset + 8 > bytes.length) throw new Error('Incomplete WebP chunk.');
      const name = text(offset, offset + 4), size = view.getUint32(offset + 4, true);
      const end = offset + 8 + size + (size % 2);
      if (end > bytes.length) throw new Error('Incomplete WebP frame.');
      if (name === 'ANIM' || name === 'ANMF') throw new Error('Expected a single WebP frame.');
      if (name === 'VP8 ' || name === 'VP8L' || name === 'ALPH') {
        const part = bytes.subarray(offset, end); parts.push(part); length += part.length;
        if (name === 'ALPH') this.alpha = true;
        else {
          images++;
          if (name === 'VP8L' && size >= 5 && (bytes[offset + 12] & 0x10)) this.alpha = true;
        }
      }
      offset = end;
    }
    if (images !== 1) throw new Error('Missing or duplicate WebP image data.');
    const payload = new Uint8Array(length);
    uint24(payload, 0, rect.left / 2); uint24(payload, 3, rect.top / 2);
    uint24(payload, 6, rect.width - 1); uint24(payload, 9, rect.height - 1);
    uint24(payload, 12, duration); payload[15] = rect.blend ? 0 : 2; // Replace this rectangle; retain the rest of the previous frame.
    let offset = 16;
    for (const part of parts) { payload.set(part, offset); offset += part.length; }
    const frame = chunk('ANMF', payload); this.frames.push(frame); this.byteLength += frame.length;
  }
  finish(): Blob {
    if (this.frames.length < 2) throw new Error('An animated WebP needs at least two frames.');
    const header = new Uint8Array(12); header.set(ascii('RIFF')); header.set(ascii('WEBP'), 8);
    new DataView(header.buffer).setUint32(4, this.byteLength - 8, true);
    const extended = new Uint8Array(10); extended[0] = 2 | (this.alpha ? 16 : 0);
    uint24(extended, 4, this.width - 1); uint24(extended, 7, this.height - 1);
    const animation = new Uint8Array(6); animation[3] = 255; // Opaque black; loop forever.
    return new Blob([header, chunk('VP8X', extended), chunk('ANIM', animation), ...this.frames], { type: 'image/webp' });
  }
}
