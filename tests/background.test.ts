import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CID } from 'multiformats/cid';
import { DEFAULTS } from '../src/core';

test('omnibox events route addresses, tokens and IPFS with the requested tab disposition', async () => {
  let entered: (text: string, disposition: string) => void = () => {};
  let changed: (text: string, suggest: (results: unknown[]) => void) => void = () => {};
  let storedReads = 0;
  const navigations: { kind: string; url: string; active?: boolean }[] = [];
  const suggestions: { description: string }[] = [];
  const fake = {
    omnibox: {
      onInputEntered: { addListener: (fn: typeof entered) => { entered = fn; } },
      onInputChanged: { addListener: (fn: typeof changed) => { changed = fn; } },
      onInputStarted: { addListener: () => {} },
      setDefaultSuggestion: async (value: { description: string }) => { suggestions.push(value); },
    },
    runtime: { onMessageExternal: { addListener: () => {} }, getURL: (file: string) => `chrome-extension://test/${file}` },
    storage: { local: { get: async () => { storedReads++; return { settings: DEFAULTS, settingsVersion: 2 }; } } },
    tabs: {
      get: async () => { throw new Error('Tab unavailable'); },
      query: async () => [],
      update: async (args: { url: string }) => { navigations.push({ kind: 'update', ...args }); },
      create: async (args: { url: string; active?: boolean }) => { navigations.push({ kind: 'create', ...args }); },
    },
  };
  Object.assign(globalThis, { chrome: fake });
  await import('../src/background');
  const contract = '0x0000000000000000000000000000000000000001';
  changed(`${contract} 1`, () => {});
  assert.match(suggestions.at(-1)!.description, /metadata/);
  assert.equal(storedReads, 0);
  assert.equal(navigations.length, 0);
  const turn = () => new Promise(resolve => setImmediate(resolve));
  entered(contract, 'currentTab'); await turn();
  assert.deepEqual(navigations.at(-1), { kind: 'update', url: `https://etherscan.io/address/${contract}#readContract` });
  entered(`${contract} 9007199254740993123`, 'newForegroundTab'); await turn();
  const token = navigations.at(-1)!;
  assert.equal(token.active, true);
  assert.equal(new URLSearchParams(new URL(token.url).hash.slice(1)).get('token'), '9007199254740993123');
  const cid = CID.parse('QmYwAPJzv5CZsnAzt8auVTLnEKjHhhtvE4s1wKpR1X4M8F').toV1().toString();
  entered(`ipfs://${cid}/metadata.json`, 'newBackgroundTab'); await turn();
  assert.deepEqual(navigations.at(-1), { kind: 'create', url: `https://gateway.pinata.cloud/ipfs/${cid}/metadata.json`, active: false });
  entered('invalid text', 'currentTab'); await turn();
  assert.equal(new URLSearchParams(new URL(navigations.at(-1)!.url).hash.slice(1)).has('error'), true);
});
