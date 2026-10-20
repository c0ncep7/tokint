# Privacy policy

The canonical policy is [public/privacy.html](public/privacy.html). The build
includes it as `privacy.html`, linked from Settings and inspector Help. It is a
self-contained HTML document with no external assets or scripts.

The public policy URL is https://c0ncep7.github.io/tokint/public/privacy.html.
GitHub Pages publishes the same file from the public main branch. Enter this URL
in the dashboard's privacy-policy field and deploy policy changes with releases.
The extension-local page is not a substitute for a publicly reachable policy.
Set a working support contact on the store listing; the policy refers to that
contact because publisher/contact details have not yet been chosen.

[Store submission notes](docs/WEB_STORE.md) contain matching data-use declarations
and permission justifications. Keep the public policy, bundled policy, listing,
and dashboard declarations consistent when changing functionality. Publishing
the policy and configuring the listing are separate from building the extension.

The current build removes the mandatory passphrase vault. Preferences, recent
identities, metadata and cached artwork are stored locally without encryption.
Alchemy and all custom RPC URLs are session-only by default. **Remember on this
device** explicitly persists the entire URL and any API key locally without
encryption. Neither mode uses Chrome Sync. Browser restart or extension
reload/update/disable clears session-only URLs; token lookups require configuration
again rather than silently switching providers.

The vault and its migration flow have been removed. Old encrypted preferences and
the previous token cache are discarded; custom settings must be re-entered and
tokens looked up again. No passphrase is requested or processed. Existing plaintext
custom endpoints move to session-only storage without assuming persistence consent.
Browser history, downloads and clipboard contents have separate retention.

Known Arweave transaction and original Art Blocks metadata/PNG routes resolve to
direct content destinations before fetching. Destination host permission is
checked first; arbitrary HTTP redirects remain blocked. Art Blocks metadata at
`token.artblocks.io` and artwork at `artblocks-mainnet.s3.amazonaws.com` use
optional host access. HTML animations at `generator.artblocks.io` also require
optional host access. When present, `animation_url` is the initial media selection.
When artwork needs the supported p5.js 1.0.0 dependency, TOKINT requests optional
access to `cdnjs.cloudflare.com`, downloads that exact file without cookies or
referrers, and verifies its SHA-256 hash before passing its bytes into the isolated
sandbox. A separate local cache holds only this public library and verifies it
again on reuse. This public-library cache is unencrypted; no artwork, token
identifiers or preferences go into it.
The sandbox itself still has no network access. The CDN receives the library
request and connection information described in the policy.

The storage, Art Blocks, on-demand dependency and export updates postdate the recorded
1.0.1 publication. Updating this checkout and rebuilding the bundled policy does
not deploy the public policy or replace published release archives. Publish
the matching policy and release together; see [VERIFICATION.md](VERIFICATION.md).
