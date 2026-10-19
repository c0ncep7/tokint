GIF optimizer source and provenance
==================================

TOKINT includes Gifsicle 1.92 (GPL-2.0-only), its wasm-codecs integration
(MIT, Cyril Wanner), and gifsicle-wasm-browser 1.5.19 (MIT, renzhezhilu).
COPYING contains GPLv2. WASM_CODECS_LICENSE contains the integration's MIT
notice. The wrapper's MIT notice is inside its source archive.

Pinned source archives
----------------------

gifsicle-1e2ca74-source.tar.gz:
  Complete upstream Git source at v1.92,
  commit 1e2ca7401692ba94d7405de6e9dd1d1e73ca880f.
  https://github.com/kohler/gifsicle
  Includes bootstrap.sh, C sources, headers, configure inputs and makefiles.
  gifsicle-1.92.tar.gz is retained as the upstream release-source distribution
  with generated configure/build files.

wasm-codecs-89fb54b-source.tar.gz:
  Gifsicle source, Dockerfile, build.sh, package manifests/locks, licenses,
  and root compiler configuration at the 1.0.0 Publish commit
  89fb54b412e262832d61d9da5b4deb02ead184d4.
  https://github.com/cyrilwanner/wasm-codecs
  Unrelated codecs and test fixtures are excluded. The complete Gifsicle
  compilation recipe, pre-JS source and interface definitions are included.

gifsicle-wasm-browser-7033183-source.tar.gz:
  Preferred wrapper JS, modified Emscripten glue, original WASM, build.js,
  package manifests/lock, rollup configuration, licenses and documentation
  at commit 7033183ee0db22bb339a878571d743b9642e1c77 (package 1.5.19).
  https://github.com/renzhezhilu/gifsicle-wasm-browser
  Includes the demo service-worker and generated demo bundle that build.js
  writes; unrelated demo assets are excluded. Source files are unmodified.

Verification performed
----------------------

PROVENANCE.json records archive hashes and exact upstream revisions.
The installed 1.5.19 npm dist file matches the wrapper commit's dist file.
The WASM extracted by TOKINT is byte-identical to both the wrapper's
src/gifsicle.wasm and @wasm-codecs/gifsicle@1.0.0's lib/gifsicle.wasm:
  SHA-256 b4d9f84e5f8aa7cbe7cc2f90431b511456593324cb4aa75fcabf4ada8c218e05
  217106 bytes

The worker runtime was rebuilt from the archived wrapper src/worker.js and
src/gifsicle.js with uglify-js 3.16.1, embedding src/gifsicle.wasm exactly as
src/build.js does. The result matches the pinned npm package's
gifsicle.tool.workerLocalUrl byte-for-byte (339329 characters).

Upstream's src/version still says 1.5.17. Its final 1.5.19 commit changes the
distribution banner only; it does not change the runtime. Do not interpret
that stale banner input as a different WASM version.

Rebuilding and integration
-------------------------

Extract the archives into a temporary working directory. In wasm-codecs,
install root and packages/gifsicle build dependencies with lifecycle scripts
disabled, then run the package's build:js and build:wasm scripts. The original
Dockerfile specifies trzeci/emscripten:1.39.18-upstream, applies a documented
configure.ac patch, and builds v1.92 C objects. build.sh links those objects
with the original options and lib/pre.js. The archived v1.92 Git source is
provided so this source need not be obtained from a moving download endpoint.
The original Docker recipe downloads that same tag; for an offline build,
replace that download step with the supplied source directory.

The wrapper's src/gifsicle.js contains its subsequent JS adaptations to the
generated glue. Preserve those adaptations when changing the C runtime.
Its src/build.js documents the worker embedding and minification steps.
Use uglify-js 3.16.1 (recorded in its lockfile). Running the original build.js
also increments its version/banner and regenerates demo cache listings.

TOKINT's scripts/build.mjs extracts the pinned package's embedded WASM into
extension/gifsicle.wasm and packages its runtime as a normal ES module.
It replaces the blob-worker loader and removes the worker onmessage handler;
it does not alter the WASM. All compression executes locally.

The upstream C-to-WASM recipe and corresponding source are supplied, and
binary identity with the original compiler package was checked. A fresh
C-to-WASM rebuild has not been performed here; byte-reproducibility of that
compiler/container build is not claimed. The historical container uses a
version tag rather than an immutable image digest.

Distribution
------------

Include this entire directory, TOKINT's source and build scripts, and all
applicable dependency source/notices in the matching release source archive.
Make that source accessible to binary recipients, including Web Store users,
using the release-specific source access instructions in DISTRIBUTION.md.
Keeping a source archive only on the publisher's computer does not provide
source access to recipients. Do not describe the wrapper's MIT license as
relicensing the embedded GPLv2 executable.
