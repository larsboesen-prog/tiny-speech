# Model card: tiny ears (`ears-int8-2026-11-22.onnx`)

A small speech-sound recognizer for English and Mexican Spanish questions in the browser. It writes no words itself: every 20 ms
it gives the probability of each of 392 speech sounds, and a matcher finds the most likely sentence made of a given word list
(a city's places, dishes, areas and everyday question words).

| | |
|---|---|
| File | `engines/ears/ears-int8-2026-11-22.onnx`, 8,883,368 bytes, SHA-256 `9630d40e72cd203c4126d3a8e7ed8f169a81e1da770532f5d94f0f476ab90fe9` (the English retrain; the first model, `ears-int8-2026-11-20.onnx`, SHA-256 `8dee5a57…`, is kept) |
| Sounds | `engines/ears/vocab.json`: 392 symbols (espeak IPA phones of both languages, and the blank `<pad>`) |
| Architecture | Conformer: log-mel inside the model (80 bands, 25 ms windows, 10 ms hop) → 2 convolutions (to 20 ms frames) → 10 blocks (width 176, 4 heads with ALiBi-style position slopes, convolution kernel 15) → 392 outputs. 7.5 million parameters |
| Format | ONNX opset 17, weights 8-bit (dynamic quantization; the mel filter bank stays 32-bit). Input `audio`: float32 [1, samples], raw 16 kHz mono. Output `logprobs`: [1, frames, 392] |
| Runs on | onnxruntime-web 1.18 (WebAssembly, one thread) in a worker: `browser/asr-worker.js` with model `tiny-ears`. 0.2–0.5 s for a 3-second question on one CPU core |
| Word matching | `engines/ears-match.js`: CTC prefix beam search over a trie of the word list's pronunciations, with a two-word language model (beam 256, prune 10, LM weight 0.5). The word list: `tools/ears-lexicon.mjs <city>` → `packs/dist/<city>/ears-lexicon.json` (2,181 words for San Miguel) |
| Date | 22 November 2026 (first model: 20 November 2026) |
| Licence | **CC BY-SA 4.0** (https://creativecommons.org/licenses/by-sa/4.0/), because it learned from CC BY-SA 4.0 speech |
| Attribution | "tiny ears (ears-int8-2026-11-22) by the tiny-speech contributors, github.com/larsboesen-prog/tiny-speech, CC BY-SA 4.0; trained on CIEMPIESS (UNAM), Google's crowdsourced Latin American Spanish and LibriSpeech" |

## Intended use

Questions to a voice guide in a narrow domain (restaurants, bars, live music, sights, opening hours), in English or Spanish,
recognized against that domain's word list, on the visitor's own device. With a different word list it serves another city or
another small domain without retraining.

Not intended for: open dictation (it can only write words in the list it is given), transcription of long recordings, speaker
identification, or any decision about a person.

## How it was trained

Knowledge distillation from a large recognizer, plus the real transcripts:

- **Teacher**: facebook/wav2vec2-lv-60-espeak-cv-ft (300M parameters, Apache-2.0), which outputs the same 392 sounds on the same
  20 ms frames. It labelled every clip with its top 8 sounds per frame.
- **Losses**: the teacher's top 8 as a soft target (frames it is sure are silence count half); CTC on the teacher's best
  sequence; CTC on **what was actually said**, the Spanish transcripts turned into sounds by Mexican Spanish rules
  (`training/ears/phones.mjs`). The teacher mishears some Mexican sounds ("perro" as `p e ɾ o`); the transcripts keep the
  student from copying that.
- **Augmentation**: speed ±10%, noise, a second voice or restaurant chatter (3–6 voices) behind, room echo, microphone colour,
  phone line and 8 kHz phone codec, clipping, masked bands and moments.
- **Run**: Kaggle, two free T4 GPUs, 10.7 GPU hours (teacher labels under half an hour; student 10.4 h, 119,117 steps). The
  checkpoint kept (step 28,735) had the fewest sound errors against what was said on 588 held-out clips (14.8–17.7%; the
  teacher's own: 22.0%).
- **Export gates** (`training/ears/export.py`): at most 10 MB; the 32-bit ONNX picks the same best sound as PyTorch on at least
  99% of frames; the 8-bit file agrees with the 32-bit one on at least 90%.

### Training data (108.8 hours, 60,471 clips)

| Set | What | Hours used | Licence |
|---|---|---|---|
| CIEMPIESS Light, Balance, Fem (Hernández Mena et al., UNAM) | Mexican Spanish: radio, interviews; women and men | 50.6 | CC BY-SA 4.0 |
| Crowdsourced Latin American Spanish (Google; OpenSLR 61, 71, 72) | Colombian, Argentinian, Chilean volunteers; many requests to a voice assistant | 22.8 | CC BY-SA 4.0 |
| LibriSpeech clean-100 (Panayotov et al.) | US English read speech | 28.6 | CC BY 4.0 |
| Piper es_MX voices claude and ald (rhasspy/piper) | the restaurant request corpus's **training** sentences, synthetic | 6.8 | Apache-2.0, CC0 (voice data) |

No test or held-out sentence was in training.

## Evaluation

### The English retrain (22 November 2026, the current file)

The first model understood English requests far worse than Spanish ones (67% against 88%): it had heard English audiobooks but no
English request. The retrain started from it (step 28,735) and added English and mixed requests from the training split read 10
times each by Piper's many-speaker English voices (LibriTTS-R, 904 speakers, and VCTK, 109 speakers of many accents; both CC BY 4.0;
about 5 hours), and CTC on what was said in English too (LibriSpeech and those requests, read by tiny-voca's phonemizer). 5.7 GPU
hours on Kaggle; the checkpoint kept (step 22,633) had the fewest sound errors against what was said on 660 held-out clips of every
set: English 13.6% (the teacher 12.8%), Spanish 15.9% (the teacher 22.1%).

Decoded with San Miguel's word list leaning to the language spoken (as /page5 does):

| | First model | **Retrained** |
|---|---|---|
| English requests, 201 clips, 3 English voices never heard (US, US, GB): understood | 67.2% | **88.1%** |
| … words wrong; places found | 21.6%; 57 of 93 | **10.1%; 89 of 93** |
| … by voice (lessac, kin to the training voices; ryan; alan) | 46, 44, 45 of 67 | **59, 61, 57 of 67** |
| English questions with everyday words (30 × 3 voices) | 68.9% | **87.8%** |
| Mexican Spanish requests, 144 clips: understood (words wrong) | 87.5% (9.4%) | **91.0%** (8.7%) |
| Spanish questions with everyday words (20 × 4 voices) | 78.8% | 77.5% |
| Argentine and Spain-Spanish voices never heard, 144 clips | 86.1% (10.9%) | 82.6% (13.4%) |

### Names by sound (22 November 2026, no retraining)

When an accent turns a place name into other words, `engines/ears-spot.js` looks for each of the city's names in the model's
sounds (before words are chosen) and the page answers about a clear winner or offers the closest names as buttons. Stand-in accented
English (five non-native Piper voices and two native ones, 40 names, 560 clips, heard through the page's own audio path):

| | Names found | + offered as a button | A wrong place |
|---|---|---|---|
| Words only (before) | 370 (66%) | | 14 |
| **With names by sound** | **402 (72%)** | 81 (86% found or one tap away) | 10 |
| … the Danish voice alone | 31 → 37 of 80 | 19 | 3 → 2 |

Ordinary questions (291 English, 368 Spanish clips): names found 94 → 101 and 72 → 73, no new wrong answer.
Method and every setting: `training/asr/probe/README.md`, "Names by sound".

**Learning from picks** (still no retraining): a name picked among "Did you mean" is kept on the device as the sounds the model heard
for it, one more reading of that name. After one pick on "Is X open?", the same voices' "X, when is it open?" found 192 → 211 of
280 names, with no new wrong answer on ordinary questions ("Learning from picks" in the same README).

### The first model (20 November 2026)

With the matcher and San Miguel's word list, on synthetic Mexican Spanish requests (`training/asr/probe/`):

| 72 held-out clips (Piper es_MX claude, ald) | Understood exactly as said | The thing asked for heard right | Words wrong | Places found |
|---|---|---|---|---|
| **Tiny ears** | **80.6%** | **46 of 52** | **8.8%** | 9 of 12 |
| Teacher (1.2 GB) | 58.3% | 33 of 52 | 32.7% | 10 of 12 |
| Whisper tiny (39M parameters, as the sites used it) | 29.2% | 12 of 52 | 47.7% | 6 of 12 |

| 144 clips, voices never heard in training | Understood exactly as said | The thing asked for heard right | Words wrong | Places found |
|---|---|---|---|---|
| **Tiny ears** | **85.4%** | **96 of 108** | **11.6%** | 24 of 32 |
| Teacher | 65.3% | 84 of 108 | 23.6% | 22 of 32 |
| Whisper tiny | 52.1% | 62 of 108 | 25.5% | 18 of 32 |

By voice: Argentina (es_AR daniela) 75.0% (teacher 52.8%, Whisper tiny 38.9%); Spain (es_ES sharvard) 95.8% (77.8%, 65.3%).
Language (English or Spanish) right: 93.8% (Whisper tiny 97.2%). In the browser, `test/ears.test.mjs` checks that the worker
hears four recorded questions word for word as the Python probe did, and `test/demo.test.mjs` a question through a microphone.

## Limits and risks

- **Synthetic voices only.** Every number above is on text-to-speech voices. Real speakers, accents across Mexico, children,
  older voices, a noisy bar and cheap phone microphones are not measured yet; expect lower numbers. The next test is 5–10
  consented Mexican speakers.
- **English** was the weaker side in the first model; the retrain closed most of the gap (above). Before it: (about a quarter of the training speech; 80–100% of words in short checks where Whisper
  tiny.en heard all).
- **Closed vocabulary.** A word outside the list comes out as the nearest list word, or nothing: right for a guide, wrong for
  dictation. A page should show what was heard so the visitor can correct it, as the demo does.
- **Accent coverage** follows the data: central Mexican, other Latin American, US English. Spanish from Spain and Argentina did
  well on synthetic voices, but that is not evidence for every accent.
- Runs entirely on the device: no audio is sent anywhere by the model or the worker.

## Share-alike

CC BY-SA 4.0 applies to this model file and to models adapted from it (fine-tuned, pruned, re-quantized): give the
attribution above and share them under CC BY-SA 4.0 too. The code that runs it (Apache-2.0) and the word lists are separate
works. This is how the tiny-speech authors read the licences, not legal advice.
