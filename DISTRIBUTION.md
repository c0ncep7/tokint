# License and distribution

TOKINT's original code is licensed under **GNU GPL version 2 only**
(`GPL-2.0-only`); see [LICENSE](LICENSE). Copyright TOKINT contributors.
This choice accommodates the bundled Gifsicle 1.92 optimizer, whose upstream
license specifies GPL version 2 only. It is not a GPL version 2-or-later grant.

Third-party components retain their own copyright notices and licenses.
The `gifsicle-wasm-browser` JavaScript wrapper and wasm-codecs integration are
MIT licensed. TOKINT uses the MIT option for dual-licensed `multiformats`.
Generated `THIRD_PARTY_NOTICES.txt` includes runtime dependency licenses and
Gifsicle's license. p5.js is not included in extension or source artifacts; the
artwork dependency is fetched from its pinned upstream URL on demand. Its npm
package is a development-only test fixture. Service logos and trademarks remain
subject to their owners' rights; the code license does not grant trademark rights. See the
[service-logo notes](docs/branding/service-logos.md).

## Build and release

With Node.js 22 or later, run `npm ci`, `npm run test:release`, then
`npm run package:store`. Packaging builds the single extension and writes:

- `tokint-<version>-chrome-web-store.zip`: upload this ZIP; `manifest.json` is at its root.
- `tokint-<version>.zip`: extract and load its `extension/` directory for manual installation.
- `tokint-<version>-source.zip`: source, lockfile, build scripts, tests, documentation,
  and the vendored Gifsicle source/build materials.
- Licenses, privacy/submission notes, bundle report, and `SHA256SUMS.txt`.

All artifacts are under `releases/<version>/`. Packaging validates entry points
and required legal/privacy files; it does not run the test suites or publish
anything. Review [VERIFICATION.md](VERIFICATION.md) for actual test results.

Rebuild after documentation changes so the installed policy and distribution
notes match the source. Regenerate release archives after changing code or
documentation; an unpacked build does not update existing ZIPs or public downloads.
Publish the matching source, binary, checksums, and public privacy policy together.

## Matching source and notices

Publish the matching source archive with every binary release, keep it available
to recipients, and link it clearly from the store listing/support site. Preserve
the GPL license and dependency notices. If you change the code or bundled binary,
regenerate and publish matching source rather than pointing users at an unrelated
branch or a newer version. The GPL's distribution conditions apply to redistributors
as well as the original publisher.

`vendor/gifsicle/` includes the Gifsicle 1.92 C source archive, its license,
preferred wrapper/glue source, upstream compiler recipes, and provenance notes.
The build extracts the pinned npm package's WASM and adapts its JavaScript runtime
to an extension-local module. Its source provenance is documented separately from
reproducibility: a fresh, byte-identical WASM rebuild is not claimed.

The source archive records the JavaScript dependencies in `package-lock.json`;
`npm ci` retrieves their pinned packages. Dependency notices are included
in both installed and source artifacts. See `vendor/gifsicle/README.txt` for
optimizer upstream source/build details.
