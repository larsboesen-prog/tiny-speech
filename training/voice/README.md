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
