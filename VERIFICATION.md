# Release preparation verification

Updated: 2026-10-20 for version **1.0.1**. These are implementation and test
results, not Chrome Web Store approval. Earlier dated results remain below as history.

## 1.0.1 release checks: 2026-10-20

- `npm run test:release` passed: strict TypeScript, **134 unit tests**, production
  build, inspector (44), media selection/HTML, sharing (48), cache (15), Alchemy
  (15), configuration, toolbar actions, offline JPEG/GIF/WebP, real-server security,
  and encrypted-vault browser checks. Tests ran in disposable Chrome for Testing
  **153.0.8010.12** profiles. The installed browser works when launched outside
  the execution sandbox; earlier sandbox launch failures were environmental.
- `npm run test:live` passed for Loot #1, The Memes #410 (direct Arweave metadata),
  and BAYC #1 (IPFS metadata). Runtime `npm audit --omit=dev --audit-level=high`
  reported **0 known vulnerabilities** on this date.
- The vault uses Web Crypto AES-256-GCM with random 96-bit nonces, authenticated
  record purposes, PBKDF2-HMAC-SHA-256 (600,000 iterations, random 128-bit salt),
  and a separate HMAC-SHA-256 key for opaque cache identities. The passphrase is
  never persisted. Derived keys live in trusted-context `chrome.storage.session`.
  Persistent preferences and complete cached records/media are encrypted.
- Tests cover nonce uniqueness, purpose binding, altered ciphertext/wrong key
  rejection, preference and legacy IndexedDB migration, retry after migration
  failure, byte-identical media restoration, and absence of plaintext fixture data
  or unlock keys in local stores. A full browser close/relaunch loses the key,
  rejects the wrong passphrase, and restores data with the correct passphrase.
  Locking reloads all open pages and removes visible decrypted values.
- SVG parsing now uses a disconnected XML fragment with an inert namespace,
  preserving strict XML checks without attaching artwork to a document. This
  avoids native Chrome CSP warnings from SVG style elements and attributes.
  The browser conversion suite explicitly rejects CSP console errors; static,
  SMIL/CSS animated, embedded-raster, hostile and malformed SVG cases are covered.
  The inspector/media/sharing/cache/Alchemy and security suites were rerun after
  this correction. Stable Chrome converted Loot SVG to 2000 × 2000 JPEG and its
  Extensions panel showed no Errors entry after the test.
- Inspector and Settings controls stay inert until saved data initializes. Browser
  fixtures wait for that boundary before submitting inputs. The cache retains
  offline reuse, expiry, cross-tab updates, stale-request protection and atomic
  quota failure behavior. Network fetches retain `cache: no-store`.
- Native stable **Google Chrome 155.0.8059.82** was tested in a separate signed-out
  `TOKINT Release Test` profile. The extension loaded unpacked and displayed 1.0.1;
  vault creation migrated the earlier test token. Actual `tokint` + Tab token
  lookups loaded ERC-721 Loot #1 and ERC-1155 Freedom to Retract #410. Refresh
  fetched the live sample, and the toolbar on its supported OpenSea URL opened
  the correct token. An IPFS command opened Pinata and displayed the JSON; a bare contract opened
  Etherscan at Read Contract.
- Stable Chrome downloaded the original 19,733,254-byte PNG with SHA-256
  `31daa4d1fca161b68aac81bc6a39e468eafbf5653f77438feddd60472541c4ed`,
  matching the recorded source. The local JPEG was 1121 × 2000, 891,791 bytes.
  Native optional-host denial displayed an actionable retry. With the publisher's
  explicit approval, Chrome's **Allow** granted `eth.drpc.org` access in the
  disposable profile; a live Loot #1 lookup then loaded its SVG and metadata
  through that provider. Both native permission paths passed.

## Converted download filenames: 2026-10-19

- Converted JPEG, GIF and WebP files now use
  `contract--id--title--web.extension`. The title comes from the loaded token's
  metadata, is lowercased and hyphenated, and remains associated with that token
  when form fields change or media selection switches.
- Filename sanitization removes unsafe characters, preserves Unicode letters,
  limits the title to 80 UTF-8 bytes, and uses `untitled` when no usable title is
  available. Full contract addresses and decimal token IDs are retained. Original
  media filenames retain their existing format.
- TypeScript, the production build and **130 unit tests** passed, including the
  requested `freedom-to-retract` example, unsafe/missing titles, large token IDs,
  and long Unicode titles. The **46 sharing browser checks** passed, including
  actual JPEG/GIF/WebP downloads and SVG exports with the new names.

## Arweave and icon fix: 2026-10-19

- The reported contract `0x33fd426905f149f8376e227d0c9d3340aad17af1`, token 410,
  returns an Arweave metadata URL whose root gateway responds with a 302 to its
  transaction-specific subdomain. Content GETs now calculate that documented
  destination directly, preserving paths/query/fragment and checking destination
  permission before any request. RPC URLs, unrelated hosts and gateway API routes
  are unchanged. General HTTP redirects remain blocked.
- Regenerated the current three-bar logo at 16/32/48/128 px and switched toolbar,
  extension-management and page icons to `tokint-brand-*.png` asset names. Reload
  the installed unpacked extension to apply the manifest/icon references.
- TypeScript, the build, and **129 unit tests** passed. The inspector browser
  suite passed **44 checks**, including root-gateway 302 fixtures for the reported
  token and its artwork. The real-server security suite passed with permission,
  redirect-chain, POST body, metadata and preview protections retained.
- A live lookup in an isolated Chrome for Testing 153.0.8010.12 profile loaded
  **Freedom to Retract**, its metadata, and **2354 × 4200** artwork. Request logs
  confirmed both content requests used direct transaction subdomains. The new
  toolbar PNGs decoded at their manifest sizes; a screenshot was inspected.
- The reported token's metadata check is now included in `test:live` for future
  releases. The full public-provider test script and the separately scheduled
  manual publication checklist were not rerun in this follow-up.

## Current changes

- Consolidated all address-bar commands under `tokint` + Tab. Removed companion
  sources, manifests, external messaging, pairing controls, and obsolete tests.
- Added a manifest-at-root Chrome Web Store ZIP, retaining the manual-install ZIP
  and source archive. Packaging checks versions, entry points, icons, notices,
  license and privacy documents; source roots exclude local profiles/configuration.
- Selected GPL-2.0-only, included dependency notices, and added pinned Gifsicle C,
  wrapper and compiler-integration source/build materials with provenance hashes.
- Added the canonical privacy policy, Settings/Help links, dashboard permission
  justifications, data-use declarations, and HTML sandbox reviewer notes.
- Restricted remote endpoints/resources to HTTPS, retaining explicit loopback
  HTTP support for local services. Numeric/encoded loopback aliases are rejected.

## Release-preparation checks: 2026-10-18

- Strict TypeScript, 127 unit tests, and the production build passed.
- Full browser regression run passed: inspector (43 checks), media selection/HTML
  sandbox, sharing (46 checks), cache (15), Alchemy (15), configuration, actual
  toolbar actions, offline conversion, and security. The final configuration
  suite passed 8 checks.
- A targeted browser check found Chromium rejects IPv6 literals in CSP host
  sources. IPv6 HTTP support was removed; real localhost and 127.0.0.1 fetches
  passed without invalid-source warnings. Settings and Help both open the bundled
  privacy policy. Configuration/security suites were rerun after this correction.
- Store/manual/source ZIP integrity, root layout, release checksums, canonical
  policy/license bytes, single-extension manifest, and vendored source hashes
  passed independent Python ZIP/hash checks. Five packaging regressions passed,
  including invalid Chrome versions and unsafe/duplicate archive paths.
- Gifsicle's archived preferred wrapper source reproduces the shipped worker
  runtime byte-for-byte using UglifyJS 3.16.1. The packaged WASM matches both the
  wrapper source binary and the original compiler package. Archive hashes and
  paths were checked. A fresh C-to-WASM rebuild was not performed; see
  `vendor/gifsicle/README.txt` and `PROVENANCE.json`.

Browser checks use Chrome for Testing 153.0.8010.12 with isolated temporary
profiles, outside the filesystem sandbox. They use local fixtures and mocked
provider responses; security and large-original cases use real loopback servers.
No personal browser profile is used. Native permission denial is simulated in
ordinary fixture tests; the dated 1.0.1 section records the separate stable-Chrome checks.

## Security baseline retained

The preceding cleanup (commit `e14f101`) blocked redirects before following them,
including return chains and RPC POST redirects, enforced metadata depth/format
bounds, and limited automatic previews to 100 MiB and 30 seconds. Explicit
original downloads remain unlimited by the application; conversion has separate
byte/pixel/frame/time bounds. SVG stays inert as image content, and HTML artwork
runs in an opaque sandbox without extension APIs or external network access.

That cleanup passed all then-current automated browser checks and 125 units.
Its online npm registry audit reported zero known vulnerabilities. This release
preparation changes no dependency versions; that audit is not a guarantee against
unknown vulnerabilities or a substitute for a fresh audit at publication time.

## Publication status and remaining publisher actions

Privacy hosting: https://c0ncep7.github.io/tokint/public/privacy.html.
Release/source distribution: https://github.com/c0ncep7/tokint/releases/tag/v1.0.1.
The matching source archive and checksums must remain accessible with this binary.

- Review the final listing/privacy answers in `docs/WEB_STORE.md`, public contact,
  distribution choices and approved promotional images; upload the **1.0.1** store ZIP.
- Submit for Google review. The isolated HTML-artwork remote-code declaration
  remains subject to that review. No store upload or submission was performed here.

Explicit original downloads, browser decoding, and HTML artwork can consume
substantial resources. The application limits do not guarantee every token will
render or every provider will remain available.
