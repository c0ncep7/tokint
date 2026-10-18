import { quantize } from 'gifenc';

// PNN palette construction is quadratic in the number of occupied color bins.
// Keep the detailed histogram for simple art; bound complex frames to 4096
// averaged RGB bins instead of allowing up to 65536 nearest-neighbor searches.
// All source pixels still contribute, and the output keeps up to 256 colors.
export function gifPalette(pixels: Uint8ClampedArray, colors: number) {
  const seen = new Uint8Array(65536);
  let count = 0;
  for (let i = 0; i < pixels.length; i += 4) {
    const key = ((pixels[i] >> 3) << 11) | ((pixels[i + 1] >> 2) << 5) | (pixels[i + 2] >> 3);
    if (!seen[key]) {
      seen[key] = 1;
      if (++count > 4096) return quantize(pixels, colors, { format: 'rgb444' });
    }
  }
  return quantize(pixels, colors);
}
