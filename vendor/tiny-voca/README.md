# tiny-voca (vendored)

The plain-JavaScript tiny-voca model and its phonemizer (dizione), from https://github.com/n4ze3m/tiny-voca at commit
`32c5801332ccc282ad73ffa21998c70c3ec18bd6` (18 Nov 2026), `js/tiny-voca.js`, `js/text.js` and `js/dizione/*.js`, unchanged.
By Muhammed Nazeem. Apache License 2.0 (`LICENSE`). Cite as in the upstream README.

The model file is not here: `tiny-voca-js.gguf` (7,988,384 bytes) from https://huggingface.co/n4ze3m/tiny-voca at revision
`1e73262226dbf4ef02e9df277e81aaa1db5ce16c`, SHA-256 `8436ad1c9b57c3533c925588a1b3563f906079a89c081ac0bec9f31ad6e28653`
(`engines/tinyvoca-js.js` checks it before use). A site may serve its own copy (plan step B13).

Used by `engines/tinyvoca-js.js` and `browser/tinyvoca-js-worker.js`.
