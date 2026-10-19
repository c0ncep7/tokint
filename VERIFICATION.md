# Release verification

Reviewed October 18, 2026. Package and both extension manifests remain **1.0.0**.
This records the current checkout's checks and remaining release work.

## Security review and fixes

The review covered networking and host permissions, untrusted metadata, SVG and
HTML rendering, sandbox messages, conversion workers, local cache/settings,
external extension messaging, dependencies, and release packaging.

| Severity | Location | Finding and resolution |
| --- | --- | --- |
| Medium | `src/network.ts:24` | Automatic redirects could contact unapproved destinations before the final-origin permission check; an A → B → A chain evaded that check. Fetch now uses manual redirect handling and rejects redirects without following them. RPC, metadata, media, thumbnails, and original retrieval use this shared transport. Rejected responses also abort their underlying transfer. |
| Medium | `src/core.ts:117`, `src/results.ts:204` | Pretty-printing deeply nested metadata could multiply a small response into a very large string before the JSON viewer's DOM cap applied. Metadata now has a 64-level nesting limit; formatting estimates indentation growth before allocation and uses compact JSON when necessary. |
| Medium hardening | `src/network.ts:77`, `src/results.ts:224` | Automatic media previews had no download bound. Remote previews now stop at 100 MiB or 30 seconds. Explicit Original downloads retain the existing unlimited behavior and remain available after preview failure. |

The redirect issue was reproduced in Chromium using a real local HTTP server:
an allowed hostname redirected to an unapproved hostname and back. The old fetch
policy reached the intermediate host despite the missing extension grant. With
the fix, no intermediate or final destination request was received. Tests also
cover cross-host, same-host, media, and RPC POST redirects. Production host grants
were not broadened: the test grants localhost only in an isolated copy of the
manifest and leaves the second loopback hostname unapproved.

Rejecting all automatic redirects is intentional. Browser manual Fetch responses
hide the redirect destination, so the extension cannot safely inspect and approve
each hop. Providers must expose direct endpoints; source links still open normal
browser tabs. The relevant behavior is defined by the
[Fetch Standard](https://fetch.spec.whatwg.org/#concept-filtered-response-opaque-redirect).

No additional exploitable boundary violation was identified in the source review.
Metadata is inserted as text, SVG is rendered through image decoding, HTML runs
in an opaque manifest sandbox, sandbox replies validate their sender and frame
buffers, and the companion receives only gateway configuration. This is a source
review with targeted browser regressions, not a guarantee against every browser
or decoder vulnerability.

## Cleanup

- Removed the unused `embeddedImageBlob` wrapper, its obsolete image-only
  assertions, and migrated byte-preservation tests to the actual media loader.
- Removed 24 stale CSS selectors from retired inspector layouts and three browser
  assertions about absent legacy elements. Preserved dynamically generated JSON
  highlighting classes and current regression coverage.
- Removed the unused 256 px icon and stopped regenerating it. Builds omit the
  editable SVG master and copy only the companion's required icons, excluding
  unrelated service logos. The vector master and branding reference stay in source.
- Removed permanent OpenSea host grants. Actual toolbar-action tests confirm
  OpenSea and generic token pages still work through `activeTab`.
- Integrated previously optional large-media regression cases into the standard
  sharing suite, including a real 101 MiB original, cancellation, and byte checks.
- Added `test:security` to `test:release`, updated README usage/settings/privacy
  guidance, and replaced stale verification history with this report.
- Retained all runtime dependencies, worker entry points, useful fixtures,
  settings/theme migrations, and documented manual tools because they remain used.

## Automated verification

| Check | Result |
| --- | --- |
| Strict TypeScript and deterministic units | Passed; **125 tests**, no failures or skips. |
| Production build | Passed for both extensions; manifests match package and lockfile versions. Checksums and bundle report regenerated. |
| Online dependency audit | `npm audit --json` completed against the npm registry: **0 known vulnerabilities**. No dependency versions changed. |
| Inspector and media browser suites | Passed, including inert JSON/SVG, HTML sandboxing, fullscreen, themes, narrow layout, media selection, and exact downloads. |
| Sharing browser suite | **46 checks passed**, including bounded automatic preview, explicit 101 MiB original download, GIF/WebP/SVG conversion, cancellation, and output limits. |
| Cache and Alchemy browser suites | **15 checks each passed**. |
| Settings and companion suites | **7 configuration checks passed**, plus missing-companion recovery. |
| Actual toolbar action suite | Passed after removal of permanent OpenSea access, including OpenSea navigation, SuperRare, and generic URLs. |
| Offline conversion suite | Passed JPEG, WebP, GIF/WASM and unavailable-capability cases, preserving original downloads. |
| Security browser suite | Passed real redirect/permission checks, RPC POST isolation, metadata depth/format bounds, and preview limits. |

Browser checks used Chrome for Testing **153.0.8010.12**, selected through
`CHROMIUM_EXECUTABLE`, in temporary profiles. Browser execution required running
outside the filesystem sandbox. No personal browser profiles were used. The
security and large-original tests use loopback servers; ordinary provider
responses are mocked. Unit tests additionally cover streamed bodies without
Content-Length, preview timeout/cancellation, nested embedded JSON, and forced
redirect policy even when a caller supplies `redirect: 'follow'`.

## Remaining release work

- **Publication terms:** the project still has no top-level project license.
  The owner must select compatible distribution terms before publication; see
  [DISTRIBUTION.md](DISTRIBUTION.md). Gifsicle source, license, integration notes,
  and generated third-party notices remain included.
- **Live providers:** public Ethereum/IPFS checks were not rerun. Run
  `npm run test:live` with network access and verify chosen endpoints return
  content directly without HTTP redirects.
- **Manual browser smoke test:** install both extensions in a fresh profile;
  exercise `eth` and `ipfs` address-bar submission, native host-permission
  acceptance/denial, companion pairing, and an ordinary toolbar action.
- **Resource limitations:** explicit original downloads still have no size or
  total-time cap. Browser image decoding and HTML artwork execution can consume
  substantial resources even within download limits. Conversion retains its
  independent byte/pixel/frame/time budgets.

Automated checks passing does not select publication terms or substitute for the
live-provider and native-browser smoke tests above.
