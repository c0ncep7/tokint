export type TokenMedia = { field: string; uri: string };

// Prefer animation_url when present, with image as the first fallback. A field's name does not
// determine its format: animation_url can contain GIF, WebP, SVG, or other media.
const fields = ['animation_url', 'image', 'image_url', 'imageUrl', 'image_data', 'animationUrl', 'animation', 'video', 'video_url', 'audio', 'audio_url', 'media', 'content'];

export function tokenMedia(metadata: Record<string, unknown>): TokenMedia[] {
  const result: TokenMedia[] = [];
  const seen = new Set<string>();
  function add(field: string, value: unknown) {
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      const object = value as Record<string, unknown>;
      value = object.uri ?? object.url;
    }
    if (typeof value !== 'string' || !value.trim()) return;
    let uri = value.trim();
    if (field.endsWith('image_data') && /^\s*(?:<\?xml[^>]*>\s*)?(?:<!--[\s\S]*?-->\s*)*<svg[\s>]/i.test(uri)) {
      uri = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(uri)}`;
    }
    if (seen.has(uri)) return;
    seen.add(uri);
    result.push({ field, uri });
  }
  for (const field of fields) add(field, metadata[field]);
  const properties = metadata.properties;
  if (properties && typeof properties === 'object' && !Array.isArray(properties)) {
    const object = properties as Record<string, unknown>;
    for (const field of fields) add(`properties.${field}`, object[field]);
    if (Array.isArray(object.files)) object.files.forEach((file, i) => add(`properties.files[${i}]`, file));
  }
  return result;
}
