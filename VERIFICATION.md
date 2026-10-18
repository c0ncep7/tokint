# Release verification

Reviewed on October 18, 2026. Package and both extension manifests are reset to **1.0.0** for the first release. This report replaces the conflicting pre-release verification history; historical test results are not evidence for the current build.

## Completed

- `npm ci --offline` installed the locked dependencies from the local npm cache after registry access failed.
- `npm run check` passed: strict TypeScript checking, **104 unit tests**, and production builds of both extensions.
- TypeScript now rejects unused locals and parameters and includes `scripts/live-check.ts`.
- The build was also run from outside the project directory to verify output paths resolve to the project. Both generated manifests match the package version. An isolated mismatched-version check failed before replacing an existing build, as intended.
- Generated files and `SHA256SUMS.txt` were checked for matching hashes and complete coverage of both build directories.
- All runtime and development dependencies have current uses in the source, build, or tests. No dependency versions changed; the only lockfile metadata change declares Node.js 22 or later.
- A separate source security review examined metadata/SVG rendering, URL handling, permissions, external messaging, downloads, cache, and workers. It found **no confirmed exploitable security issue**. This was a source review, not a completed browser penetration test.

The supplied workspace has no `.git` directory. Review covered the full source tree rather than a branch diff.

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
| Browser regression suites | Playwright's expected Chromium build was absent. An installed Chrome for Testing executable exited during launch with `SIGABRT`/`EPERM` under the sandbox. No browser suite passed during this review. Run `npx playwright install chromium` and `npm run test:release` in a browser-capable environment. |
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

Full release readiness remains pending the browser suites, online dependency checks, redirect-consent verification, and publication decisions above.
