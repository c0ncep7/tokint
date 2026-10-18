import { optimizeGif, MAX_INTERMEDIATE_BYTES } from './gif-optimizer';
import { AnimationEncoder } from './animation-encoder';
import { animationSchedule, fitDimensions, MAX_ANIMATION_PIXELS, rasterHeader, SHARE_SOURCE_LIMIT, targetBytes, validateOptions, type ShareMessage, type ShareOptions, type ShareResult } from './share-core';

const send = (message: ShareMessage) => self.postMessage(message);
self.onmessage = (event: MessageEvent<{ blob: Blob; options?: ShareOptions }>) => {
  void convert(event.data.blob, event.data.options).then(result => { if (result) send({ kind: 'done', result }); }).catch(error => send({ kind: 'error', message: error instanceof Error ? error.message : 'Conversion failed. Try smaller dimensions.' }));
};
async function convert(blob: Blob, options?: ShareOptions): Promise<ShareResult | void> {
  if (options) validateOptions(options);
  if (blob.size > SHARE_SOURCE_LIMIT) throw new Error('The original exceeds the 100 MiB local conversion limit. Use a dedicated image editor.');
  const data = new Uint8Array(await blob.arrayBuffer());
  const header = rasterHeader(data);
  if (typeof ImageDecoder === 'undefined' || !await ImageDecoder.isTypeSupported(header.type)) throw new Error('This browser cannot decode this format for sharing. Try a current Chrome version.');
  const decoder = new ImageDecoder({ data, type: header.type, preferAnimation: true });
  try {
    await decoder.tracks.ready;
    await decoder.completed;
    const track = decoder.tracks.selectedTrack;
    if (!track) throw new Error('No image track found.');
    const frames = track.frameCount;
    send({ kind: 'info', info: { ...header, frames, bytes: blob.size } });
    // A metadata-only probe does not decode frames or generate an export.
    if (!options) return;
    if (!frames || frames > 1000 || frames * header.width * header.height > MAX_ANIMATION_PIXELS) throw new Error('This animation exceeds the local decoding budget (1000 frames / 160 million source pixels across frames). Use a dedicated editor for this file.');
    const animated = frames > 1;
    const limit = targetBytes(options, animated);
    const first = (await decoder.decode({ frameIndex: 0 })).image;
    const width = first.displayWidth, height = first.displayHeight;
    first.close();
    send({ kind: 'info', info: { width, height, frames, bytes: blob.size, type: header.type } });
    if (width * height > 32_000_000) throw new Error('Decoded image is too large to process safely.');
    const durations: number[] = [];
    if (animated) {
      let duration = 0;
      for (let i = 0; i < frames; i++) {
        const frame = (await decoder.decode({ frameIndex: i })).image;
        try { durations.push(frame.duration && frame.duration > 0 ? frame.duration / 1000 : 100); }
        finally { frame.close(); }
        duration += durations[i];
        if (duration > 600_000) throw new Error('Animations longer than 10 minutes exceed the local conversion limit.');
        send({ kind: 'progress', text: `Reading animation · frame ${i + 1}/${frames}`, value: Math.round((i + 1) / frames * 10) });
      }
    }
    const schedule = animated ? animationSchedule(durations, options.fps, options.format) : [];
    if (animated && schedule.length < 2) throw new Error('This frame rate would flatten the animation to a still image. Choose Original or a higher frame rate.');
    let edge = options.maxEdge;
    for (let attempt = 0; attempt < 4; attempt++) {
      const size = fitDimensions(width, height, edge);
      const canvas = new OffscreenCanvas(size.width, size.height);
      const ctx = canvas.getContext('2d', { willReadFrequently: animated })!;
      const draw = (frame: VideoFrame) => {
        ctx.fillStyle = options.background; ctx.fillRect(0, 0, size.width, size.height);
        ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = 'high';
        ctx.drawImage(frame, 0, 0, size.width, size.height);
      };
      const notes = [`${options.background === '#ffffff' ? 'White' : 'Black'} background for transparent areas.`];
      if (attempt) notes.push('Dimensions were reduced further to meet the file limit.');
      if (!animated) {
        const frame = (await decoder.decode({ frameIndex: 0 })).image;
        try { draw(frame); } finally { frame.close(); }
        for (const quality of [0.92, 0.84, 0.74, 0.62]) {
          send({ kind: 'progress', text: `Encoding JPEG · ${size.width} × ${size.height}`, value: 15 + attempt * 20 });
          const result = await canvas.convertToBlob({ type: 'image/jpeg', quality });
          if (result.type !== 'image/jpeg') throw new Error('JPEG encoding is unavailable in this browser.');
          if (result.size <= limit) return { blob: result, ...size, frames: 1, duration: 0, extension: 'jpg', notes: [...notes, `JPEG quality ${Math.round(quality * 100)}%.`] };
        }
      } else {
        const format = options.format ?? 'gif';
        const encoder = new AnimationEncoder(format, canvas, attempt ? 128 : 256, attempt ? 0.8 : 0.9);
        let writtenDuration = 0, tooLarge = false;
        for (let i = 0; i < schedule.length; i++) {
          const step = schedule[i];
          const frame = (await decoder.decode({ frameIndex: step.index })).image;
          try { draw(frame); } finally { frame.close(); }
          await encoder.addFrame(step.duration);
          writtenDuration += step.duration;
          send({ kind: 'progress', text: `Encoding ${format.toUpperCase()} · pass ${attempt + 1}/4 · frame ${i + 1}/${schedule.length}`, value: 10 + Math.round((attempt + (i + 1) / schedule.length) * 21) });
          if (encoder.byteLength >= (format === 'gif' ? MAX_INTERMEDIATE_BYTES : limit)) { tooLarge = true; break; }
        }
        if (!tooLarge) {
          let result = encoder.finish();
          let outputFrames = schedule.length;
          if (format === 'gif') {
            const optimized = await optimizeGif(result, limit, text => send({ kind: 'progress', text, value: 95 }));
            result = optimized.blob; outputFrames = optimized.frames; notes.push(optimized.note);
          }
          if (result.size <= limit) return { blob: result, ...size, frames: outputFrames, duration: writtenDuration, extension: format, notes: [...notes, `Looping ${format.toUpperCase()}.`, ...(schedule.length < frames ? [`Frames combined; full duration retained to ${format.toUpperCase()} timing precision.`] : [])] };
        }
      }
      if (Math.max(size.width, size.height) <= 64) break;
      edge = Math.max(1, Math.floor(Math.max(size.width, size.height) * 0.7));
    }
    throw new Error('Could not fit the complete media within the target size. Choose smaller dimensions, a lower animation frame rate. No truncated file was created.');
  } finally { decoder.close(); }
}
