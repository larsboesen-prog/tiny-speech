# Training data for the bilingual voice

Written by `tools/voice-data.mjs`. The GPU pipeline (`training/gpu/`) reads these files as they are.

| What | Spanish | English | About (hours) |
|---|---|---|---|
| The speaker's recordings (`training/record/`, made on the day) | 433 | 217 | up to 0.75 |
| The teacher reads, in the speaker's voice: the app's script | 3380 | 1196 | 5.63 |
| … and general sentences (Common Voice, Spanish and English) | 2000 | 1000 | 2.65 |
| tiny-voca's own F2 and M2 English clips, so English does not drift | — | 1432 | 1.54 |
| Held out for the gates (never trained on) | 200 | 200 | — |

- Phoneme table: 8704 texts → tokens in the 87-symbol vocabulary; 0 texts dropped because they read
  differently in the two languages; unknown sounds: none.
- English tokens come from tiny-voca's own phonemizer in JavaScript (as the page uses it); for the F2/M2 clips they match the
  dataset's own annotation (made by the Python phonemizer) for 1432 of 1432 clips.
- Sources: Common Voice sentence-collector.txt, CC0-1.0: Spanish sha256 `0a125f0d1cd892c5d727abb8006f5fb964ef9fe1e41bdf4afd3c4b845c47286b`, English sha256 `31ac8e200449ebd7aee4a8c6bd16d4dafd076cf11f7c3efe1035f0283712d136`;
  tiny-voca dataset batch-2 scripts (which clips have CC0 texts), sha256 `a560d26b574bd19e2f34c2cb8d61c0457fccb8e15b25f0d7b5fb12351f957313`; its annotations v4 (which batch-2 clips exist),
  sha256 `41bb07decd3defa67128e4e8f99f32efa513dc9220c7515cf6b05e77c35426fb`. The dataset is CC BY 4.0 (credit: n4ze3m/tiny-voca); the app's script was written for this project.
- Common Voice filter: 5–18 words, Spanish letters only, no numbers, every word sayable by the rules, no Spain-only words
  (vosotros forms, ordenador, zumo…).
