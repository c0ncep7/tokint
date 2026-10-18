# Distribution status

The project owner has not yet selected a top-level project license. Generating
release archives does not choose distribution terms or establish publication
readiness. This file records the outstanding decision; it is not a license.

Gifsicle is retained for local GIF optimization when the initial encoded output
exceeds the requested size limit. Its WebAssembly runtime is loaded on demand.
The bundled Gifsicle 1.92 component is identified as GPL v2; the
gifsicle-wasm-browser 1.5.19 wrapper is MIT. See `vendor/gifsicle/COPYING`,
`vendor/gifsicle/README.txt`, and the generated `THIRD_PARTY_NOTICES.txt` files.

Before publication, the owner must select the project's distribution terms and
resolve their compatibility with the bundled components. Replacing or removing
the optimizer would change compression behavior and needs separate validation.

`npm run release` builds both extensions and produces ZIPs, a corresponding
source archive, a bundle report, this note, and SHA-256 checksums under
`releases/<version>/`. The source archive includes the lockfile, build scripts,
tests, Gifsicle source archive, license, and integration notes. A top-level
LICENSE, LICENCE, or COPYING file is included automatically when one is added.
Keep the corresponding source archive with the binary release artifacts.

Packaging does not run the browser suites or publish anything. Run
`npm run test:release` and review `VERIFICATION.md` before publication.
