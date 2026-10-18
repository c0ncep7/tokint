import { GIFEncoder, applyPalette } from 'gifenc';
import { gifPalette } from './gif-palette';
import { WebPAnimation } from './webp';
import type { AnimationFormat } from './share-core';

// Encode only changed pixels. The first frame covers the canvas; subsequent
// frames leave unchanged pixels in place (GIF disposal 1 / WebP disposal 0).
export class AnimationEncoder {
  private gif?: ReturnType<typeof GIFEncoder>;
  private webp?: WebPAnimation;
  private previous?: Uint8ClampedArray;
  constructor(format: AnimationFormat, private canvas: OffscreenCanvas, private colors = 256, private quality = 0.9) {
    if (format === 'gif') this.gif = GIFEncoder();
    else this.webp = new WebPAnimation(canvas.width, canvas.height);
  }
  get byteLength() { return this.gif?.bytesView().length ?? this.webp!.byteLength; }
  // Supplied pixels are owned by the encoder until the next frame. HTML/SVG
  // workers can pass their transferred buffer directly without a canvas trip.
  async addFrame(duration: number, suppliedPixels?: Uint8ClampedArray<ArrayBuffer>) {
    const { width, height } = this.canvas;
    const pixels = suppliedPixels ?? this.canvas.getContext('2d')!.getImageData(0, 0, width, height).data;
    if (pixels.length !== width * height * 4 || pixels.byteOffset !== 0 || pixels.byteLength !== pixels.buffer.byteLength) throw new Error('Invalid animation frame buffer.');
    const packed = new Uint32Array(pixels.buffer);
    const previous = this.previous && new Uint32Array(this.previous.buffer);
    let left = 0, top = 0, right = width - 1, bottom = height - 1;
    let unchanged = false;
    if (this.previous) {
      left = width; top = height; right = bottom = -1;
      for (let y = 0, i = 0; y < height; y++) for (let x = 0; x < width; x++, i++) {
        if (packed[i] !== previous![i]) {
          left = Math.min(left, x); right = Math.max(right, x); top = Math.min(top, y); bottom = Math.max(bottom, y);
        }
      }
      if (right < 0) { unchanged = true; left = top = right = bottom = 0; } // Preserve this frame's delay.
      if (this.webp) { left -= left % 2; top -= top % 2; } // ANMF offsets use two-pixel units.
    }
    const w = right - left + 1, h = bottom - top + 1;
    let regionPixels: Uint8ClampedArray<ArrayBuffer>;
    if (this.gif && w === width && h === height) regionPixels = pixels;
    else {
      regionPixels = new Uint8ClampedArray(w * h * 4);
      for (let y = 0; y < h; y++) {
        const start = ((y + top) * width + left) * 4;
        regionPixels.set(pixels.subarray(start, start + w * 4), y * w * 4);
      }
    }
    if (this.gif) {
      const transparent = !!this.previous;
      const palette = gifPalette(regionPixels, transparent ? Math.min(255, this.colors) : this.colors);
      const indices = applyPalette(regionPixels, palette);
      const transparentIndex = palette.length;
      if (transparent) {
        palette.push([0, 0, 0]);
        for (let y = 0, p = 0; y < h; y++) for (let x = 0; x < w; x++, p++) {
          const i = (y + top) * width + x + left;
          if (packed[i] === previous![i]) indices[p] = transparentIndex;
        }
      }
      const start = this.gif.bytesView().length;
      this.gif.writeFrame(indices, w, h, { palette, delay: duration, repeat: 0, dispose: 1, transparent, transparentIndex });
      if (transparent) {
        // gifenc writes an 8-byte GCE followed by a zero-offset image descriptor.
        // Set the descriptor's offsets for our cropped rectangle. gifenc is pinned
        // by the lockfile and decoded-output regression tests cover this layout.
        const bytes = this.gif.bytesView();
        if (bytes[start] !== 0x21 || bytes[start+1] !== 0xf9 || bytes[start+8] !== 0x2c) throw new Error('Unexpected GIF frame layout.');
        const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
        view.setUint16(start + 9, left, true); view.setUint16(start + 11, top, true);
      }
    } else {
      const region = new ImageData(regionPixels, w, h);
      const opaqueRegion = this.previous && !unchanged ? new ImageData(new Uint8ClampedArray(region.data), w, h) : undefined;
      if (this.previous) {
        for (let y = 0, p = 0; y < h; y++) for (let x = 0; x < w; x++, p += 4) {
          const i = ((y + top) * width + x + left) * 4;
          if (pixels[i] === this.previous[i] && pixels[i+1] === this.previous[i+1] && pixels[i+2] === this.previous[i+2] && pixels[i+3] === this.previous[i+3]) region.data.fill(0, p, p + 4);
        }
      }
      const frameCanvas = new OffscreenCanvas(w, h);
      if (!unchanged) frameCanvas.getContext('2d')!.putImageData(region, 0, 0);
      else frameCanvas.getContext('2d')!.clearRect(0, 0, w, h);
      let frame = await frameCanvas.convertToBlob({ type: 'image/webp', quality: this.quality });
      let blend = !!this.previous;
      if (opaqueRegion) {
        // Sparse transparency is excellent for some artwork but its alpha mask
        // can cost more than repainting a complex region. Keep the smaller file.
        frameCanvas.getContext('2d')!.putImageData(opaqueRegion, 0, 0);
        const opaque = await frameCanvas.convertToBlob({ type: 'image/webp', quality: this.quality });
        if (opaque.type === 'image/webp' && opaque.size < frame.size) { frame = opaque; blend = false; }
      }
      if (frame.type !== 'image/webp') throw new Error('WebP encoding is unavailable in this browser. Choose GIF.');
      this.webp!.addFrame(new Uint8Array(await frame.arrayBuffer()), duration, { left, top, width: w, height: h, blend });
    }
    this.previous = pixels;
  }
  finish() {
    if (this.gif) { this.gif.finish(); return new Blob([this.gif.bytes()], { type: 'image/gif' }); }
    return this.webp!.finish();
  }
}
