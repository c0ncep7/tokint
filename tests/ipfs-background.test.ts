import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULTS } from '../src/core';
import { gatewayReply } from '../src/ipfs-bridge';

test('IPFS shortcut navigates only on submission, respects disposition, and recovers from unavailable tokint', async () => {
  let entered: (text: string, disposition: string) => void = () => {};
  let changed: (text: string, suggest: (results: unknown[]) => void) => void = () => {};
  let calls = 0;
  let offline = false;
  let prefs = { ...DEFAULTS };
  const navigations: { url: string; active?: boolean; kind: string }[] = [];
  const fake = {
    omnibox: {
      onInputEntered: { addListener: (fn: typeof entered) => { entered = fn; } },
      onInputChanged: { addListener: (fn: typeof changed) => { changed = fn; } },
      onInputStarted: { addListener: () => {} },
      setDefaultSuggestion: async () => {},
    },
    storage: { local: { get: async () => ({ mainExtensionId: 'a'.repeat(32) }) } },
    runtime: {
      onMessageExternal: { addListener: () => {} },
      getURL: (file: string) => `chrome-extension://companion/${file}`,
      sendMessage: async (id: string, message: unknown) => {
        calls++; assert.equal(id, 'a'.repeat(32)); assert.deepEqual(message, { type: 'tokint-gateway' });
        if (offline) throw new Error('No receiving end');
        return gatewayReply(prefs);
      },
    },
    tabs: {
      update: async (args: { url: string }) => { navigations.push({ ...args, kind: 'update' }); },
      create: async (args: { url: string; active?: boolean }) => { navigations.push({ ...args, kind: 'create' }); },
    },
  };
  Object.assign(globalThis, { chrome: fake });
  await import('../src/ipfs-background');
  const cid = 'QmYwAPJzv5CZsnAzt8auVTLnEKjHhhtvE4s1wKpR1X4M8F';
  changed(cid, () => {}); assert.equal(calls, 0); assert.equal(navigations.length, 0);
  const turn = () => new Promise(resolve => setImmediate(resolve));
  entered(cid + '/a/file.svg', 'currentTab'); await turn();
  assert.equal(navigations.at(-1)?.kind, 'update'); assert.match(navigations.at(-1)!.url, /^https:\/\/gateway.pinata.cloud\/ipfs\//);
  prefs = { ...DEFAULTS, gatewayUrl: 'https://dweb.link', gatewayStyle: 'subdomain' };
  entered(cid, 'newForegroundTab'); await turn();
  assert.equal(navigations.at(-1)?.active, true); assert.match(navigations.at(-1)!.url, /\.ipfs\.dweb.link\/$/);
  entered(cid, 'newBackgroundTab'); await turn(); assert.equal(navigations.at(-1)?.active, false);
  const before = calls;
  entered('invalid', 'currentTab'); await turn(); assert.equal(calls, before);
  assert.match(navigations.at(-1)!.url, /options.html#error=/);
  offline = true;
  entered(cid, 'currentTab'); await turn();
  assert.match(new URLSearchParams(new URL(navigations.at(-1)!.url).hash.slice(1)).get('error')!, /Could not reach tokint/);
});
