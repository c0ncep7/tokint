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

Version 1.0.1 adds passphrase-based encryption for persistent extension data.
The current build accepts 6–1024 characters for creation and unlock, rejects
empty or whitespace-only input, and requires confirmation when creating a vault.
Existing vaults still require their original passphrase. The passphrase is not
stored or transmitted. Derived keys use memory-only Chrome session storage;
disk records contain ciphertext, nonces and non-secret KDF metadata. Browser
history, downloads and clipboard contents remain outside the vault.

Known Arweave transaction and original Art Blocks metadata/PNG routes resolve to
direct content destinations before fetching. Destination host permission is
checked first; arbitrary HTTP redirects remain blocked. Art Blocks metadata at
`token.artblocks.io` and artwork at `artblocks-mainnet.s3.amazonaws.com` use
optional host access.

The six-character minimum and Art Blocks routing updates postdate the recorded
1.0.1 publication. Updating this checkout and rebuilding the bundled policy does
not deploy the public policy or replace published release archives. Publish
the matching policy and release together; see [VERIFICATION.md](VERIFICATION.md).
