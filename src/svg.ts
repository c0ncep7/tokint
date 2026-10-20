import { fitDimensions, MAX_SOURCE_PIXELS, targetBytes, type ShareOptions, type ShareResult } from './share-core';

const NS = 'http://www.w3.org/2000/svg';
const MAX_SVG_BYTES = 2 * 1024 * 1024;
const animationTags = new Set(['animate', 'animateTransform', 'animateMotion', 'set']);
// Embedded raster images are self-contained and can be decoded by the SVG
// image renderer. Keep network resources and nested documents out of exports.
function embeddedRaster(value: string): boolean {
  return /^data:image\/(?:png|jpeg|gif|webp|avif|bmp|x-icon|vnd\.microsoft\.icon)(?:;[^,]*)?,/i.test(value.trim());
}
function localReference(value: string): boolean { return /^#[^\s#]+$/.test(value.trim()); }
function withoutLocalUrls(value: string): string {
  return value.replace(/url\s*\(\s*(?:"([^"]*)"|'([^']*)'|([^'")\s]*))\s*\)/gi,
    (match, double: string | undefined, single: string | undefined, unquoted: string | undefined) => {
      const url = double ?? single ?? unquoted ?? '';
      return localReference(url) || embeddedRaster(url) ? '' : match;
    });
}
type Timing = { node: Element; begin: number[]; end?: number[] };
type CssTiming = { style: CSSStyleDeclaration; delays: number[]; priority: string };
export type SvgPlan = {
  width: number; height: number; animated: boolean; duration: number;
  frame: (seconds: number, width: number, height: number) => string;
};
function unsupported(detail: string): never { throw new Error(`${detail} Use the original SVG download for this artwork.`); }
function clock(value: string): number {
  const match = /^([+-]?(?:\d+(?:\.\d*)?|\.\d+))(ms|s|min|h)?$/.exec(value.trim());
  if (!match) return unsupported('This SVG uses event-based or unsupported animation timing.');
  const seconds = Number(match[1]) * ({ ms: 0.001, s: 1, min: 60, h: 3600 }[match[2] || 's']!);
  if (!Number.isFinite(seconds)) unsupported('SVG timing is outside the supported range.');
  return seconds;
}
function times(value: string): number[] { return value.split(';').map(clock); }

// Parse in a detached XML document. Never insert artwork into the extension DOM.
// Render only through an image element, which cannot execute SVG scripts.
async function readSvgDocument(blob: Blob) {
  if (blob.size > MAX_SVG_BYTES) unsupported('SVG export is limited to 2 MiB of markup.');
  const text = await blob.text();
  if (/<!DOCTYPE|<!ENTITY|<\?xml-stylesheet/i.test(text)) unsupported('SVG document entities and linked stylesheets are not supported.');
  const doc = new DOMParser().parseFromString(text, 'image/svg+xml');
  const root = doc.documentElement;
  if (doc.querySelector('parsererror') || root.localName !== 'svg' || root.namespaceURI !== NS) throw new Error('The SVG could not be parsed.');
  const viewBox = (root.getAttribute('viewBox') || '').trim().split(/[\s,]+/).map(Number);
  const dimension = (name: string, fallback: number) => {
    const value = root.getAttribute(name) || '';
    const match = /^(\d+(?:\.\d*)?|\.\d+)(?:px)?$/.exec(value.trim());
    return match ? Number(match[1]) : fallback;
  };
  const width = dimension('width', viewBox.length === 4 ? viewBox[2] : NaN);
  const height = dimension('height', viewBox.length === 4 ? viewBox[3] : NaN);
  if (![width, height].every(v => Number.isFinite(v) && v > 0) || width * height > MAX_SOURCE_PIXELS || Math.max(width, height) > 32768) unsupported('SVG export needs valid width/height or a viewBox, within 32 megapixels.');
  return { root, width, height };
}

export async function svgDimensions(blob: Blob) {
  const { width, height } = await readSvgDocument(blob);
  return { width, height };
}

export async function prepareSvg(blob: Blob): Promise<SvgPlan> {
  const { root, width, height } = await readSvgDocument(blob);
  const nodes = [root, ...root.querySelectorAll('*')];
  if (nodes.length > 10_000) unsupported('This SVG has too many elements for local export.');
  const byId = new Map(nodes.filter(node => node.hasAttribute('id')).map(node => [node.getAttribute('id')!, node]));
  const smil: Timing[] = [];
  const sheets: { node: Element; sheet: CSSStyleSheet }[] = [];
  const css: CssTiming[] = [];
  let duration = 0;
  let hasKeyframes = false;
  let hasCssAnimation = false;
  const inspectStyle = (style: CSSStyleDeclaration) => {
    const properties = Array.from(style);
    if (!properties.some(p => p.startsWith('animation'))) return;
    const names = style.animationName.split(',').map(v => v.trim());
    if (!names.length || names.some(name => !name || name === 'none') || !style.animationDuration) unsupported('SVG CSS animation name and duration must be declared together.');
    const supported = new Set(['animation', 'animation-name', 'animation-duration', 'animation-delay', 'animation-timing-function', 'animation-iteration-count', 'animation-direction', 'animation-fill-mode', 'animation-play-state', 'animation-timeline', 'animation-range-start', 'animation-range-end']);
    if (properties.some(p => p.startsWith('animation') && !supported.has(p)) || (style.getPropertyValue('animation-timeline') && style.getPropertyValue('animation-timeline') !== 'auto') || /var\(|inherit|revert|unset/.test(style.cssText)) unsupported('This SVG uses unsupported CSS animation timing.');
    const durations = style.animationDuration.split(',').map(clock);
    const delays = style.animationDelay ? style.animationDelay.split(',').map(clock) : [0];
    const counts = (style.animationIterationCount || '1').split(',').map(v => v.trim());
    const directions = (style.animationDirection || 'normal').split(',').map(v => v.trim());
    if (durations.some(v => v <= 0) || (style.animationPlayState && style.animationPlayState.split(',').some(v => v.trim() !== 'running'))) unsupported('Paused or zero-duration CSS animations cannot be exported as a clip.');
    for (let i = 0; i < names.length; i++) {
      const count = counts[i % counts.length];
      if (count !== 'infinite' && (!Number.isFinite(Number(count)) || Number(count) <= 0)) unsupported('This SVG has an unsupported animation repeat count.');
      const cycles = count === 'infinite' ? (directions[i % directions.length].includes('alternate') ? 2 : 1) : Number(count);
      duration = Math.max(duration, Math.max(0, delays[i % delays.length]) + durations[i % durations.length] * cycles);
    }
    // Use one delay per animation so list repetition remains correct.
    css.push({ style, delays: names.map((_, i) => delays[i % delays.length]), priority: 'important' });
    hasCssAnimation = true;
  };
  for (const node of nodes) {
    if (node.namespaceURI !== NS || ['script', 'foreignObject', 'a'].includes(node.localName)) unsupported('Scripted SVG, embedded HTML, and interactive links are not supported for export.');
    for (const attr of Array.from(node.attributes)) {
      if (/^on/i.test(attr.localName) || attr.localName === 'base') unsupported('Scripted or interactive SVG is not supported for export.');
      if (attr.localName === 'href' && !localReference(attr.value)
        && !(['image', 'feImage'].includes(node.localName) && embeddedRaster(attr.value))) unsupported('External SVG resources are not supported for export.');
      if (/url\s*\(/i.test(withoutLocalUrls(attr.value))) unsupported('External SVG resources are not supported for export.');
    }
    if (node.localName.startsWith('animate') && !animationTags.has(node.localName)) unsupported('This SVG animation element is not supported.');
    if (animationTags.has(node.localName)) {
      const attribute = node.getAttribute('attributeName') || '';
      if (/^(?:xlink:)?href$/i.test(attribute)) {
        const targetRef = node.getAttribute('href') || node.getAttributeNS('http://www.w3.org/1999/xlink', 'href');
        const target = targetRef ? byId.get(targetRef.slice(1)) : node.parentElement;
        const references = [node.getAttribute('values'), node.getAttribute('from'), node.getAttribute('to')].filter((value): value is string => value !== null).flatMap(value => value.split(';').map(part => part.trim()));
        if (node.localName !== 'animate' || target?.localName !== 'use' || !references.length || node.hasAttribute('by') || references.some(value => !/^#[^\s#]+$/.test(value) || !byId.has(value.slice(1)))) unsupported('Only animations between existing internal SVG shapes are supported for href changes.');
      } else if (/href|style|class|^on|base/i.test(attribute)) unsupported('This SVG animates document references or styles that cannot be safely sampled.');
      const begin = times(node.getAttribute('begin') || '0s');
      const end = node.hasAttribute('end') ? times(node.getAttribute('end')!) : undefined;
      const durText = node.getAttribute('dur');
      const dur = durText ? clock(durText) : node.localName === 'set' ? 0 : unsupported('This SVG animation has no explicit duration.');
      if (dur < 0) unsupported('This SVG animation has an invalid duration.');
      const countText = node.getAttribute('repeatCount') || '1';
      const count = countText === 'indefinite' ? 1 : Number(countText);
      if (!Number.isFinite(count) || count <= 0) unsupported('This SVG has an unsupported repeat count.');
      if (node.hasAttribute('repeatDur') && node.getAttribute('repeatDur') !== 'indefinite') clock(node.getAttribute('repeatDur')!);
      duration = Math.max(duration, ...begin.map(t => Math.max(0, t) + dur * count), ...(end || [0]));
      smil.push({ node, begin, end });
    }
    if (node.hasAttribute('style')) inspectStyle((node as SVGElement).style);
    if (node.localName === 'style') {
      const source = node.textContent || '';
      if (/@import|@font-face|url\s*\(|\\|:hover|:active|:focus/i.test(withoutLocalUrls(source))) unsupported('Linked resources or interactive CSS are not supported for SVG export.');
      const sheet = new CSSStyleSheet(); sheet.replaceSync(source);
      const inspectRules = (rules: CSSRuleList, depth = 0) => {
        if (depth > 32) unsupported('SVG CSS nesting exceeds the local export limit.');
        for (const rule of Array.from(rules)) {
          if (rule instanceof CSSKeyframesRule) { hasKeyframes = true; continue; }
          if (rule instanceof CSSMediaRule || rule instanceof CSSSupportsRule) {
            // Keep conditions intact: the SVG image viewport, not the extension
            // window, decides which responsive rules apply to each output frame.
            inspectRules(rule.cssRules, depth + 1); continue;
          }
          if (!(rule instanceof CSSStyleRule)) unsupported('SVG export supports style rules, keyframes, @media and @supports groups.');
          inspectStyle(rule.style);
        }
      };
      inspectRules(sheet.cssRules);
      sheets.push({ node, sheet });
    }
  }
  if (hasKeyframes && !hasCssAnimation) unsupported('This SVG has keyframes without a supported animation declaration.');
  const animated = smil.length > 0 || hasCssAnimation;
  const suggested = animated ? Math.min(60, Math.max(0.1, Math.ceil((duration || 3) * 10) / 10)) : 0;
  return {
    width, height, animated, duration: suggested,
    frame(seconds, outWidth, outHeight) {
      root.setAttribute('width', String(outWidth)); root.setAttribute('height', String(outHeight));
      if (!root.hasAttribute('viewBox')) root.setAttribute('viewBox', `0 0 ${width} ${height}`);
      for (const item of smil) {
        item.node.setAttribute('begin', item.begin.map(t => `${t - seconds}s`).join(';'));
        if (item.end) item.node.setAttribute('end', item.end.map(t => `${t - seconds}s`).join(';'));
      }
      for (const item of css) {
        item.style.setProperty('animation-delay', item.delays.map(t => `${t - seconds}s`).join(','), item.priority);
        item.style.setProperty('animation-play-state', 'paused', item.priority);
      }
      for (const item of sheets) item.node.textContent = Array.from(item.sheet.cssRules, rule => rule.cssText).join('\n');
      return new XMLSerializer().serializeToString(root);
    },
  };
}

export async function svgPixels(plan: SvgPlan, seconds: number, width: number, height: number, background: string, signal: AbortSignal): Promise<ImageData> {
  signal.throwIfAborted();
  const url = URL.createObjectURL(new Blob([plan.frame(seconds, width, height)], { type: 'image/svg+xml' }));
  const image = new Image();
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await new Promise<void>((resolve, reject) => {
      const abort = () => finish(new DOMException('SVG export cancelled', 'AbortError'));
      const finish = (error?: Error) => { signal.removeEventListener('abort', abort); if (timer) clearTimeout(timer); error ? reject(error) : resolve(); };
      signal.addEventListener('abort', abort, { once: true });
      image.onload = () => finish(); image.onerror = () => finish(new Error('The SVG frame could not be rendered. Use the original download.'));
      timer = setTimeout(() => finish(new Error('SVG frame rendering timed out. Try smaller dimensions.')), 5000);
      image.src = url;
    });
    signal.throwIfAborted();
    const canvas = document.createElement('canvas'); canvas.width = width; canvas.height = height;
    const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
    ctx.fillStyle = background; ctx.fillRect(0, 0, width, height); ctx.drawImage(image, 0, 0, width, height);
    return ctx.getImageData(0, 0, width, height);
  } finally { if (timer) clearTimeout(timer); image.removeAttribute('src'); URL.revokeObjectURL(url); }
}

export function svgExportSize(plan: Pick<SvgPlan, 'width' | 'height' | 'animated'>, options: ShareOptions, seconds: number) {
  const size = fitDimensions(plan.width, plan.height, options.maxEdge, true);
  const fps = options.fps || 20;
  if (!Number.isFinite(seconds) || seconds < 0.1 || seconds > 60) throw new Error('Choose an SVG clip length from 0.1 to 60 seconds.');
  const duration = plan.animated ? Math.round(seconds * 100) * 10 : 0;
  const frames = plan.animated ? Math.max(2, Math.min(Math.floor(duration / 20), Math.ceil(seconds * fps))) : 1;
  return { ...size, frames, duration };
}

export async function staticSvgResult(plan: SvgPlan, options: ShareOptions, signal: AbortSignal): Promise<ShareResult> {
  const size = fitDimensions(plan.width, plan.height, options.maxEdge, true);
  const pixels = await svgPixels(plan, 0, size.width, size.height, options.background, signal);
  const canvas = new OffscreenCanvas(size.width, size.height); canvas.getContext('2d')!.putImageData(pixels, 0, 0);
  for (const quality of [0.92, 0.84, 0.74, 0.62]) {
    const blob = await canvas.convertToBlob({ type: 'image/jpeg', quality }); signal.throwIfAborted();
    if (blob.size <= targetBytes(options, false)) return { blob, ...size, extension: 'jpg', frames: 1, duration: 0, notes: ['Rendered from SVG.', `${options.background === '#ffffff' ? 'White' : 'Black'} background.`] };
  }
  throw new Error('Could not fit this SVG within 5 MB. Choose smaller dimensions.');
}
