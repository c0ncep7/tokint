# Release preparation verification

Date: 2026-10-18. This records local implementation and automated verification;
it is not Chrome Web Store approval or completion of the separately planned
live-provider and native-browser acceptance checks.

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

## Automated verification

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
ordinary fixture tests; actual interactive prompt behavior is a later check.

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

## Separately scheduled publication steps

- Publisher account, support contact, screenshots and listing assets.
- Public HTTPS hosting for `public/privacy.html`; enter its URL in the dashboard.
- Public access to the matching source archive for binary recipients, linked from
  the store listing/support site; retain source and license notices for each version.
- Live mainnet/IPFS checks (`npm run test:live`), including direct responses from
  chosen providers rather than blocked HTTP redirects.
- Fresh stable-Chrome installation and actual `tokint` + Tab commands; toolbar
  lookup; native permission grant/denial; cache clearing and local downloads.
- Final publisher review of listing/privacy fields and submission. The isolated
  HTML-artwork remote-code declaration remains subject to store review.

Explicit original downloads, browser decoding, and HTML artwork can consume
substantial resources. The application limits do not guarantee every token will
render or every provider will remain available.
