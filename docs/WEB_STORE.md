# Chrome Web Store submission notes

Prepared for TOKINT 1.0.0. These are copy-ready answers for the publisher's
dashboard, not evidence that the extension has been submitted or approved.

## Package

Run `npm ci`, `npm run test:release`, and `npm run package:store` with Node.js 22+.
Upload `releases/1.0.0/tokint-1.0.0-chrome-web-store.zip`. The production packaging
step puts `manifest.json` at the ZIP root and validates entry points, versions,
icons, and legal/privacy files. The other binary ZIP is for manual installation.
There is one extension and one keyword, `tokint`; no companion or extension-ID
pairing is required. Version changes must update package, lockfile, and manifest.

## Single purpose

Inspect Ethereum NFT metadata and artwork, resolve IPFS references, and save or
convert associated media locally.

## Permission justifications

| Permission | Dashboard explanation |
| --- | --- |
| `storage` | Saves the user's RPC/gateway preferences and last entered contract locally. Recent-token metadata/media use local IndexedDB. Data is not synced to a developer server. |
| `activeTab` | Reads the current tab URL only when the user invokes the toolbar action, to extract an Ethereum contract and token ID and open the inspector. No continuous browsing monitoring or page-content injection. |
| `https://ethereum-rpc.publicnode.com/*` | Default Ethereum mainnet RPC for read-only contract/interface and metadata-URI calls. |
| `https://gateway.pinata.cloud/*` | Default IPFS gateway for metadata and media referenced by the user's lookup. |
| `https://*.arweave.net/*` | Retrieves NFT metadata/media hosted on Arweave. Transaction URLs are resolved directly to their deterministic sandbox subdomains, with destination host permission checked before fetching. |
| Optional `https://*/*` | NFTs can reference arbitrary HTTPS metadata/media hosts, and users can select custom RPC or IPFS providers. The extension requests the specific host needed after an explicit user action; the wildcard is not granted wholesale. Optional Alchemy thumbnails request its two documented CDN hosts. |
| Optional HTTP loopback hosts | Allows the user to select a local RPC or IPFS service on `localhost` or `127.0.0.1`. No arbitrary remote HTTP or LAN host access is requested. |

## Remote code declaration

**Yes: isolated HTML artwork only.** All extension application logic, converters,
and WASM are packaged locally. A token's metadata may contain or reference HTML
artwork with inline scripts. That artwork executes only within the declared
`html-media.html` sandbox, isolated from extension APIs and from the network.
It cannot supply extension logic or obtain host permissions. The packaged bridge
exchanges bounded artwork/canvas data for preview and local GIF/WebP export.
External scripts, frames, workers, forms, and popups are blocked. This is the
isolated-context case described in the [Manifest V3 policy](https://developer.chrome.com/docs/webstore/program-policies/mv3-requirements).
Reviewers can inspect `src/html-media.ts`, `src/html-media-sandbox.ts`, and the
manifest CSP. This exemption remains subject to Google's review.

## Data-use declarations

Disclose local processing as well as provider transmissions; do not claim that
the extension handles no user data. Use the following categories and scope in
the dashboard. The financial and identity categories are deliberately inclusive
of public wallet/account identifiers; TOKINT never accesses payment credentials.

| Data category to disclose | Scope and purpose |
| --- | --- |
| Personally identifiable information | User-entered public wallet/account addresses can identify a person. Providers also receive the network IP address needed to answer a request. No name/email form or developer account system. |
| Financial and payment information | Public wallet/NFT ownership and mint information requested for inspection. No bank details, card details, payment processing, private keys, or signing. |
| Authentication information | Optional user-provided Alchemy API key (or authentication-bearing custom endpoint) is saved locally and sent only to the configured provider. |
| Location | IP address visible to providers as connection metadata only. No geolocation permission, GPS, or location inference by TOKINT. |
| Web history | Active tab URL read on toolbar activation and resource URLs requested for the user's token/IPFS lookup. No browser-history API or background browsing surveillance. |
| User activity | Explicit lookup inputs and recent-token selections retained locally for the feature. No clickstream analytics, mouse tracking, or keystroke monitoring. |
| Website content | Requested token metadata, images, HTML artwork, and locally generated downloads/conversions. No general page scraping. |

Health information and personal communications are not requested. Location is
disclosed conservatively for provider-visible IP addresses, not device positioning.
Optional features count even when disabled by default.

Limited-use certifications: data is not sold; transfers are limited to the
disclosed functionality; data is not used for unrelated purposes, creditworthiness,
or lending. No developer analytics, ads, or telemetry are present. The publisher
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
media stay in your browser profile and can be cleared. See the privacy policy
for permissions, local storage, and provider disclosures.

## Reviewer instructions

1. Install the single extension. Open Settings and inspect the default PublicNode
   RPC and Pinata gateway. No account or secret is required for the core path.
2. Type `tokint`, press Tab, and enter
   `0xff9c1b15b16263c61d017ee9f65c50e4ae0113d7 1` to request Loot #1.
   Public service availability is outside the extension's control.
3. Check JSON/media, original download, local conversion, theme, and recent-token
   reopen/clear. A contract address without a token ID opens Etherscan.
4. Enter an IPFS CID, `ipfs://` URI, or HTTPS IPFS gateway URL after `tokint` + Tab;
   it opens through the configured gateway. Suggestions are computed locally.
5. Additional resource hosts show an allow/retry control. Denial leaves an
   actionable error. Remote HTTP endpoints are rejected; loopback HTTP is supported.
6. Alchemy features require the reviewer's own optional endpoint. Do not include
   a publisher API key in review notes or the uploaded package.

The automated browser fixtures cover sandboxed HTML and local converters without
requiring a live token to remain unchanged. See [verification](../VERIFICATION.md).

## Publisher tasks reserved for the next steps

- Set up the publisher account, verification/2FA, support contact, listing images,
  screenshots, and distribution choices.
- Host `public/privacy.html` at a public HTTPS URL, set the listing's support
  contact referenced by that policy, and enter the privacy URL in the dashboard.
- Publish the matching source archive and link it from the listing/support site
  as described in [distribution notes](../DISTRIBUTION.md).
- Perform the separately planned live-provider and fresh stable-Chrome manual
  smoke test, including actual `tokint` + Tab and native permission accept/deny.
- Review final dashboard answers and upload the store ZIP. Packaging does not submit it.
