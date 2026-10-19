# TOKINT

<img src="docs/branding/tokint-reference.png" alt="TOKINT: three white bars above a geometric wordmark on black" width="240" height="240">

A Chromium extension for Ethereum mainnet contract inspection, NFT metadata, IPFS links, and local image conversion. Requests go directly from your browser to the configured providers. No wallet, signing, or account is required for the core features.

## Core functionality

- Inspect Ethereum mainnet ERC-721/1155 metadata using a contract address and exact token ID.
- Open contract, token, and IPFS lookups from the address bar, or detect a token from the current tab using the toolbar button.
- View JSON, attributes, storage locations, and selectable artwork; download originals or convert supported images and animations locally.
- Reopen recent tokens from a local cache, including offline when their content is cached.
- Optionally use Alchemy for collection/wallet browsing and ownership/mint information.

## Install

Use Chrome, Brave, or another Chromium browser that supports unpacked Manifest V3 extensions. The manifests require Chromium 109 or later; use a current browser for media decoding and conversion support.

1. Extract the release folder to a permanent location. If you have source only, [build it](#development) first.
2. Open `chrome://extensions`, `brave://extensions`, or `edge://extensions`.
3. Enable **Developer mode**, choose **Load unpacked**, and select **`extension/`**, the folder containing `manifest.json`.
4. Pin tokint to the toolbar if desired. Clicking it opens the inspector in a new tab.

The supplied build needs no Node.js installation. Settings are available from the inspector's gear icon or the browser's extension management page.

Release ZIPs contain `extension/` or `ipfs-extension/`; extract the appropriate
ZIP before choosing **Load unpacked**. The source ZIP is for development.

### Optional `ipfs` shortcut

Chromium permits one address-bar keyword per extension. The main extension uses `eth`; the companion adds `ipfs`:

1. Load **`ipfs-extension/`** as a second unpacked extension.
2. In tokint Settings, click **Connect IPFS shortcut**, then **Connect** on the companion page.
3. Type `ipfs`, press **Tab**, enter a CID/path or `ipfs://` URI, and press **Enter**.

The companion reads the main extension's saved gateway on each submission. It has only storage permission and receives the gateway URL/style, never the RPC configuration. If connecting fails, check that both extensions are enabled and reloaded. Reconnect after moving or reinstalling the main extension.

## Inspect a token

Enter a full contract address and decimal token ID, then press **Enter** or click **Inspect**. **Auto detect** probes the standard metadata interfaces and tries `tokenURI` or `uri`; select a method manually for contracts that need it. Large token IDs retain full uint256 precision, and ERC-1155 `{id}` placeholders are expanded automatically. Custom metadata functions are not supported, and an ERC-1155 URI response alone does not prove a token exists.

The inspector shows the original metadata URI, resolved URL, JSON, attributes, and image preview. JSON is normally indented; large or deeply nested objects use compact formatting to keep display memory bounded. Metadata deeper than 64 object/array levels is rejected. Use the copy and external-link controls to inspect sources. The contract link opens Etherscan's Read Contract page. When metadata provides multiple distinct assets, the Media source dropdown in the preview footer switches between `image`, `animation_url`, `image_url`, inline SVG `image_data`, other media aliases, and `properties.files` entries. Duplicate media values share one entry; the selector is hidden when only one distinct value remains. The selected asset drives the preview, storage badge, source link, original download, and conversion tools. Animated image formats work from any of these fields. Base64 HTML animations also preview in an isolated sandbox. Audio and video remain outbound links. The OpenSea and OnChainChecker logos beneath the media open the submitted token on each service in a new tab. Both logos are bundled locally; the services are contacted only when you follow a link.

Click the toolbar button on an OpenSea, SuperRare, or other HTTP(S) page with adjacent `/contract-address/token-ID` path segments to open that token automatically. The source tab stays open. Unsupported or ambiguous URLs require manual entry. Only Ethereum mainnet is supported: recognized non-mainnet labels are rejected, while unlabeled URLs are assumed to be mainnet. Website URL conventions cannot reliably identify every chain.

### Address-bar commands

Type `eth`, press **Tab**, then enter:

| Input | Action |
| --- | --- |
| `0x<40-hex-character address>` | Open Etherscan Read Contract |
| `0x<address> 123` | Inspect token 123 |
| `ipfs://<CID>/path` or `<CID>/path` | Open the configured IPFS gateway |

For example, `0xff9c1b15b16263c61d017ee9f65c50e4ae0113d7 1` inspects Loot #1. Suggestions make no network requests; requests begin after submission.

### Recent tokens and cache

The inspector remembers the last **30 distinct successfully loaded tokens**. Selecting a recent token restores its address, exact ID, and metadata method. Metadata and successfully decoded preview originals are cached in IndexedDB for **24 hours**, within a **50 MiB** total payload budget. Older snapshots are evicted as needed; recent-token shortcuts can remain after their files are evicted.

**Cached · time** identifies reused metadata. Fully cached tokens can reopen offline. **Refresh** bypasses the application and HTTP caches and fetches the contract, metadata, and media again. Changing RPC or gateway settings also makes previous snapshots ineligible. Cache failures do not block ordinary lookups.

The trash icon clears history and cached files across open inspector tabs without changing settings. Data stays local and is not synced. On-demand original downloads and Alchemy browsing results are not added to this cache.

### Storage badges and appearance

Media and metadata have separate storage badges:

- **On-chain:** JSON returned as a data URI, or media embedded in that JSON.
- **Decentralized:** recognized IPFS or Arweave references.
- **Centralized:** other HTTP(S) sources.

Embedded media inherits its metadata's location; external media is classified independently. Badges describe URI location, not permanence or immutability. Native `ar://` references can be classified, but loading requires an HTTP gateway URL.

Use the sun/moon button for a saved light or dark theme, the info button for help, and the expand button for a fullscreen image. Escape closes dialogs. Loading indicators respect reduced-motion preferences.

## Download and convert

The Media download button opens **Download/Convert**. Choose **Original** to save the selected image or HTML bytes unchanged, or adjust the export controls, click **Convert**, inspect the preview, and click **Download**. All conversion runs locally; media is never uploaded to a conversion service.

The dialog checks browser decoding, canvas encoding, and WebAssembly support.
Unavailable export formats are disabled with an explanation; original downloads
remain available. Updating the browser may enable additional conversion formats.

| Source | Converted output |
| --- | --- |
| JPEG, PNG, static WebP, supported static SVG | JPEG |
| Animated GIF or WebP | Looping GIF or WebP |
| Supported animated SVG | Looping GIF or WebP clip |
| HTML canvas animation | GIF or animated WebP, plus original HTML download |
| Other formats | Original image download or source link |

- Set a maximum edge of **1–2000 px**. HTML and SVG exports can scale up to the selected size while preserving aspect ratio. Raster exports never enlarge the original.
- Choose black or white to flatten transparency. Animation controls offer Original timing for raster sources or a **10–50 fps** cap; SVG defaults to **20 fps** and supports **0.1–60-second** clips.
- Outputs must fit **5 MB for JPEG** or **15 MB for animation**. Compression can change appearance and may reduce dimensions to fit. These limits do not guarantee acceptance by a particular social platform.
- Changing options, closing the dialog, cancelling, or loading another token stops pending conversion and clears stale exports.
- Filenames use the loaded token's full lowercase address and exact ID: `0x<contract>--123--media.png` for originals or `0x<contract>--123--web.gif` for conversions.

Automatic remote previews have a **100 MiB download limit** and a **30-second timeout**. If a preview is too large or slow, use **Download/Convert → Original** to retrieve it explicitly, or open its source URL. Explicit original downloads have no application file-size cap or fixed total timeout; browser memory and decoding limits still apply. Conversion has a separate **100 MiB input limit**. Raster conversion allows up to 32 million pixels per frame, 1000 frames, 160 million total source pixels, and 10 minutes of source animation, with a two-minute generation timeout.

SVG export supports a bounded subset of declarative SMIL and CSS keyframe animation. Scripts, event-based timing, embedded HTML/images, external assets/fonts, and unsupported timing patterns are rejected for conversion. SVG limits are 2 MiB of markup, 10,000 elements, 32 million source pixels, 3000 output frames, and five minutes of generation. Unsupported artwork can still be downloaded unchanged. SVG is decoded as an image, never inserted as live markup into the extension page.

HTML previews accept `data:text/html` (base64 or percent-encoded) and HTTP responses with `text/html`. They run in a separate, opaque sandbox with no extension APIs, external requests, frames, forms, or popups. Original downloads retain the exact HTML bytes. Canvas exports sample the largest canvas using the existing GIF/WebP controls, with a 0.1–60 second clip and a 20 fps default. Sampling advances animation callbacks and JavaScript timers on a controlled clock; artwork relying on external resources, real-time input, or non-canvas DOM rendering may preview differently or have no convertible canvas. HTML input is limited to 2 MiB.


## Settings and optional Alchemy features

Open Settings with the inspector's gear icon. Changes apply after **Save settings**, on the next lookup.

| Setting | Default | Purpose and choices |
| --- | --- | --- |
| Ethereum mainnet RPC provider | PublicNode | PublicNode, dRPC, 1RPC, optional Alchemy, or Custom RPC. Used for contract reads; the endpoint must report chain ID 1. |
| Ethereum mainnet RPC URL | `https://ethereum-rpc.publicnode.com` | Presets fill this automatically. Custom endpoints accept HTTP(S) without embedded username/password credentials. Use HTTPS for remote providers. |
| Public IPFS gateway | Pinata | Pinata, Filebase, IPFS.io, dweb.link, or Custom gateway. IPFS references are resolved through this provider. |
| IPFS gateway base URL | `https://gateway.pinata.cloud` | A base URL with no `/ipfs/` path, query, or fragment. Select Custom gateway to edit it. |
| Gateway URL style | Path | Path produces `gateway/ipfs/CID/path`; Subdomain produces `CID.ipfs.gateway/path`. Localhost/IP-address gateways require Path. Presets choose their own style. |
| IPFS address-bar shortcut | Disconnected | Connect the optional companion so `ipfs` + Tab follows the saved gateway. |

**Restore defaults** fills the form; click **Save settings** to apply it. Theme is changed separately with the sun/moon button. Clearing Recents removes history and cached files without changing settings.

RPC and content requests require direct URLs: automatic HTTP redirects are blocked before contacting their destinations. If a provider or path-style gateway redirects, use its direct endpoint, choose another gateway/style, or follow the source link in a normal browser tab. The extension does not silently switch providers.

For Alchemy, select **Alchemy (optional)** and enter your complete Ethereum mainnet HTTPS RPC URL. A valid configured URL enables:

- **Browse collection:** tokens from a contract, up to 24 per page.
- **Browse wallet:** tokens owned by a `0x` wallet address; ENS names are not supported.
- **Ownership & mint:** indexed owners and available mint date, recipient, transaction, and block. “Minted to” identifies the recipient, not the creator. Owner lists stop at 100 addresses and disclose partial results.

Requests begin only when you use these controls. Selecting a token opens its original contract metadata in the ordinary inspector. Optional **Load thumbnails** requests access to the supported Alchemy image hosts; thumbnails are temporary previews, not original download sources. Switching away from Alchemy hides these features and cancels pending requests. Indexed data can lag the chain. The configured Alchemy application must support its NFT API.

## Privacy, permissions, and errors

Settings, the last contract, theme, and recent tokens stay in local browser storage. Providers receive the RPC/content requests you submit. There are no analytics, wallet connections, signing requests, content scripts, or background polling. Toolbar detection uses temporary `activeTab` access and reads the clicked tab's URL without fetching or injecting into its page.

The main extension requests storage, `activeTab`, and host access for PublicNode, Pinata, and Arweave. OpenSea toolbar detection needs no permanent OpenSea host permission. Other HTTP(S) hosts are optional. **Allow and retry** requests access after a user click; declining leaves source links available. Revoke optional access through the browser's extension management page. Requests omit cookies and referrers. Automatic redirects, including same-host redirects, are blocked before following them; outbound links use the browser's normal navigation behavior. See [verification notes](VERIFICATION.md) for the tested security boundaries.

| Error | Suggested action |
| --- | --- |
| CONTRACT | Check the token ID and metadata method |
| RPC | Retry or change provider; confirm Ethereum mainnet |
| GATEWAY / METADATA | Check host access, source URL, and provider availability |
| JSON | Open the source; the response must be a JSON object |
| IMAGE | Keep using the metadata; retry, download Original explicitly, or open the source |
| Redirect blocked | Use a direct RPC/gateway endpoint, or open the source in a browser tab |

RPC requests have a 15-second/8-MiB bound; metadata has a 30-second/2-MiB bound and a 64-level nesting limit. Alchemy data requests use 15 seconds/8 MiB, and thumbnails 10 seconds/2 MiB. Public services can rate-limit or fail; tokint does not silently switch providers. IPFS gateways are trusted HTTP gateways: content hashes are not independently verified. CCIP Read / OffchainLookup is disabled.

## Update

Replace the files inside the installed `extension/` and optional `ipfs-extension/` folders, then click **Reload** for each extension and refresh open tokint tabs. Keep folder paths unchanged to retain the main extension's identity and local settings. If its identity changes, reconnect the IPFS companion. Update both extensions together.

## Development

Use **Node.js 22 or later** and npm. From the project root:

```sh
npm ci
npm run check
```

`check` runs strict TypeScript checking, deterministic unit tests, and the production build. The build replaces `extension/` and `ipfs-extension/`, packages local JavaScript/WebAssembly and third-party notices, and regenerates `SHA256SUMS.txt`. Both source manifests and the lockfile must match the version in `package.json`. Edit source files, not generated builds.

Every build also writes `bundle-report.json` with exact unpacked file sizes,
JavaScript dependency contributions, and esbuild metadata. Copied WASM and its
runtime appear in the file sizes, separately from esbuild's contributions.

Generate local release artifacts with:

```sh
npm run release
```

This rebuilds and writes the main extension ZIP, optional companion ZIP,
corresponding source ZIP, bundle report, distribution note, and checksums to
`releases/<version>/`. It uses Node.js without a system archive tool. Entries have
fixed timestamps and stable ordering; unchanged inputs on the same toolchain
produce identical archives. Repeating the command replaces that version's local
artifacts. It does not publish or run the browser tests. See
[DISTRIBUTION.md](DISTRIBUTION.md) for the unresolved project license decision.

For the complete automated release checks:

```sh
npx playwright install chromium
npm run test:release
```

Browser tests use temporary profiles and local fixtures, with output under `test-results/`. Most RPC/content responses are mocked; the security suite uses real loopback HTTP servers to verify redirect handling, and the sharing suite streams a real 101 MiB original to verify preview limits and explicit downloads. Set `CHROMIUM_EXECUTABLE` to a compatible Chrome for Testing or Chromium-based browser executable if needed. The toolbar suite requires the experimental `Extensions.triggerAction` debugging API. Tests do not access your personal browser profile or upload artwork.

| Command | Scope |
| --- | --- |
| `npm test` | Deterministic unit tests |
| `npm run typecheck` | Source, unit tests, and live-check script |
| `npm run build` | Both unpacked extensions, notices, and checksums |
| `npm run release` | Rebuild and package both extensions, corresponding source, report, and archive checksums |
| `npm run test:offline` | Local JPEG/WebP/GIF conversion with external requests blocked, WASM optimization, and unavailable browser capabilities |
| `npm run test:browser` | Inspector, conversion, cache, and Alchemy browser suites |
| `npm run test:config` | Settings, companion pairing, and missing-companion recovery |
| `npm run test:opensea` | Actual toolbar actions, including generic token URLs |
| `npm run test:cache` / `npm run test:alchemy` | Focused browser suites |
| `npm run test:live` | Optional read-only mainnet and IPFS checks; requires network access |
| `npm run test:security` | Real-browser redirect consent, RPC POST isolation, metadata resource bounds, and preview limits |
| `npm run test:release` | Typecheck, units, build, and all standard browser suites including offline conversion and security |

Run `npm audit` with registry access before each release; use `npm outdated` when planning dependency updates. All declared dependencies are used; `gifsicle-wasm-browser` is pinned because the build extracts its embedded runtime. See [VERIFICATION.md](VERIFICATION.md) for actual results and outstanding checks.

The original TOKINT artwork is preserved in `docs/branding/tokint-reference.png`. Editable icon, mark, and wordmark SVGs live in `public/icons/`. After changing the icon master (`tokint.svg`), run `node scripts/render-icons.mjs` to regenerate the 16, 32, 48, and 128 px PNGs, then rebuild both extensions. The editable master stays in source; release builds include only the assets each extension uses.

Additional tools:

```sh
node scripts/interactive-smoke.mjs
node scripts/render-icons.mjs
SVG_FILE=/path/to/art.svg EDGE=500 FPS=10 CLIP_SECONDS=10 FORMAT=gif node scripts/svg-file-browser-test.mjs
SVG_FILE=/path/to/art.svg EDGE=1000 FPS=25 CLIP_SECONDS=11.2 node scripts/animation-review.mjs
```

The interactive tool opens an isolated manual-test browser. The icon tool renders `public/icons/tokint.svg` to PNGs; rebuild afterward. SVG tools use a local artwork file without adding it to the extension; animation review generates sampling/encoding measurements rather than a release pass/fail result.

### Source layout and distribution

| Path | Contents |
| --- | --- |
| `src/` | Parsing, networking, contract reads, cache, UI, and conversion workers |
| `public/` | Main extension manifest, HTML, CSS, and icons |
| `companion/` | IPFS companion manifest and HTML |
| `tests/` | Unit tests and media fixtures |
| `scripts/` | Build, browser suites, and manual verification tools |
| `vendor/gifsicle/` | Gifsicle source archive, license, and integration notes |
| `extension/`, `ipfs-extension/` | Generated unpacked builds |

Each build includes `THIRD_PARTY_NOTICES.txt`. The GIF optimizer includes Gifsicle under GPL v2; keep its accompanying source, license, and integration notes in the source distribution. This repository currently has no top-level project license; choose the project's distribution terms before publishing it as open source.
