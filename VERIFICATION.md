# Release verification

Reviewed on October 18, 2026, with a packaging and browser-support follow-up on the same date. Package and both extension manifests are **1.0.0** for the first release.

## Packaging and browser-support follow-up

- Subsequent media-display adjustment: duplicate media values now share one selector entry, keeping the first field in the existing image-first order. A single distinct value hides the selector. SVG dimensions no longer append "SVG units". TypeScript, all 121 unit tests, production builds, and the media browser suite passed; the browser suite explicitly checks duplicate fields and the SVG caption.
- Added `npm run release` for local extension, companion, and corresponding source ZIPs, archive checksums, a distribution note, and a bundle report. No package or system dependency was added.
- Builds now report unpacked sizes and JavaScript dependency contributions in `bundle-report.json`. Gifsicle remains bundled and loaded on demand; `DISTRIBUTION.md` records the unresolved project-license decision.
- The conversion dialog checks worker canvas, JPEG/WebP encoding, image decoding, and WebAssembly availability before enabling export. Original downloads remain available when conversion is unavailable.
- `npm run check` passed with **121 unit tests**, strict TypeScript checking, and both production builds.
- All browser suite components passed using isolated profiles and Chrome for Testing **153.0.8010.12**, selected through `CHROMIUM_EXECUTABLE`. Browser launch required execution outside the filesystem sandbox. Inspector (43 checks), sharing (43), media, cache (15), Alchemy (15), configuration (7), missing-companion recovery, and actual toolbar action suites passed. A media test now waits for the asynchronous fullscreen HTML iframe before asserting its presence.
- The new offline conversion suite passed JPEG, animated WebP, and GIF output decoding with external requests blocked. The GIF case exercised the actual bundled WASM optimizer and verified the full 20-frame, 1-second timeline. Simulated missing WebP, JPEG, decoder, canvas, WebAssembly, and worker capabilities disabled unavailable exports while preserving exact original bytes, including after changing controls and reopening the dialog.
- Release ZIPs were checked with Python's independent ZIP reader for CRC integrity, safe entry paths, required Gifsicle source/license files, and SHA-256 checksums. Packaging does not imply publication approval or complete release readiness.
- Repeated packaging produced byte-identical release files. Extracting the source ZIP and rebuilding with a copy of the installed dependencies produced byte-identical main and companion extensions. This check reused the installed dependency tree; it did not perform a fresh registry installation.

## Completed

- `npm ci --offline` installed the locked dependencies from the local npm cache after registry access failed.
- The earlier `npm run check` passed with 104 unit tests; the follow-up above covers the current 121-test suite.
- TypeScript now rejects unused locals and parameters and includes `scripts/live-check.ts`.
- The build was also run from outside the project directory to verify output paths resolve to the project. Both generated manifests match the package version. An isolated mismatched-version check failed before replacing an existing build, as intended.
- Generated files and `SHA256SUMS.txt` were checked for matching hashes and complete coverage of both build directories.
- All runtime and development dependencies have current uses in the source, build, or tests. No dependency versions changed; the only lockfile metadata change declares Node.js 22 or later.
- A separate source security review examined metadata/SVG rendering, URL handling, permissions, external messaging, downloads, cache, and workers. It found **no confirmed exploitable security issue**. This was a source review, not a completed browser penetration test.

The initial review covered the full source tree without a `.git` directory. A Git repository is present during the follow-up; pre-existing branding edits were preserved.

## Cleanup performed

- Replaced the README with current installation, usage, cache, conversion, settings, permissions, development, and distribution instructions. Removed contradictory version history, obsolete source/output paths, and stale claims that token history is not stored.
- Removed the unused metadata-download filename variant, the unused mobile conversion target, unused encoder/SVG state, and an unused review-script import. Kept custom conversion bounds used by encoder failure tests.
- Updated existing tests to cover supported download behavior and read the running manifest version instead of hardcoding a release number.
- Removed five unreferenced artwork-specific reports from `verification-data/`. The reusable animation review tool and regression fixtures remain.
- Removed a machine-specific Brave executable default from the animation review tool; manual extension testing now uses Playwright's Chromium channel consistently.
- Added `npm run check` and `npm run test:release`, Node.js engine metadata, version checks before build output replacement, automatic checksums, and generated companion/OS files to `.gitignore`.
- Retained settings/theme migrations and the existing regression suite because they still protect saved preferences and supported behavior.

## Checks blocked in this environment

| Check | Result and next step |
| --- | --- |
| Browser regression suites | Resolved in the follow-up: all suite components passed with an installed Chrome for Testing executable outside the sandbox. Playwright's default expected executable remains absent; install it or set `CHROMIUM_EXECUTABLE`. |
| Dependency freshness and advisories | `npm outdated` and online `npm audit` could not reach `registry.npmjs.org` (`ENOTFOUND`). Rerun both with network access. An offline audit is not treated as a current security result. |
| Live providers | Not rerun. `npm run test:live` is optional and depends on public Ethereum/IPFS services. |
| Native browser interaction | Address-bar submission, installation permission prompts, and normal-profile behavior still need manual smoke testing. |

## Remaining review points before publication

1. **Redirect host consent:** `src/network.ts` uses the browser's default redirect following and checks the final response origin before reading its body. Source review cannot establish whether an ungranted intermediate host can receive a request before that check. Add a real-browser test for allowed A → ungranted B → allowed A and confirm the intended host-consent boundary. This is an unresolved concern, not a confirmed exploit; disabling redirects would also affect gateway loading.
2. **Distribution terms:** there is no top-level project license. Choose the project's terms before publishing it as open source. Retain third-party notices and the supplied Gifsicle source/license/integration files when preparing the distribution.
3. **Resource behavior:** original media previews/downloads intentionally have no application size cap or fixed timeout. Browser memory remains a practical limit. Conversion and metadata requests keep their separate bounds; this cleanup did not change that behavior.

## Manual release smoke test

1. Load `extension/` and optionally `ipfs-extension/` in a fresh profile. Confirm the displayed version, settings defaults, theme, and companion pairing.
2. Submit an address, address plus token ID, and CID through `eth` + Tab; test `ipfs` + Tab with the companion.
3. Click the toolbar on an Ethereum OpenSea/SuperRare token, a generic token URL, a non-token page, and a recognized unsupported-chain page.
4. Inspect a token with embedded SVG and one with external media. Exercise host permission acceptance/denial, original download, conversion, cancellation, and fullscreen.
5. Reopen a cached token offline, force Refresh, clear Recents, and check another open inspector tab updates.
6. If Alchemy is configured, check collection/wallet pagination, thumbnail permission, token handoff, and ownership/mint refresh.

Full release readiness remains pending online dependency checks, redirect-consent verification, manual normal-profile smoke testing, and publication decisions above.
