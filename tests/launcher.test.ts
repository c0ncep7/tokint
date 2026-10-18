import { test } from 'node:test';
import assert from 'node:assert/strict';

test('popup captures the active tab, preserves large IDs, and offers retry on launch failures', async () => {
  const status = { textContent: '' };
  let click: () => void = () => {};
  const retry = { hidden: true, addEventListener: (_: string, listener: () => void) => { click = listener; } };
  const contract = '0xc43ec24ec4a968ff3ceafdf9a35e2c8118b4cfb2';
  const token = '9007199254740993123';
  let failQuery = true;
  let failCreate = false;
  let missingTab = false;
  let closed = 0;
  const opened: string[] = [];
  Object.assign(globalThis, {
    document: { querySelector: (selector: string) => selector === '#launch-status' ? status : retry },
    window: { close: () => { closed++; } },
    chrome: {
      runtime: { getURL: (path: string) => `chrome-extension://test/${path}` },
      tabs: {
        query: async (query: unknown) => {
          assert.deepEqual(query, { active: true, currentWindow: true });
          if (failQuery) throw new Error('Tab access unavailable');
          return missingTab ? [] : [{ id: 7, windowId: 1 }];
        },
        get: async (id: number) => {
          assert.equal(id, 7);
          return { id, url: `https://opensea.io/item/ethereum/${contract}/${token}` };
        },
        create: async (options: { url: string; active: boolean }) => {
          if (failCreate) throw new Error('Cannot create tab');
          assert.equal(options.active, true);
          opened.push(options.url);
        },
      },
    },
  });
  const turn = () => new Promise(resolve => setImmediate(resolve));
  await import('../src/launcher'); await turn();
  assert.match(status.textContent, /Tab access unavailable/);
  assert.equal(retry.hidden, false);
  assert.equal(closed, 0);
  failQuery = false; failCreate = true;
  click(); await turn();
  assert.match(status.textContent, /Cannot create tab/);
  assert.equal(retry.hidden, false);
  assert.equal(closed, 0);
  failCreate = false;
  click(); click(); await turn();
  assert.equal(opened.length, 1, 'repeated clicks cannot create duplicate inspector tabs');
  assert.equal(closed, 1);
  const params = new URLSearchParams(new URL(opened[0]).hash.slice(1));
  assert.equal(params.get('contract')?.toLowerCase(), contract);
  assert.equal(params.get('token'), token);
  assert.equal(params.get('run'), '1');
  assert.equal(retry.hidden, true);
  missingTab = true;
  click(); await turn();
  const absent = new URLSearchParams(new URL(opened[1]).hash.slice(1));
  assert.equal(absent.get('handoff'), 'unavailable');
  assert.equal(absent.has('run'), false);
  assert.ok(absent.get('error'));
});
