# TOKINT 1.0.3 store assets

Prepared October 20, 2026. Upload the individual image files to the Chrome Web
Store graphic fields. The ZIP is a convenient download, not the extension upload.

| Field | File | Dimensions |
| --- | --- | --- |
| Store icon | `store-icon-128.png` | 128 × 128 |
| Screenshot 1 | `01-inspector-dark-1280x800.jpg` | 1280 × 800 |
| Screenshot 2 | `02-local-conversion-1280x800.jpg` | 1280 × 800 |
| Screenshot 3 | `03-inspector-light-1280x800.jpg` | 1280 × 800 |
| Screenshot 4 | `04-html-consent-1280x800.jpg` | 1280 × 800 |
| Small promotional tile | `small-promo-440x280.jpg` | 440 × 280 |
| Marquee tile (optional) | `marquee-promo-1400x560.jpg` | 1400 × 560 |

The four screenshots were captured directly from the production 1.0.3 extension
in a disposable Chrome for Testing 153.0.8010.12 profile at 1280 × 800, device
scale factor 1, without framing or interface alterations. Public RPC, metadata,
and artwork response bytes were replayed for repeatability. The two optional
Art Blocks source hosts were pregranted only in the disposable capture manifest.
HTML stayed paused during screenshot 4; no artwork code ran for that capture.
The existing TOKINT icon and promotional tiles remain applicable to this release.

`asset-manifest.json` records dimensions and SHA-256 checksums.
`capture-verification.json` records the browser, capture time, and actual JPEG
conversion: 2354 × 4200 PNG to 1121 × 2000 JPG, 891.8 kB.

## Artwork and attribution

- Screenshots 1–3 and promotional tiles: **Freedom to Retract** by **DeltaSauce**,
  The Memes / 6529 Collections, Ethereum token 410 at
  `0x33fd426905f149f8376e227d0c9d3340aad17af1`.
  Source: https://6529.io/the-memes/410.
- Screenshot 4: metadata for **Chromie Squiggle #5603** by **Snowfro**, Art Blocks,
  Ethereum token 5603 at `0x059edd72cd353df5106d2b9cc5ab83a52287ac3a`.
  Source: https://token.artblocks.io/1/0x059edd72cd353df5106d2b9cc5ab83a52287ac3a/5603.
- Original artwork and third-party trademarks retain their respective rights;
  the extension’s source-code license does not grant trademark rights.

Google’s image specifications: https://developer.chrome.com/docs/webstore/images.
The prepared assets meet the required icon, screenshot, and small-tile dimensions.
No images have been uploaded to the Chrome Web Store.
