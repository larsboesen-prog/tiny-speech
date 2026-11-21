# The Spanish tiny-voca's voice (20 Nov 2026)

The owner's pick ("Use local warm man") among four voices designed by `../gpu/design.py` (Qwen3-TTS 1.7B VoiceDesign,
Apache-2.0, as upstream tiny-voca designed F2 and M2; no recording of a real person):

| | |
|---|---|
| Voice | **M1, warm local guide (man)** |
| Description given to VoiceDesign | A Mexican man in his mid thirties from Guanajuato, in central Mexico, with a warm, friendly baritone voice. Native Mexican Spanish with a natural central Mexican accent, never Spanish from Spain. Calm, clear and welcoming, like a local guide recommending his favourite places to eat. |
| Seed | 52001 (half precision on a Kaggle T4) |
| Reference | `M1/es.wav` (13.9 s, 24 kHz) reading `M1/es.txt` |
| Whisper small on its samples | 6.6% of Spanish words and 5.6% of English words written differently (mostly names: "la banda" for Lavanda) |

The teacher (`../gpu/teacher.py`, Qwen3-TTS 1.7B Base) copies this one reference for both languages, so the trained voice speaks
English and Spanish as the same man. The candidates and the listening page: https://claude.ai/artifact/HTFG2kc6T3MZuLn5u6rzHj

## Trained (21 Nov 2026, free on Kaggle)

| Step | Where, how long | Result |
|---|---|---|
| The teacher reads the training sentences in M1's voice (Qwen3-TTS Base, half precision, both T4s) | `tiny-voice-teach` v6, 3¼ h | 6,941 of 7,576 accepted by Whisper small (92%), about 7 h; 635 set aside |
| tiny-voca's own English clips (F2, M2) | same session | 1,432 |
| Features and alignment | same session | 7,748 training clips (MX1 6,385) |
| Training (upstream `tiny_voca.train`, from the released voice, MX1 started from M2) | `tiny-voice-learn` v1, 11 h | step 27,611 of 30,000 (stopped at the session's deadline) |
| Gates, PyTorch (200 held-out sentences a language) | same session | **Spanish 96.7%** of words heard right, language 100%; **English 94.1%**, 98.5%: both pass (≥ 90%) |
| The browser's engine (`engines/tinyvoca-js.js`, the packed 7,998,304-byte GGUF) on 40 held-out sentences a language, heard here by Whisper small | here | **Spanish 96.5%, English 96.2%**, language 100%; about 4× faster than real time on one CPU core |

`gates.json` here is the training session's. The trained files: the session's output `result.tar.gz` (dump, inference.pt, gates,
logs); `node tools/voice-gguf.mjs pack training/result/dump` makes `vendor/tiny-voca/tiny-voca-bilingual.gguf`
(SHA-256 `921d4f8406fd7f988541c5a5487e5b8712740440a93f2f68b836baec4e1a07c6`, voices F2, M2, MX1). Most of what Whisper writes
differently are names ("Cambay" for Kan Bei, "Lasotía" for La Azotea read in English). Listening page for the owner's verdict:
https://claude.ai/artifact/Ep52gPWQDZjHm2DMqJKBSG
