import { test } from 'node:test';
import assert from 'node:assert/strict';
import { toolbarPage, toolbarDestination, type TabAccess } from '../src/toolbar';
const source = 'https://opensea.io/item/ethereum/0xc43ec24ec4a968ff3ceafdf9a35e2c8118b4cfb2/87';
const noAccess: TabAccess = { get: async () => { throw new Error('No access'); }, query: async () => [] };

test('toolbar refreshes the clicked tab URL before launching, including missing click URLs', async () => {
  let seen: number | undefined;
  const tabs: TabAccess = { get: async id => { seen = id; return { id, windowId: 1, url: source }; }, query: async () => { throw new Error('must not query'); } };
  for (const snapshot of [undefined, 'https://opensea.io/collection/test']) {
    const page = await toolbarPage({ id: 7, windowId: 1, url: snapshot }, tabs);
    assert.equal(seen, 7); assert.deepEqual(page, { url: source, via: 'refreshed-tab' });
    const hash = new URLSearchParams(toolbarDestination(page).split('#')[1]);
    assert.equal(hash.get('token'), '87'); assert.equal(hash.get('run'), '1');
  }
});
test('toolbar falls back to the click snapshot when refreshing is unavailable', async () => {
  assert.deepEqual(await toolbarPage({ id: 7, windowId: 1, url: source }, noAccess), { url: source, via: 'click-event' });
});
test('toolbar can recover the exact clicked tab through the active-tab query', async () => {
  const tabs: TabAccess = { ...noAccess, query: async query => { assert.deepEqual(query, { active: true, windowId: 1 }); return [{ id: 7, windowId: 1, url: source }]; } };
  assert.deepEqual(await toolbarPage({ id: 7, windowId: 1 }, tabs), { url: source, via: 'active-tab' });
});
test('toolbar never substitutes an unrelated tab if the clicked one is unavailable', async () => {
  const page = await toolbarPage({ id: 7, windowId: 1 }, { ...noAccess, query: async () => [{ id: 8, windowId: 1, url: source }] });
  assert.equal(page.via, 'unavailable');
  const hash = new URLSearchParams(toolbarDestination(page).split('#')[1]);
  assert.match(hash.get('error')!, /did not provide/);
  assert.equal(hash.has('run'), false); assert.equal(hash.has('contract'), false);
});
test('toolbar uses a pending navigation URL rather than a previous item', async () => {
  const page = await toolbarPage({ id: 7, windowId: 1 }, { ...noAccess, get: async () => ({ id: 7, windowId: 1, url: source, pendingUrl: source.replace('/87', '/88') }) });
  assert.equal(new URLSearchParams(toolbarDestination(page).split('#')[1]).get('token'), '88');
});
test('toolbar diagnostics omit unrelated URLs and OpenSea query parameters', () => {
  const url = toolbarDestination({ url: source + '?private=value#details', via: 'refreshed-tab' });
  assert.equal(new URLSearchParams(url.split('#')[1]).get('source'), source);
  assert.equal(url.includes('private'), false);
  const other = toolbarDestination({ url: 'https://example.com/private?secret=value', via: 'click-event' });
  assert.equal(other.includes('example'), false); assert.equal(other.includes('secret'), false);
});
test('unsupported OpenSea pages and networks report a failed handoff rather than a saved contract', () => {
  for (const url of ['https://opensea.io/collection/test', source.replace('/ethereum/', '/base/')]) {
    const hash = new URLSearchParams(toolbarDestination({ url, via: 'refreshed-tab' }).split('#')[1]);
    assert.ok(hash.has('error')); assert.equal(hash.has('run'), false); assert.equal(hash.has('contract'), false);
  }
});
test('generic toolbar handoff auto-runs the token without retaining private path/query details', () => {
  const hash = new URLSearchParams(toolbarDestination({ url: 'https://superrare.com/private/artwork/eth/0xA930ef880909b589a525ffd9Bd8E60854A2E0A02/1?secret=value#fragment', via: 'refreshed-tab' }).split('#')[1]);
  assert.equal(hash.get('contract'), '0xA930ef880909b589a525ffd9Bd8E60854A2E0A02');
  assert.equal(hash.get('token'), '1'); assert.equal(hash.get('run'), '1');
  assert.equal(hash.get('source'), 'https://superrare.com');
  assert.equal(hash.toString().includes('private'), false); assert.equal(hash.toString().includes('secret'), false);
});
