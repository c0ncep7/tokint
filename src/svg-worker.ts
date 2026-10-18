import { optimizeGif, MAX_INTERMEDIATE_BYTES } from './gif-optimizer';
import { AnimationEncoder } from './animation-encoder';
import { animationFrameTime, type AnimationFormat } from './share-core';

type Start = { kind: 'start'; label?: 'SVG' | 'HTML'; width: number; height: number; frames: number; duration: number; limit: number; format?: AnimationFormat; colors?: number; quality?: number };
class SizeError extends Error { constructor(message: string, public suggestedEdge: number) { super(message); } }
type Frame = { kind: 'frame'; index: number; pixels: Uint8ClampedArray<ArrayBuffer> };
let job: Start | undefined;
let encoder: AnimationEncoder | undefined;
let canvas: OffscreenCanvas | undefined;
let index = 0;
let busy = false;
self.onmessage = (event: MessageEvent<Start | Frame>) => {
  if (busy) return; // A frame is requested only after the previous one finishes.
  busy = true;
  void handle(event.data).catch(error => {
    job = undefined; encoder = undefined; canvas = undefined;
    self.postMessage({ kind: 'error', code: error instanceof SizeError ? 'size' : undefined, suggestedEdge: error instanceof SizeError ? error.suggestedEdge : undefined, message: error instanceof Error ? error.message : 'SVG export failed.' });
  }).finally(() => { busy = false; });
};
async function handle(message: Start | Frame) {
  if (message.kind === 'start') {
    if (![message.width, message.height, message.frames, message.duration, message.limit].every(v => Number.isInteger(v) && v > 0) || message.width > 2000 || message.height > 2000 || message.frames < 2 || message.frames > 3000 || message.duration > 60000 || message.duration / message.frames < 20 || message.limit > 15_000_000 || !['gif', 'webp'].includes(message.format ?? 'gif') || ![32,64,128,256].includes(message.colors ?? 256) || !Number.isFinite(message.quality ?? 0.9) || (message.quality ?? 0.9) < 0.1 || (message.quality ?? 0.9) > 1) throw new Error('SVG animation exceeds the local export limits.');
    job = message; canvas = new OffscreenCanvas(message.width, message.height);
    encoder = new AnimationEncoder(message.format ?? 'gif', canvas, message.colors ?? 256, message.quality ?? 0.9); index = 0;
    self.postMessage({ kind: 'frame', index }); return;
  }
  if (!job || !encoder || !canvas || message.index !== index || message.pixels.length !== job.width * job.height * 4) throw new Error('SVG frame sequence was interrupted. Retry the export.');
  const delay = animationFrameTime(index + 1, job.frames, job.duration, job.format) - animationFrameTime(index, job.frames, job.duration, job.format);
  self.postMessage({ kind: 'progress', value: Math.round(index / job.frames * 100), text: `Encoding ${(job.format ?? 'gif').toUpperCase()} · ${job.label ?? 'SVG'} frame ${index + 1}/${job.frames}` });
  await encoder.addFrame(delay, message.pixels);
  if (encoder.byteLength >= (job.format === 'webp' ? job.limit : MAX_INTERMEDIATE_BYTES)) throw new SizeError(job.format === 'webp' ? 'This SVG animation exceeds 15 MB. Choose smaller dimensions or a shorter clip.' : 'The intermediate GIF exceeds the local compression buffer. Choose smaller dimensions or a shorter clip.', job.format === 'webp' ? Math.floor(Math.max(job.width, job.height) * Math.sqrt(job.limit / (encoder.byteLength * job.frames / (index + 1))) * 0.9) : Math.floor(Math.max(job.width, job.height) * 0.65));
  index++;
  self.postMessage({ kind: 'progress', value: Math.round(index / job.frames * 100), text: `Rendering ${job.label ?? 'SVG'} · frame ${index}/${job.frames}` });
  if (index < job.frames) { self.postMessage({ kind: 'frame', index }); return; }
  let blob = encoder.finish();
  let optimizationNote = '';
  let outputFrames = job.frames;
  if (job.format !== 'webp') {
    const optimized = await optimizeGif(blob, job.limit, text => self.postMessage({ kind: 'progress', value: 100, text }));
    blob = optimized.blob; optimizationNote = optimized.note; outputFrames = optimized.frames;
  }
  if (blob.size > job.limit) throw new SizeError('This SVG animation exceeds 15 MB. Choose smaller dimensions.', Math.floor(Math.max(job.width, job.height) * Math.sqrt(job.limit / blob.size) * 0.9));
  const format = job.format ?? 'gif';
  self.postMessage({ kind: 'done', result: { blob, width: job.width, height: job.height, frames: outputFrames, duration: job.duration, extension: format, notes: [optimizationNote || `WebP quality ${Math.round((job.quality ?? 0.9) * 100)}%.`, `Rendered ${job.label ?? 'SVG'} clip from the start of its timeline.`, `Looping ${format.toUpperCase()}; the clip boundary may not match a complete animation cycle.`] } });
  job = undefined; encoder = undefined; canvas = undefined;
}
