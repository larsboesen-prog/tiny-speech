# Models

| Model | File | Size | Does | Licence | Card |
|---|---|---|---|---|---|
| Tiny ears | `engines/ears/ears-int8-2026-11-20.onnx` (+ `vocab.json`) | 8.9 MB | speech sounds from 16 kHz audio, English + Spanish; words from a city's list | CC BY-SA 4.0 | [ears.md](ears.md) |
| MX1 voice | `vendor/tiny-voca/tiny-voca-mx1-2026-11-21.gguf` | 8.0 MB | speech from text, English + Mexican Spanish, voices F2, M2, MX1 | Apache-2.0 | [voice.md](voice.md) |

Both run in the browser, in workers, on the visitor's device. The files are in this repository as they are served; a page
checks the voice file's SHA-256 before use. The word list the ears need is built from a city pack:
`node tools/ears-lexicon.mjs <city>`.

Earlier models, still usable from the same workers: Whisper tiny and tiny.en (OpenAI, MIT; through transformers.js,
downloaded from Hugging Face when asked for) and the released tiny-voca English voice (`npm run fetch:voice`).
