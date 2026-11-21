# tiny-voca (vendored)

The plain-JavaScript tiny-voca model and its phonemizer (dizione), from https://github.com/n4ze3m/tiny-voca at commit
`32c5801332ccc282ad73ffa21998c70c3ec18bd6` (18 Nov 2026), `js/tiny-voca.js`, `js/text.js` and `js/dizione/*.js`, unchanged.
By Muhammed Nazeem. Apache License 2.0 (`LICENSE`). Cite as in the upstream README.

The model file is not here: `tiny-voca-js.gguf` (7,988,384 bytes) from https://huggingface.co/n4ze3m/tiny-voca at revision
`1e73262226dbf4ef02e9df277e81aaa1db5ce16c`, SHA-256 `8436ad1c9b57c3533c925588a1b3563f906079a89c081ac0bec9f31ad6e28653`
(`engines/tinyvoca-js.js` checks it before use). A site may serve its own copy (plan step B13).

Used by `engines/tinyvoca-js.js` and `browser/tinyvoca-js-worker.js`.

## MapSMA's voice: `tiny-voca-mx1-2026-11-21.gguf` (in git)

The bilingual voice trained for MapSMA (21 Nov 2026, `training/voice/README.md`): the released tiny-voca grown to Spanish sounds
and a third speaker, MX1, a warm local guide from Guanajuato designed with Qwen3-TTS VoiceDesign (Apache-2.0) and taught from
6,941 sentences that Qwen3-TTS Base read in that voice, with 1,432 of tiny-voca's own English clips (its dataset's batch 2,
CC BY 4.0, by Muhammed Nazeem). 7,998,304 bytes, SHA-256 `921d4f8406fd7f988541c5a5487e5b8712740440a93f2f68b836baec4e1a07c6`,
voices F2, M2, MX1; the same layout as the released plain-JS file (`tools/voice-gguf.mjs pack`). Credit: tiny-voca by Muhammed
Nazeem (Apache License 2.0); the voice's audio was generated with Qwen3-TTS (Alibaba Qwen team, Apache License 2.0).
