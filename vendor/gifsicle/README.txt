The extension includes gifsicle-wasm-browser 1.5.19 (MIT wrapper) and its
Gifsicle 1.92 WebAssembly optimizer (GNU GPL v2; see COPYING).

Gifsicle upstream source is supplied as gifsicle-1.92.tar.gz.
Wrapper source: https://github.com/renzhezhilu/gifsicle-wasm-browser
Underlying WebAssembly build: https://github.com/cyrilwanner/wasm-codecs
Upstream: https://github.com/kohler/gifsicle/tree/v1.92

scripts/build.mjs extracts the pinned package's embedded WebAssembly into
extension/gifsicle.wasm and packages its runtime as a normal ES module.
This replaces its blob-worker loader; it does not alter the WebAssembly.
All compression executes locally. No external code is fetched at runtime.
