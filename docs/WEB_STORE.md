# Chrome Web Store submission notes

Prepared for TOKINT 1.0.3. These are copy-ready answers for the publisher's
dashboard, not evidence that the extension has been submitted or approved.

## Package

Run `npm ci`, `npm run test:release`, and `npm run package:store` with Node.js 22+.
Upload `releases/1.0.3/tokint-1.0.3-chrome-web-store.zip`. The production packaging
step puts `manifest.json` at the ZIP root and validates entry points, versions,
icons, and legal/privacy files. The other binary ZIP is for manual installation.
There is one extension and one keyword, `tokint`; no companion or extension-ID
pairing is required. Version changes must update package, lockfile, and manifest. Chrome uses the
[numeric manifest version](https://developer.chrome.com/docs/extensions/reference/manifest/version)
to determine updates; 1.0.3 supersedes 1.0.1.

Version 1.0.3 adds explicit, revocable consent before executable HTML artwork,
including fullscreen and export. It corrects the former no-network claim.
It retains the Art Blocks fixes, animation-first selection, optional RPC persistence,
and local converters. See [verification](../VERIFICATION.md) for validation and
publication status. Use the matching 1.0.3 source and checksums.

Packaging does not upload or submit the extension. Follow Google's
[publishing workflow](https://developer.chrome.com/docs/webstore/publish) after
completing the listing, privacy, distribution, and reviewer fields.

## Single purpose

Inspect Ethereum NFT metadata and artwork, resolve IPFS references, and save or
convert associated media locally.

## Permission justifications

| Permission | Dashboard explanation |
| --- | --- |
| `storage` | Saves ordinary preferences, last contract, theme, and recent-token metadata/media locally without encryption. Alchemy/custom RPC URLs default to trusted-context session storage and clear on browser restart or extension reload. Remember on this device explicitly persists the URL and any key locally without encryption. No Chrome Sync or developer-server sync. |
| `activeTab` | Reads the current tab URL only when the user invokes the toolbar action, to extract an Ethereum contract and token ID and open the inspector. No continuous browsing monitoring or page-content injection. |
| `https://ethereum-rpc.publicnode.com/*` | Default Ethereum mainnet RPC for read-only contract/interface and metadata-URI calls. |
| `https://gateway.pinata.cloud/*` | Default IPFS gateway for metadata and media referenced by the user's lookup. |
| `https://*.arweave.net/*` | Retrieves NFT metadata/media hosted on Arweave. Transaction URLs are resolved directly to their deterministic sandbox subdomains, with destination host permission checked before fetching. |
| Optional `https://*/*` | NFTs can reference arbitrary HTTPS metadata/media hosts, and users can select custom RPC or IPFS providers. The extension requests the specific host needed after an explicit user action; the wildcard is not granted wholesale. Supported Art Blocks legacy routes check access to `token.artblocks.io` for metadata, `generator.artblocks.io` for HTML artwork, and `artblocks-mainnet.s3.amazonaws.com` for PNG artwork. The supported p5.js artwork dependency requests optional `cdnjs.cloudflare.com` access, fetches only its pinned version and verifies its SHA-256 hash. Optional Alchemy thumbnails request its two documented CDN hosts. |
| Optional HTTP loopback hosts | Allows the user to select a local RPC or IPFS service on `localhost` or `127.0.0.1`. No arbitrary remote HTTP or LAN host access is requested. |

## Remote code declaration

**Yes: isolated HTML artwork only.** All extension application logic, converters,
and WASM are packaged locally. A token's metadata may contain or reference HTML
artwork with inline scripts. That artwork executes only within the declared
`html-media.html` sandbox, isolated from extension APIs and TOKINT settings. It stays paused until the user
chooses **Run HTML artwork** after a prominent network disclosure.
It cannot supply extension logic or obtain host permissions. The packaged bridge
exchanges bounded artwork/canvas data for preview and local GIF/WebP export.
External scripts, frames, workers, forms, and popups are blocked. The exact
p5.js 1.0.0 CDN reference used by legacy Art Blocks generators is fetched as bytes
by the extension after artwork consent and optional CDN access are granted. Its pinned SHA-256 hash is
verified before its code is passed into the sandbox. It is cached separately as
public library bytes, with integrity rechecked on reuse. No dependency code runs
in an extension context. Unknown external scripts produce an actionable error.
The sandbox restricts fetch and ordinary resources but does not block WebRTC.
Artwork can contact creator-chosen external or local services and disclose the
user’s IP address without a host-permission prompt. This is explicitly disclosed
before consent and in the public privacy policy. No network isolation is claimed.
Consent is limited to the exact selected bytes in one tab, covers preview,
fullscreen and conversion, and is never persisted. Stop HTML artwork, a media
change, new lookup, refresh, reload, or leaving the token revokes it and destroys
running artwork frames. Downloads do not execute HTML in TOKINT. The same notice
appears for cached artwork; conversion cannot bypass consent.
This is the isolated-context case described in the [Manifest V3 policy](https://developer.chrome.com/docs/webstore/program-policies/mv3-requirements).
Reviewers can inspect `src/html-dependencies.ts`, `src/html-media.ts`,
`src/html-media-sandbox.ts`, and the manifest CSP. This exemption remains subject
to Google's review.

## Data-use declarations

Disclose local processing as well as provider transmissions; do not claim that
the extension handles no user data. Use the following categories and scope in
the dashboard. The financial and identity categories are deliberately inclusive
of public wallet/account identifiers; TOKINT never accesses payment credentials.

| Data category to disclose | Scope and purpose |
| --- | --- |
| Personally identifiable information | User-entered public wallet/account addresses can identify a person. Providers also receive the network IP address needed to answer a request. No name/email form or developer account system. |
| Financial and payment information | Public wallet/NFT ownership and mint information requested for inspection. No bank details, card details, payment processing, private keys, or signing. |
| Authentication information | Optional Alchemy keys and custom RPC URLs stay in memory by default, or persist locally without encryption with explicit Remember on this device consent. They are sent only to the configured provider when requested. |
| Location | IP address visible to providers as connection metadata only. No geolocation permission, GPS, or location inference by TOKINT. |
| Web history | Active tab URL read on toolbar activation and resource URLs requested for the user's token/IPFS lookup. No browser-history API or background browsing surveillance. |
| User activity | Explicit lookup inputs and recent-token selections retained locally for the feature. No clickstream analytics, mouse tracking, or keystroke monitoring. |
| Website content | Requested token metadata, images, HTML artwork, and locally generated downloads/conversions. No general page scraping. |

Health information and personal communications are not requested. Location is
disclosed conservatively for provider-visible IP addresses, not device positioning.
Optional features count even when disabled by default. Disclose artwork-initiated
connections as well: after consent, destinations chosen by the artwork can receive
IP/connection information and information included in or generated by that artwork.
TOKINT cannot enumerate these destinations or control their retention practices.

Limited-use certifications: data is not sold; transfers are limited to the
disclosed functionality; data is not used for unrelated purposes, creditworthiness,
or lending. No developer analytics, ads, or telemetry are present. Consented third-party HTML artwork may make its own disclosed network connections. The publisher
does not receive lookup data or have remote access to local storage.

Use the hosted URL of [the canonical policy](../public/privacy.html) for the
privacy-policy field. Keep these answers consistent with that policy and the
store description. Google's [privacy-field guide](https://developer.chrome.com/docs/webstore/cws-dashboard-privacy)
explains the submission fields, and its [user-data FAQ](https://developer.chrome.com/docs/webstore/program-policies/user-data-faq)
requires disclosure even for local processing.

## Suggested store description

TOKINT inspects Ethereum mainnet NFT metadata and artwork directly from your
browser. Type tokint and press Tab, then enter a contract address, a contract and
decimal token ID, or an IPFS CID/URI. Use the toolbar on supported NFT URLs to open
the token in the inspector. View JSON, attributes, and media; download originals
or convert supported images and animations on your device.

Choose your RPC and IPFS gateway in Settings. Optional Alchemy support adds
collection/wallet browsing and ownership information. No wallet connection or
account is required for core features. Lookups go directly to providers, which
receive the requested identifiers and your IP address. Recent tokens and cached
media stay locally in your browser profile without encryption and can be cleared.
Alchemy/custom RPC URLs are session-only by default. Remember on this device
optionally saves the complete URL and any key locally without encryption. No
passphrase is required. HTML artwork stays paused until you consent to running
creator-provided code. That code may contact external or local services and reveal
your IP address without a site-access prompt. Stop HTML artwork revokes consent;
switching media or reloading requires consent again. Original download is available
without execution in TOKINT. See the privacy policy for
permissions, local storage, and provider disclosures.

## Reviewer instructions

1. Install the single extension. New installations open immediately without a
   passphrase. No account, publisher credentials, or provider API key is required
   for the core path. Open Settings and inspect
   the default PublicNode RPC and Pinata gateway.
2. Type `tokint`, press Tab, and enter
   `0xff9c1b15b16263c61d017ee9f65c50e4ae0113d7 1` to request Loot #1.
   Public service availability is outside the extension's control.
3. Check JSON/media, original download, local conversion, theme, and recent-token
   reopen/clear. A contract address without a token ID opens Etherscan.
4. Enter an IPFS CID, `ipfs://` URI, or HTTPS IPFS gateway URL after `tokint` + Tab;
   it opens through the configured gateway. Suggestions are computed locally.
5. Additional resource hosts show an allow/retry control. Denial leaves an
   actionable error. Remote HTTP endpoints are rejected; loopback HTTP is supported.
6. In Settings, select Alchemy or a custom RPC. Remember on this device defaults
   off. Save a disposable endpoint and restart Chrome: the URL must be absent,
   and lookups must request configuration without silently using a fallback RPC.
   Repeat with Remember enabled: the URL persists and is disclosed as unencrypted.
   Uncheck it and save to remove the persistent copy. Old encrypted preferences
   and the previous token cache are discarded on update. No passphrase or
   migration prompt is shown; custom settings must be re-entered.
7. Alchemy features require the reviewer's own optional endpoint. Do not include
   a publisher API key in review notes or the uploaded package.

The automated browser fixtures cover sandboxed HTML and local converters without
requiring a live token to remain unchanged. See [verification](../VERIFICATION.md).

For the Art Blocks regression, inspect
`0x059edd72cd353df5106d2b9cc5ab83a52287ac3a 5603`. Allow the metadata and animation
destination hosts when prompted. `animation_url` is selected by default; the
generator HTML stays paused until you read the network disclosure and choose
**Run HTML artwork**. p5.js is then fetched on demand. Allow `cdnjs.cloudflare.com`
when prompted; subsequent previews and exports reuse its verified local cache.
Click the artwork to toggle its animation. In Download/Convert, enable
**Click artwork before recording** and export GIF or WebP; verify the downloaded
frames change. The option starts off to preserve other artworks' behavior.
Switch Media source to `image` to load the PNG from the direct storage host,
granting its optional host access if needed. The inspector preserves the legacy
metadata URI and shows the direct metadata URL.
Before running, verify that no artwork iframe or dependency request exists and
HTML conversion is disabled while original download remains available. After
running, use Stop HTML artwork and confirm the iframe is removed, conversion is
disabled, and consent is requested again. Switching media or reloading cached
artwork must also request consent again. The security suite checks actual UDP
STUN traffic: zero before consent, traffic after consent, and no continuing
traffic after Stop. Host access and artwork consent are separate controls.

HTTP redirect following remains disabled for TOKINT-managed fetches. Other Art Blocks contracts and
cross-token metadata references are outside this compatibility mapping.

## Supporting pages and matching source

- Privacy policy: https://c0ncep7.github.io/tokint/public/privacy.html. The hosted
  policy must match the bundled file; publication status is in VERIFICATION.md.
- Support: https://github.com/c0ncep7/tokint/issues.
- Matching source: https://github.com/c0ncep7/tokint/releases/tag/v1.0.3. Include
  this link in the listing; the release supplies the source ZIP and checksums.
- The [earlier 1.0.1 source release](https://github.com/c0ncep7/tokint/releases/tag/v1.0.1)
  is historical and must not be presented as the source for the 1.0.3 binary.

Persistent settings, cache, and opted-in RPC URLs are not encrypted; the policy
and reviewer instructions disclose this. Inspect `src/storage.ts`,
`src/token-cache.ts`, and the storage reset/restart tests.

## Final dashboard steps

- Set up the publisher account, verification/2FA, support contact, listing images,
  screenshots, and distribution choices.
- Host `public/privacy.html` at a public HTTPS URL, set the listing's support
  contact referenced by that policy, and enter the privacy URL in the dashboard.
- Include the source link matching the uploaded binary in the store description or support page.
- See [verification](../VERIFICATION.md) for the completed release checks.
- Review final dashboard answers and upload the store ZIP. Packaging does not submit it.

## Prepared graphic assets

The current icon, four 1280 × 800 screenshots, 440 × 280 small tile, and optional
1400 × 560 marquee are in [store-assets](store-assets/README.md). The release also
provides `tokint-1.0.3-store-assets.zip`. Upload these images individually to the
graphic fields. Do not upload that ZIP as the extension package. Screenshot 4
shows the HTML consent flow. The screenshot captures are from 1.0.3.

The publisher will complete Chrome Web Store account/dashboard setup separately:
registration and 2FA, publisher/contact details, category/language, distribution,
privacy certifications, reviewer instructions, and final upload/submission. These
steps have not been performed or certified by local packaging.
