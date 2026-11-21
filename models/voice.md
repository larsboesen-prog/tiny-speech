# Model card: MX1 voice (`tiny-voca-mx1-2026-11-21.gguf`)

A text-to-speech voice for the browser, about 8 MB, that speaks English and Mexican Spanish as the same person: MX1, a warm,
calm man's voice like a local guide from Guanajuato. It is tiny-voca (github.com/n4ze3m/tiny-voca) taught Spanish sounds and
a third speaker.

| | |
|---|---|
| File | `vendor/tiny-voca/tiny-voca-mx1-2026-11-21.gguf`, 7,998,304 bytes, SHA-256 `921d4f8406fd7f988541c5a5487e5b8712740440a93f2f68b836baec4e1a07c6` |
| Voices | `F2`, `M2` (tiny-voca's own English voices) and **`MX1`** (new; English and Spanish) |
| Symbols | 87 phone and punctuation symbols: tiny-voca's English set plus the Spanish sounds |
| Output | 24 kHz mono |
| Runs on | tiny-voca's plain-JavaScript engine (`vendor/tiny-voca/js/`, through `engines/tinyvoca-js.js` and `browser/tinyvoca-js-worker.js`): no WebAssembly runtime, about 4× faster than real time on one CPU core, first sound 0.5–1 s after the text |
| Text to sounds | English: tiny-voca's phonemizer (dizione). Spanish: Mexican Spanish rules (`lang/es/`), with English words inside place names read in English (from the city pack) |
| Date | 21 November 2026 |
| Licence | Apache License 2.0 |
| Credits | tiny-voca by Muhammed Nazeem (Apache-2.0); training audio generated with Qwen3-TTS by the Alibaba Qwen team (Apache-2.0); tiny-voca's dataset batch 2 by Muhammed Nazeem (CC BY 4.0) |

## Intended use

Reading short answers aloud on a website or app (opening hours, directions, recommendations), in English or Spanish, on the
listener's device.

Not intended for: making anyone believe they hear a real person, imitating a real person, or any deceptive use. MX1 is a
designed voice (see below) and should be presented as a computer voice.

## How the voice was made

1. **Designed, not recorded.** Qwen3-TTS 1.7B VoiceDesign made four candidate voices from written descriptions; the site's
   owner listened and chose M1, described as: "A Mexican man in his mid thirties from Guanajuato, in central Mexico, with a
   warm, friendly baritone voice. Native Mexican Spanish with a natural central Mexican accent, never Spanish from Spain. Calm,
   clear and welcoming, like a local guide recommending his favourite places to eat." (seed 52001). No real person's voice was
   cloned. Its 13.9-second reference is `training/voice/M1/es.wav`.
2. **The teacher reads.** Qwen3-TTS 1.7B Base copied that reference to read 7,576 sentences in Spanish and English (the
   site's kinds of answers, written at build time with a language model: `training/script/`). Whisper small listened to each;
   6,941 (92%, about 7 hours) were kept. With them, 1,432 of tiny-voca's own English clips (F2, M2) so those voices stay.
3. **Training.** tiny-voca's own training code, started from the released model, MX1 started from M2: 27,611 steps, 11 hours
   on a free Kaggle T4 (`training/gpu/`, notebook `training/gpu/kaggle/voice.ipynb`).
4. **Packed** to the plain-JavaScript engine's GGUF layout (`tools/voice-gguf.mjs pack`).

## Evaluation

Whisper small listened to sentences the voice never read in training:

| | Spanish words heard right | English words heard right | Language heard right (es / en) |
|---|---|---|---|
| Training gates, PyTorch, 200 sentences a language (pass: 90%) | 96.7% | 94.1% | 100% / 98.5% |
| **The browser engine with this file**, 40 sentences a language | **96.5%** | **96.2%** | 100% / 100% |

Most of the words Whisper writes differently are names: "Cambay" for Kan Bei, "Lasotía" for La Azotea read in English. The
owner approved the voice by ear on 21 November 2026. `test/demo.test.mjs` checks it in the browser.

## Limits

- Names the rules do not know may be read oddly; a city pack can give readings by hand (`packs/src/<city>/lexicon.json`).
- One speaking style: calm, friendly. No emotion control; speed and pitch can be adjusted a little.
- Tested on Chromium on a computer; phones (an iPhone in particular) still to be timed.
- The listening checks are by a speech recognizer and one listener, not a listening panel.
