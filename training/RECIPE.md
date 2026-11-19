# Training the bilingual voice (plan step 5, D4)

**Goal:** one tiny-voca voice that speaks English and Mexican Spanish, fine-tuned from tiny-voca's released checkpoint
(4.5M parameters), shipped as one 8-bit GGUF under 10 MB, run by `engines/tinyvoca-js.js`. Until it passes the gates below,
Spanish answers use the phone's Mexican voice (decision D7).

**Why it is needed (measured, 19 Nov 2026):** the English-only model reading Spanish, through either the English phonemizer or
Spanish rules mapped to English sounds, was heard right by Whisper for 11–56% of the words (`browser/README.md`). Sounds alone
cannot fix that; the model has to learn Spanish.

## Status

| Step | Status | Cost |
|---|---|---|
| 1. Script: what the voice must say well | **done**: 3,580 Mexican Spanish + 1,396 English sentences, `training/script/` | $3.28 (OpenRouter) |
| 2. Spanish sounds for training (`lang/es/ipa.js`) | **done**: 29 sounds of central-Mexico Spanish; all present in the script | — |
| 3. General speech to go with the script | **done**: `training/data/` (`tools/voice-data.mjs`): 2,000 Common Voice Spanish and 1,000 English sentences (CC0), 1,432 of tiny-voca's own English clips, 400 held out; every text already in the model's tokens | — |
| 4. A teacher voice reads it, in one voice, both languages | **ready**: a real speaker (the owner's choice), recorded 20 Nov 2026 with `training/record/`; the teacher copies that voice (`training/gpu/teacher.py`) | GPU |
| 5. Screening and alignment | **ready**: `training/gpu/` (Whisper, upstream's aligner) | GPU |
| 6. Fine-tune from the released checkpoint | **ready**: `training/gpu/run.sh` (about 7–9 GPU hours in all, `training/gpu/README.md`) | about $5–12 |
| 7. Export, run in the browser, gates | **ready**: `tools/voice-gguf.mjs pack`, the page reads the bilingual file (`engines/bilingual.js`), `gates.py` and `tools/voice-gates.mjs` | — |

Checked before any GPU time: the GGUF tool rebuilds the released plain-JS file byte for byte; an untrained bilingual file
(`node tools/voice-gguf.mjs init`) speaks English with exactly the released model's samples and runs Spanish through the new
tokens; the English tokens made here equal tiny-voca's own for all 1,432 of its English clips (`test/voice-bilingual.test.mjs`).

OpenRouter sells model calls, not GPU time: steps 1–2 used it (the script, written by Claude Sonnet 5.5 and checked by rules);
steps 4–6 need a rented GPU. Upstream tiny-voca's whole project cost $9.56 on one RTX 4090 at about $1.24 an hour.

## 1. The script (`training/script/`)

`tools/make-script.mjs` asked Claude Sonnet 5.5 (OpenRouter) for sentences in 12 Spanish and 7 English themes: the app's answers
and questions, live-music nights, opening hours said in full ("cuarto para las ocho"), directions, Mexican dishes and drinks,
numbers and pesos, news read aloud, short replies, Mexican and Nahuatl place names, Spanish with English words mixed in, and
San Miguel's place names. Every sentence was checked: length, no symbols, every Spanish word sayable by the rules, no duplicates
(27 rejected of 5,003). Checked by search: no Spain-only Spanish (vosotros, ordenador, gafas…); Mexican words throughout
("ahorita" 99 times, "padre" 40, "cuarto para" 17). Coverage: `training/script/REPORT.md` (about 4.5 hours of Spanish, 1.6 of
English, at tiny-voca's reading speed).

## 2. The sound inventory

tiny-voca has 76 symbols (59 English phones). The bilingual model keeps them all, so the released checkpoint's English stays as
it is, and adds Mexican Spanish's own sounds, as new rows of the token table:

| New | Sound | Starts from (nearest English row) |
|---|---|---|
| `a e o u` | pure Spanish vowels | `ɑː eɪ oʊ uː` |
| `β ɣ` | soft b and g between vowels | `b ɡ` |
| `x` | the jota | `h` |
| `ʝ` | ll and y | `j` |
| `ɲ` | ñ | `n` |
| `r` | the trill | `ɾ` |
| `<es>` | a language token after `<bos>` | `<bos>` |

Already shared with English: `i p b t d ð k ɡ f s ʃ tʃ m n ŋ l ɾ j w`. Stress marks work as in English (the stressed vowel).
Spanish text → these sounds: `lang/es/ipa.js` (seseo, yeísmo, the jota, trill and tap, soft b/d/g, ŋ before velars, glides;
Nahuatl x from a list of well-known words and the city pack's readings).

## 3. General speech

Domain sentences alone teach a narrow voice. Add, read by the same teacher voice:
- Spanish: about 5 hours of Common Voice Spanish sentences (CC0), drawn evenly, Mexico-relevant where possible.
- English: about 5 hours of the upstream dataset's sentences (LibriTTS-R transcripts, CC BY 4.0, and Common Voice, CC0), so the
  new voice keeps its English.

## 4. The teacher voice (needs a GPU)

One speaker who sounds Mexican in Spanish and natural in English. In order of preference:
1. **A real person, with consent (chosen):** 30–60 minutes of the owner's chosen speaker reading part of the script in both
   languages (`training/record/`: 500 sentences in order of usefulness, a recording page, a consent form), then Qwen3-TTS
   (Apache-2.0, upstream's teacher) copying that voice for the rest. The recordings are also trained on directly.
2. **A designed voice:** Qwen3-TTS VoiceDesign from a description ("a warm voice from central Mexico, about 35, bilingual"), then
   Qwen3-TTS Base reading everything from that one reference clip, as upstream did.
Not used: voices whose terms forbid training other models on their output (for example OpenAI's audio models on OpenRouter);
Piper's es_MX voices speak one language each.

## 5. Screening and alignment (needs a GPU)

- Whisper small (multilingual): keep a clip only under 15% word error rate, and only if Whisper's language guess is right.
- Accent checks on Spanish: no θ (Spain's z) and no Castilian intonation, by a phoneme recognizer on words with c, z, ll.
- Durations: forced alignment with `facebook/wav2vec2-lv-60-espeak-cv-ft` (multilingual; upstream's aligner), mapping its
  eSpeak symbols to the inventory above.

## 6. Fine-tuning (needs a GPU)

From the released checkpoint (upstream `src/tiny_voca`): `vocab_size` 76 → 87 (ten sounds and `<es>`); each new token row the
mean of its nearest English rows (`engines/bilingual.js` INIT); a new speaker row (`MX1`) from M2 or F2. The released file
holds only the inference weights, so `training/gpu/init_checkpoint.py` builds the checkpoint upstream's `--init-from --new-data`
accepts (fresh critics, which start at step 4,000); train on the new voice's English and Spanish together, with some of the original
F2/M2 English so English does not drift. Upstream's settings otherwise (`--gan-start`, `--gan-ratio`), for about 30–40k steps:
3–5 hours on one RTX 4090.

## 7. Export and gates (here)

- Export to GGUF with upstream `js/pack.mjs` (8-bit matrices): expected under 10 MB.
- Runtime: `engines/tinyvoca-js.js` with Spanish through `lang/es/ipa.js` and the `<es>` token; upstream `tiny-voca.js` reads
  its vowel list from `dizione/symbols.js`, which must learn the new vowels (a few lines).
- Gates, before Spanish answers switch to it: (1) Whisper small hears at least 90% of the words of 200 held-out app sentences in
  each language; (2) San Miguel's names: the reader finds the right place from what Whisper heard, as for the English voice;
  (3) the owner's ear, on 20 sentences; (4) size under 10 MB and faster than real time on the owner's iPhone.
