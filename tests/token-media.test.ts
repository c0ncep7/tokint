import { test } from 'node:test';
import assert from 'node:assert/strict';
import { tokenMedia } from '../src/token-media';
import { embeddedMediaBlob } from '../src/downloads';
import { DEFAULTS, imageDataUri, readDataJson, resolveUri } from '../src/core';
import { readFile } from 'node:fs/promises';

test('distinct media stays selectable with image as the default and shared URLs deduplicated', () => {
  assert.deepEqual(tokenMedia({ animation_url: 'art.gif', image: ' art.png ', image_url: 'art.png', external_url: 'https://example.com', name: 'Token' }), [
    { field: 'image', uri: 'art.png' }, { field: 'animation_url', uri: 'art.gif' },
  ]);
});
test('inline SVG is available alongside image and preserves its markup', async () => {
  const svg = '<?xml version="1.0"?><svg xmlns="http://www.w3.org/2000/svg"><text>Café</text></svg>';
  const media = tokenMedia({ image: 'preview.png', image_data: svg });
  assert.equal(media[1].field, 'image_data');
  assert.equal(await embeddedMediaBlob(media[1].uri).text(), svg);
});
test('common media objects and properties.files work without treating arbitrary attributes as media', () => {
  assert.deepEqual(tokenMedia({ image: null, animation_url: ' ', audio_url: 42, properties: {
    image: { url: 'preview.png' }, files: [{ uri: 'movie.mp4', type: 'video/mp4' }, { url: 'art.webp' }, 'art.svg', null, {}, 5],
  }, attributes: [{ value: 'not-media.png' }] }), [
    { field: 'properties.image', uri: 'preview.png' },
    { field: 'properties.files[0]', uri: 'movie.mp4' },
    { field: 'properties.files[1]', uri: 'art.webp' },
    { field: 'properties.files[2]', uri: 'art.svg' },
  ]);
  assert.deepEqual(tokenMedia({ properties: [] }), []);
});

test('base64 token metadata retains both embedded image and animation bytes', async () => {
  const still = await readFile(new URL('./fixtures/wide.jpg', import.meta.url));
  const animation = await readFile(new URL('./fixtures/moving.gif', import.meta.url));
  const metadata = {
    image: `data:image/jpeg;base64,${still.toString('base64')}`,
    animation_url: `data:image/gif;base64,${animation.toString('base64')}`,
  };
  const tokenUri = `data:application/json;base64,${Buffer.from(JSON.stringify(metadata)).toString('base64')}`;
  const media = tokenMedia(readDataJson(tokenUri));
  assert.deepEqual(media.map(item => item.field), ['image', 'animation_url']);
  for (const [index, original] of [still, animation].entries()) {
    const uri = resolveUri(media[index].uri, DEFAULTS, tokenUri);
    assert.equal(imageDataUri(uri), true);
    assert.deepEqual(Buffer.from(await embeddedMediaBlob(uri).arrayBuffer()), original);
  }
});
