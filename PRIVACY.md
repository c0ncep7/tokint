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
The passphrase is not stored or transmitted. Derived keys use memory-only Chrome
session storage; disk records contain ciphertext, nonces and non-secret KDF metadata.
Browser history, downloads and clipboard contents remain outside the vault.
