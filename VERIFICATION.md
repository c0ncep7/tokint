# Release verification: TOKINT 1.0.2

Prepared October 20, 2026. This file describes the current production candidate.
[Historical records](docs/VERIFICATION_HISTORY.md) preserve earlier results,
including the retired vault. Packaging does not publish or submit the extension.

## Changes since the published 1.0.1 source

- Removed the mandatory encrypted vault, passphrase UI, and migration flow.
  Alchemy/custom RPC URLs are session-only by default. **Remember on this device**
  explicitly saves the URL and API key locally with an unencrypted-storage warning.
  Old encrypted preferences and the previous token cache are discarded.
- Added direct Art Blocks routes, animation-first media selection, isolated p5.js
  dependency loading with a pinned hash, and click-to-start artwork exports.
- Removed unused public RPC client actions and the redundant inspector entry file.
  Source-reference and bundle-input scans found no other unreferenced application
  exports or source modules. JSON syntax-highlight classes are generated dynamically.
- Aligned package, lockfile, manifest, and release documentation at **1.0.2**.
  No dependency versions or host permissions were changed in this cleanup.

## Validation

- `npm run check`: strict TypeScript, **149 unit tests**, and production build pass.
- `npm run test:release`: all checks pass, including inspector (44), sharing (48),
  cache (15), Alchemy (15), configuration (8), storage/restart (6), Art Blocks,
  media/HTML, toolbar actions, offline conversion, and real-server security suites.
  Browser tests used disposable Chrome for Testing **153.0.8010.12** profiles.
- `npm run test:live`: Loot #1, The Memes #410, Chromie Squiggle #5603, and BAYC #1
  all passed using public RPC, direct Arweave/Art Blocks routes, and IPFS metadata.
- The extracted store ZIP loaded as **1.0.2** in a fresh browser profile. A live
  Loot #1 lookup rendered its embedded SVG; the screenshot was inspected. Settings
  opened without a passphrase and displayed the unchecked Remember option and
  warning. No page-script errors occurred.
- Online `npm audit` reports **0 known vulnerabilities**, including development
  dependencies. This is a registry result, not a guarantee against unknown issues.
- Confirmed Google's current Manifest V3 policy still describes an isolated-context
  exemption for remote artwork code. The declaration and sandbox boundaries are
  documented in [submission notes](docs/WEB_STORE.md); approval remains Google's
  decision. [Policy](https://developer.chrome.com/docs/webstore/program-policies/mv3-requirements).

## Production artifacts

`npm run package:store` generated the production artifacts under `releases/1.0.2/`:

| Artifact | Use |
| --- | --- |
| `tokint-1.0.2-chrome-web-store.zip` | Store upload, about 330 KiB; root manifest, 49 files |
| `tokint-1.0.2.zip` | Manual installation with the `extension/` folder |
| `tokint-1.0.2-source.zip` | Matching source, lockfile, tests, documentation, and vendored optimizer sources |
| `SHA256SUMS.txt` | Checksums for the release files and supporting documents |

ZIP CRC checks and both checksum manifests passed. Every installed payload matches
both binary archives; every source-archive file matches the working tree. All
bundled module imports and relative HTML assets resolve inside the upload package.
Version fields match **1.0.2**, and the archive excludes source/tests, local profiles,
and `node_modules`. The unpacked build is about **1049 KiB**, roughly **74 KiB smaller**
than the build before this cleanup. The final source archive includes these results;
the store ZIP remains byte-identical to the artifact used for the live browser check.

## Remaining publication steps

- Deploy the updated `public/privacy.html`. The live policy at
  https://c0ncep7.github.io/tokint/public/privacy.html was checked and still describes
  the retired vault and a 12-character passphrase.
- Publish the matching 1.0.2 source ZIP and checksums. GitHub's latest release is
  still [v1.0.1](https://github.com/c0ncep7/tokint/releases/tag/v1.0.1), with the
  earlier source archive and checksums; it does not describe this binary.
- Complete publisher/contact details, listing screenshots, distribution choices,
  privacy answers, and reviewer instructions from [WEB_STORE.md](docs/WEB_STORE.md).
- Upload the store ZIP and submit it for review. No upload, submission, or public
  deployment has been performed as part of this preparation.

Most automated browser tests use fixture responses. The packaged Loot lookup and
`test:live` use public services. Native stable-Chrome permission prompts and
address-bar interactions were last checked on 1.0.1; recheck those manually before
submission. Provider availability and artwork compatibility
cannot be guaranteed for every token.
