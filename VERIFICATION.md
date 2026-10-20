# Release verification: TOKINT 1.0.3

Prepared October 20, 2026. This is the tested candidate for Chrome Web Store
submission. [Historical results](docs/VERIFICATION_HISTORY.md) cover earlier
versions. No Chrome Web Store upload or submission has been performed.

## HTML consent and network disclosure

The security review found that `connect-src 'none'` does not block artwork-initiated
WebRTC/STUN traffic. Version 1.0.3 replaces automatic executable HTML previews
with a prominent, explicit **Run HTML artwork** decision. The notice explains
creator-controlled external/local connections and IP disclosure without a site
permission prompt. It does not promise network isolation.

Consent is bound to the exact artwork Blob in the current inspector selection.
Preview, fullscreen, and every export attempt require that same live grant.
It is never saved. **Stop HTML artwork**, media changes, new lookups, refresh,
reload, and navigation revoke the grant and destroy active artwork frames.
Cached HTML requires fresh consent. Metadata, other images, and original downloads
remain usable without execution. Opening a downloaded original elsewhere may run
its code. The opaque sandbox continues to separate artwork from extension APIs,
TOKINT settings, and other tabs; ordinary resource loading remains restricted.

The privacy policy, Settings, Help, README, and store declarations disclose the
same behavior. Application and conversion logic remain bundled; the remote-code
declaration remains **Yes: consented, isolated HTML artwork**. Google's review
of its [Manifest V3 exemption](https://developer.chrome.com/docs/webstore/program-policies/mv3-requirements)
is still required.

## Automated verification

- `npm run test:release`: strict TypeScript, all **149 unit tests**, production
  build, and every standard browser suite pass on Chrome for Testing
  **153.0.8010.12**.
- Browser suites cover inspector (44), sharing (48), cache (15), Alchemy (15),
  configuration (8), storage/restart (6), media/HTML, Art Blocks, toolbar actions,
  offline conversion, redirects, resource bounds, and explicit HTML consent.
- `scripts/html-consent-browser-test.mjs` uses a real loopback UDP listener.
  It observes no STUN packets or artwork iframe before consent, permits the
  disclosed traffic after consent as a positive control, and confirms it stops
  after **Stop HTML artwork**. It also covers original download before consent,
  disabled conversion, fullscreen, media changes, offline cache reload, and a
  narrow layout. All traffic is local to the test machine.
- Unit coverage rejects missing, mismatched, and revoked grants at the HTML
  execution boundary and confirms that revocation invalidates frame capture.
- `npm run test:live`: Loot #1, The Memes #410, Chromie Squiggle #5603, and BAYC #1
  pass against public services. Most other browser checks use recorded fixtures.
- Online `npm audit`: **0 known vulnerabilities**, including development
  dependencies. This is not a guarantee against unknown vulnerabilities.

## Native Chrome acceptance

Checked the production 1.0.3 build through native Google Chrome
**155.0.8059.85**, using the dedicated TOKINT Release Test profile:

- `tokint` + Tab entered the native extension keyword mode and opened a live
  Loot #1 lookup with its embedded SVG and version 1.0.3 displayed.
- A live Chromie Squiggle #5603 lookup requested the specific metadata host.
  **Deny** produced an actionable error; retrying and **Allow** continued.
- The HTML source host required its own native permission prompt. Once granted,
  the artwork remained paused behind the complete network disclosure.
- **Run HTML artwork** then requested the pinned library host. Granting it
  rendered a canvas and displayed the persistent allowed/Stop controls.
- **Stop HTML artwork** restored the consent notice and removed fullscreen
  availability. Native grants stayed limited to the requested public hosts.

No personal browsing profile or production API credentials were used.

## Assets and package

`releases/1.0.3/` contains:

| Artifact | Purpose |
| --- | --- |
| `tokint-1.0.3-chrome-web-store.zip` | Store upload, with `manifest.json` at the root |
| `tokint-1.0.3.zip` | Manual installation with `extension/` |
| `tokint-1.0.3-source.zip` | Matching source, lockfile, tests, build scripts, and vendor materials |
| `tokint-1.0.3-store-assets.zip` | Icon, four screenshots, small/marquee tiles, and upload instructions |
| `SHA256SUMS.txt` | Checksums for the release artifacts and supporting files |

The screenshot set was recaptured directly from 1.0.3 at 1280 × 800, device scale
factor 1. It includes dark/light inspector views, the actual local conversion,
and the HTML consent notice. See [asset verification](docs/store-assets/README.md).
The 128 × 128 icon, 440 × 280 small tile, and 1400 × 560 marquee are included.

All four ZIP CRC checks pass. Every binary, source, and asset archive entry matches
the working tree; both checksum manifests and all image hashes pass. The store ZIP
contains 49 files and is about 332 KiB. Bundled module imports resolve inside the
archive. Packaging verifies manifest versions and required entry points.
The store package contains no tests, source tree, node_modules, browser profiles,
or listing assets. Source and store-asset ZIPs are separate downloads.

## Publication and next step

- Matching source, binary, listing assets, and checksums:
  https://github.com/c0ncep7/tokint/releases/tag/v1.0.3.
- Public privacy policy: https://c0ncep7.github.io/tokint/public/privacy.html.
  It must match the bundled `privacy.html` byte for byte.
- Support: https://github.com/c0ncep7/tokint/issues.
- Copy-ready declarations and reviewer instructions: [WEB_STORE.md](docs/WEB_STORE.md).

The publisher will handle the Chrome Web Store setup next: publisher/contact
verification and 2FA, listing/category/language, distribution, privacy answers and
certifications, image uploads, reviewer instructions, package upload, and submission.
Those dashboard actions are intentionally outside this preparation step. Local
verification does not constitute Google approval.
