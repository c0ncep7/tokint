declare module 'gifenc' {
  export function quantize(data: Uint8Array | Uint8ClampedArray, colors: number, options?: { format: 'rgb565' | 'rgb444' }): number[][];
  export function applyPalette(data: Uint8Array | Uint8ClampedArray, palette: number[][]): Uint8Array;
  export function GIFEncoder(): {
    writeFrame(data: Uint8Array, width: number, height: number, options: { palette: number[][]; delay: number; repeat: number; dispose: number; transparent?: boolean; transparentIndex?: number }): void;
    finish(): void;
    bytesView(): Uint8Array;
    bytes(): Uint8Array<ArrayBuffer>;
  };
}
