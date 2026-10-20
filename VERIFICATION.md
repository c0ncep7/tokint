# Release preparation verification

Updated: 2026-10-20 for version **1.0.1**. These are implementation and test
results, not Chrome Web Store approval. Earlier dated results remain below as history.

## Art Blocks animation, on-demand dependencies and export: 2026-10-20

- Token 5603's `animation_url` references p5.js 1.0.0 on cdnjs. TOKINT now
  downloads only that exact allowlisted dependency after optional CDN access is
  granted, verifies its pinned SHA-256 hash, and passes its bytes into the opaque
  artwork sandbox. The sandbox has no direct network or extension API access;
  its CSP and manifest host grants are unchanged. Unknown scripts fail clearly.
- Verified library bytes are cached separately for offline reuse, with integrity
  checked on every read. The cache contains only public library code, not artwork,
  token identifiers or preferences. Downloads are limited to 1 MiB and 15 seconds,
  omit cookies/referrers, and reject redirects. Tests cover missing access,
  altered/oversized/redirected responses, cache corruption, unavailable storage,
  cancellation and offline reuse.
- p5 is excluded from the extension build and its dependency notices. Its npm
  package is development-only for fixtures; the earlier vendored p5 source and
  runtime have been removed. The current unpacked extension is about **1.11 MiB**.
- `animation_url` remains the first media selection when it has a reference;
  image fields remain selectable. Original HTML bytes are unchanged. Unsupported
  dependencies and startup exceptions report useful errors instead of a blank
  successful preview.
- **Click artwork before recording** defaults off and appears only for HTML.
  When enabled, it sends one canvas-center click in each fresh export instance,
  including compression retries. Preview interaction is independent. The exporter
  allows the first draw to finish before sampling, avoiding a blank initial frame.
  Responsive HTML initialization waits for a nonzero iframe viewport, fixing a
  fullscreen race exposed by the live artwork.
- `npm run check` passed strict TypeScript, **147 unit tests**, and the production
  build. The complete `npm run test:browser` sequence passed: inspector (44),
  Art Blocks, media/HTML, sharing (48), cache (15), and Alchemy (15). The separate
  real-server security suite passed. After the final viewport guard, the units,
  responsive Art Blocks fixture, live Art Blocks check and media/HTML suite were
  rerun successfully. These used disposable Chrome for Testing **153.0.8010.12**
  profiles; the full release suite was not rerun for this follow-up.
- The live **Chromie Squiggle #5603** check used one CDN fetch for preview, both
  exports, offline reload and fullscreen. It verified the extension context has
  no p5 global, sandbox scripts have no extension APIs, and the PNG still loads.
  Decoded **96 × 64**, **0.5-second**, **10 fps** GIF frames are identical with the
  click option off and change with it on. This checks actual artwork motion,
  rather than relying on an automatically animating fixture or a blank first frame.
  The exported GIF and screenshot are under `test-results/`; the screenshot was
  inspected.
- README, Help, privacy policy, distribution notes and store reviewer instructions
  reflect the final behavior. The unpacked build is updated; published archives
  and the hosted policy have not been republished.

## Passphrase minimum and documentation: 2026-10-20

- Creation and unlock accept **6–1024 characters**. Empty and whitespace-only
  input is rejected. The form fields, help text and runtime validation share the
  six-character minimum; confirmation is required when creating a vault.
  Existing vaults continue to require their original passphrase.
- `npm run check` passed with strict TypeScript, **139 unit tests**, and the
  production build. `npm run test:vault` passed **4 browser checks** in disposable
  Chrome for Testing **153.0.8010.12** profiles, covering five-character rejection,
  six-character creation/unlock, migration, a full browser restart, incorrect
  passphrases, and locking across tabs.
- README, privacy policy and publishing guide document the current bounds,
  Art Blocks routing, destination permissions, and focused test commands.
  The earlier complete release-suite results below remain dated evidence;
  the complete suite was not rerun for the passphrase change.
- These follow-up changes are built locally. Published 1.0.1 archives and hosted
  policy have not been updated as part of this work.

## Art Blocks redirect fix: 2026-10-20

- The original Art Blocks contract's token 5603 returns
  `https://api.artblocks.io/token/5603`, which redirects twice before reaching
  `https://token.artblocks.io/1/0x059edd72cd353df5106d2b9cc5ab83a52287ac3a/5603`.
  Matching legacy metadata routes now resolve directly using the inspected
  contract and token ID. Other contracts and cross-token references stay unchanged.
- Its PNG media proxy also redirects twice, ending at
  `https://artblocks-mainnet.s3.amazonaws.com/5603.png`. Original-core PNG routes
  now use that storage host directly for previews and original downloads.
  Destination permissions remain required; no manifest grants were added and
  automatic redirect following remains blocked.
- TypeScript, **138 unit tests**, the build, **44 inspector browser checks**, the
  real-server security suite, and the new Art Blocks browser regression passed.
  The latter checks denied destination access, preserved source links, and both
  metadata/media redirect chains in disposable profiles.
- A live Chrome for Testing **153.0.8010.12** lookup loaded **Chromie Squiggle #5603**
  and its **2400 × 1600** PNG using only the direct content destinations. The
  screenshot was inspected. Reload the unpacked extension to apply this build.

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
Its online npm registry audit reported zero known vulnerabilities. That earlier
audit predates the on-demand p5.js artwork support. It is not a guarantee against unknown
vulnerabilities or a substitute for a fresh audit at publication time.

## Publication status and remaining publisher actions

Privacy hosting: https://c0ncep7.github.io/tokint/public/privacy.html.
Release/source distribution: https://github.com/c0ncep7/tokint/releases/tag/v1.0.1.
These links refer to the earlier publication, before the Art Blocks redirect and
animation fixes, animation-first selection, on-demand dependency loading,
click-to-start export, and passphrase follow-ups.
The archive hashes and full release checks recorded for
that publication do not describe the current working tree.

- Run the full release checks for the source being published, regenerate the
  binary/source archives and checksums, and deploy the updated public policy.
  Keep the matching source archive and checksums accessible with the binary.
- Review the final listing/privacy answers in `docs/WEB_STORE.md`, public contact,
  distribution choices and approved promotional images; upload the matching store ZIP.
- Submit for Google review. The isolated HTML-artwork remote-code declaration
  remains subject to that review. No store upload or submission was performed here.

Explicit original downloads, browser decoding, and HTML artwork can consume
substantial resources. The application limits do not guarantee every token will
render or every provider will remain available.
