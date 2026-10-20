import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CID } from 'multiformats/cid';
import { DEFAULTS, type Settings } from '../src/core';
import { saveSettings } from '../src/storage';
import { storageFixture } from './storage-fixture';

test('omnibox events route addresses, tokens and IPFS with the requested tab disposition', async () => {
  let entered: (text: string, disposition: string) => void = () => {};
  let changed: (text: string, suggest: (results: unknown[]) => void) => void = () => {};
  let storedReads = 0;
  let prefs: Settings = DEFAULTS;
  const fixture = storageFixture({ settings: prefs, settingsVersion: 2 });
  const storedGet = fixture.storage.local.get.bind(fixture.storage.local);
  fixture.storage.local.get = (async (...args: unknown[]) => {
    storedReads++;
    return storedGet(args[0] as string);
  }) as typeof fixture.storage.local.get;
  const navigations: { kind: string; url: string; active?: boolean }[] = [];
  const suggestions: { description: string }[] = [];
  const fake = {
    omnibox: {
      onInputEntered: { addListener: (fn: typeof entered) => { entered = fn; } },
      onInputChanged: { addListener: (fn: typeof changed) => { changed = fn; } },
      onInputStarted: { addListener: () => {} },
      setDefaultSuggestion: async (value: { description: string }) => { suggestions.push(value); },
    },
    runtime: { getURL: (file: string) => `chrome-extension://test/${file}` },
    storage: fixture.storage,
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
  let expected = 0;
  const turn = async () => {
    expected++;
    const end = Date.now() + 3000;
    while (navigations.length < expected && Date.now() < end) await new Promise(resolve => setTimeout(resolve, 5));
    assert.equal(navigations.length, expected);
  };
  entered(contract, 'currentTab'); await turn();
  assert.deepEqual(navigations.at(-1), { kind: 'update', url: `https://etherscan.io/address/${contract}#readContract` });
  entered(`${contract} 9007199254740993123`, 'newForegroundTab'); await turn();
  const token = navigations.at(-1)!;
  assert.equal(token.active, true);
  assert.equal(new URLSearchParams(new URL(token.url).hash.slice(1)).get('token'), '9007199254740993123');
  const cid = CID.parse('QmYwAPJzv5CZsnAzt8auVTLnEKjHhhtvE4s1wKpR1X4M8F').toV1().toString();
  entered(`ipfs://${cid}/metadata.json`, 'newBackgroundTab'); await turn();
  assert.deepEqual(navigations.at(-1), { kind: 'create', url: `https://gateway.pinata.cloud/ipfs/${cid}/metadata.json`, active: false });
  prefs = { ...DEFAULTS, gatewayUrl: 'https://dweb.link', gatewayStyle: 'subdomain' };
  await saveSettings(prefs);
  entered(`https://gateway.pinata.cloud/ipfs/${cid}/nested/art%20work.svg?download=1#frame`, 'currentTab'); await turn();
  assert.deepEqual(navigations.at(-1), { kind: 'update', url: `https://${cid}.ipfs.dweb.link/nested/art%20work.svg?download=1#frame` });
  entered(`${cid}/nested/art.svg`, 'newForegroundTab'); await turn();
  assert.deepEqual(navigations.at(-1), { kind: 'create', url: `https://${cid}.ipfs.dweb.link/nested/art.svg`, active: true });
  entered('invalid text', 'currentTab'); await turn();
  assert.equal(new URLSearchParams(new URL(navigations.at(-1)!.url).hash.slice(1)).has('error'), true);
  fixture.local.vaultHeader = { version: 1 };
  entered(`ipfs://${cid}/metadata.json`, 'currentTab'); await turn();
  assert.deepEqual(navigations.at(-1), { kind: 'update', url: `https://gateway.pinata.cloud/ipfs/${cid}/metadata.json` });
  assert.equal(fixture.local.vaultHeader, undefined);
});
