# The tiny ears: an 8–10 MB bilingual sound recognizer (20 Nov 2026)

**Goal (owner):** bilingual EN / ES-MX ears of 8–10 MB for restaurant and event questions, in the browser. Whisper tiny cannot
be that small (39M parameters). The probe (`../asr/probe/`) showed the design that can: a recognizer of *sounds* plus the
city's word list. With the large sound recognizer it understood 58.3% of held-out synthetic Mexican requests as said
(Whisper tiny 29–31%). This folder trains the small one.

**How:** the student (`student.py`: a 10-layer Conformer, **7.5M parameters, 8.9 MB at 8 bits**) learns to give the same
answers as the teacher (facebook/wav2vec2-lv-60-espeak-cv-ft, 300M, Apache-2.0), every 20 ms, over the same 392 sounds. So
the probe's matcher, the word list and everything around it work unchanged, and **no transcripts are needed**: the teacher
labels any speech. Raw 16 kHz audio goes in (the sound features are computed inside the model), so the browser needs only
the file and onnxruntime-web.

| Step | Script | On a free T4 (estimate) |
|---|---|---|
| Packages, the teacher, Piper's two Mexican voices | `run.py setup` | 5 min |
| Piper reads the 3,342 training requests (in-domain speech) | `run.py synth` (`../asr/synth_piper.py`) | 15–20 min (CPU) |
| ~100 hours of speech, converted to 16 kHz FLAC, with transcripts | `prepare.py` | 45–75 min |
| The Spanish transcripts as sounds | `phones.mjs` (Node from pip if missing) | 1 min |
| The teacher labels it (top 8 sounds per frame) | `teach.py` | 30–60 min |
| The student learns, until the session's time is nearly up | `train.py` | the rest, about 7–8 h |
| 8-bit ONNX, checked | `export.py` | 5 min |

**The speech** (`prepare.py`; all on Hugging Face, pinned revisions):

| Set | What | Hours | Licence |
|---|---|---|---|
| CIEMPIESS Light, Balance, Fem (UNAM) | **Mexican Spanish** radio and interviews, many speakers, women and men | up to 18 each | CC BY-SA 4.0 |
| Google crowdsourced Latin American Spanish (OpenSLR 71, 72, 61) | Colombian, Argentinian, Chilean volunteers; many sentences are **requests to a voice assistant** | up to 8 each | CC BY-SA 4.0 |
| LibriSpeech clean-100 | US English read speech | 25 | CC BY 4.0 |
| Piper es_MX (claude, ald) | the restaurant requests' **training** sentences (never dev or test: the probe measures on dev) | ~3 | Apache-2.0, Unlicense |

**Training** (`train.py`): three signals. The teacher's top 8 sounds per frame as a soft target (frames the teacher is sure
are silence count half); CTC on the teacher's best sequence; and **CTC on what was actually said**: the Spanish transcripts
(CIEMPIESS, the Google sets, the Piper requests) read by our Mexican rules (`phones.mjs`, `lang/es/ipa.js`). The teacher
mishears some Mexican sounds (it heard "perro" as `p e ɾ o`, "frío" as `f i l o`: `../asr/probe/README.md`); the
transcripts keep the student from copying that, so it can do better than the teacher on Mexican Spanish. The best
checkpoint is the one with the fewest sound errors against what was said on held-out clips. The audio is made harder as it is drawn: speed ±10%, noise, another voice
behind or a restaurant's chatter (3–6 voices), a room's echo, a microphone's colour, a phone line or an 8 kHz phone codec,
clipping, hidden mel bands and moments. The learning rate runs on the clock
(warm-up, then cosine to the end of the time given), so the run fits any session length. It checks against the teacher on
held-out clips every 30 minutes (`dev_sound_error_vs_teacher`: lower is better) and keeps the best (`best.pt`).

**Export** (`export.py`) gates: the 8-bit file is at most 10 MB; the 32-bit ONNX gives the same numbers as PyTorch; the 8-bit
file's best sound agrees with the 32-bit one on at least 90% of frames. The mel filter bank stays 32-bit (it multiplies a
power spectrum).

## The first full run (Kaggle, 20 Nov 2026): it works, and beats the teacher

`larsbo99/tiny-ears-train` version 2 on Kaggle's T4s, 10.7 of the week's 30 free GPU hours. The teacher labelled 59,883 clips
(107.7 h) on two T4s at about 260× real time (under half an hour); the student then trained 10.4 h (119,117 steps, about 100
passes over the data). Every 30 minutes, on 588 held-out clips: sound errors against the teacher fell from 19.7% to 12.1%;
against **what was said** (the Spanish transcripts) the student reached **14.8–17.7%, below the teacher's own 22.0%** (the
transcript CTC at work). `best.pt` (step 28,735, chosen on errors against what was said) became `ears-int8.onnx`: **8,883,368
bytes (8.9 MB)**. The run ended as "ERROR" only because the export's PyTorch-vs-ONNX gate demanded every one of the 392
log-probabilities within 0.01: a few near-silent frames differed by up to 0.5 on sounds at 1-in-20,000, while the best sound
agreed on 99–100% of frames. The gate now checks what is heard (same best sound on 99% of frames, probabilities within 0.05);
re-run here, it passes and makes the same file byte for byte.

**With the probe's matcher and word list** (`../asr/probe/probe.py --onnx ears-int8.onnx`), Mexican Spanish restaurant requests:

| 72 held-out clips (Piper claude / ald) | Understood as said | Thing asked for heard right | Words wrong | Places found |
|---|---|---|---|---|
| **Tiny ears, 8.9 MB** | **80.6%** | **46 of 52** | **8.8%** | 9 of 12 |
| Tiny ears, last checkpoint | 81.9% | 45 of 52 | 10.0% | 9 of 12 |
| Teacher (the large recognizer, 1.2 GB) | 58.3% | 33 of 52 | 32.7% | 10 of 12 |
| Whisper tiny as the sites use it | 29.2% | 12 of 52 | 47.7% | 6 of 12 |

The student trained on other sentences read by these same two synthetic voices, so the same 144 sentences were read again by
two Piper voices it **never heard** (es_AR-daniela-high, Argentina; es_ES-sharvard-medium, Spain):

| 144 clips, unheard voices | Understood as said | Thing asked for heard right | Words wrong | Places found |
|---|---|---|---|---|
| **Tiny ears, 8.9 MB** | **85.4%** | **96 of 108** | **11.6%** | 24 of 32 |
| Teacher | 65.3% | 84 of 108 | 23.6% | 22 of 32 |
| Whisper tiny | 52.1% | 62 of 108 | 25.5% | 18 of 32 |

(Argentina's voice: student 75.0%, teacher 52.8%, Whisper 38.9%; Spain's: 95.8%, 77.8%, 65.3%.) Language right 93.8%
(Whisper 97.2%). What this does not say yet: all of these voices are synthetic, and the sentences are the request corpus's
style; **real Mexican speakers** (5–10, consented) are the test that decides. Next to build: the matcher in JavaScript (a CTC
search over the word list, as `probe.py` does) and an AsrEngine that runs `ears-int8.onnx` in onnxruntime-web: **done the same day**
(plan step B16, `../../browser/README.md`: the worker's model `tiny-ears`, word for word what the probe heard; Whisper tiny stays a choice).

Where the model is: the Kaggle notebook's output (version 2: `onnx/ears-int8.onnx`, `train/best.pt`, `train/last.pt`,
`train/log.jsonl`; `python kaggle/push.py output larsbo99/tiny-ears-train DIR`). Not in this repository: it is trained partly on
CC BY-SA speech (CIEMPIESS, Google's Latin American sets), so how it may be shared waits for the owner's licence decision.

## Running it

**Kaggle (recommended):** free, **30 GPU hours a week** (this account; the API reports it), sessions up to 12 hours that keep
running with the browser closed. Three notebooks, the same `ears.ipynb` with a different `MODE`:

| Notebook | Runs on | What | Time |
|---|---|---|---|
| `tiny-ears-smoke` | CPU (no GPU hours) | every stage on ~350 clips: installs, downloads, transcripts, teacher, training, export | ~20 min |
| `tiny-ears-data` | CPU (no GPU hours) | the ~100 hours of speech, the Piper requests, the transcripts as sounds, packed into its output (~7 GB) | ~2–3 h |
| `tiny-ears-train` | T4 GPU | tiny-ears-data's output as input; a 3-minute GPU check, the teacher's labels, training, export | ~11 h |

So the GPU hours go only to labelling and training, the speech is downloaded once, and a second training round (after the
first one's errors are known) needs no new download. From this repository's cloud session (the Kaggle token saved as a
network secret for `api.kaggle.com`, never in a file or the chat): `python kaggle/push.py push smoke --user NAME`, then
`status NAME/tiny-ears-smoke`, `output NAME/tiny-ears-smoke DIR`; `quota` shows the hours left. By hand: import
`ears.ipynb`, set `MODE`, Accelerator (None, or GPU T4 for train), Internet on, and for train Add Input → Your Work →
tiny-ears-data; then Save Version → Save & Run All.

**Colab:** Runtime → Change runtime type → **T4 GPU**; `MODE = "all"`; Run all. Free sessions are shorter and can stop when
idle; results and checkpoints go to Google Drive (`MyDrive/tiny-ears`) and running again resumes.

**Any GPU machine:** `python run.py --mode all --work ~/ears-work --out ~/tiny-ears --hours 11`.

**Then, here:** the probe with the student, on the same 144 Piper clips (choose nothing on the held-out half):
`python ../asr/probe/probe.py --onnx tiny-ears/onnx/ears-int8.onnx --cache probe-emissions-ears --manifest <clips.jsonl>
--split dev --lexicon lexicon.json --out heard/ears.jsonl`, then `node tools/asr-eval.mjs` (words, places, **the thing asked
for**, understood, language). The bar: keep most of the large recognizer's 58.3% understood and 63.5% of things asked for,
and beat Whisper tiny (29–31%, 23.1%) clearly; then the real speakers' test decides. The run's own log gives, per critical
sound, how often the student and the teacher hear it as said: where the student is still weak decides the next round's data
(targeted Piper sentences, real recordings).

## Checked here, on a CPU (20 Nov 2026)

- `student.py`: 7,536,088 parameters; frames line up with the teacher's for any length.
- `prepare.py`: one CIEMPIESS Light shard (4,143 clips, 5.8 hours) and the Piper training clips; no dev or test clip gets in.
- `teach.py`: 300 clips labelled (9× real time on this CPU; a T4 in half precision is far faster).
- `train.py`: runs, saves, resumes. It learns: on 40 clean clips the student left the silence-only phase after about 120
  steps and fitted the teacher's labels (loss 13.7 → 0.36). On 260 clips with every hardening on, 350 CPU steps were
  still in that phase: expected this early; a GPU run takes tens of thousands of steps.
- The CTC on what was said: 113 of 300 sample clips read into sounds; it trains, and the check reports the student's and
  the teacher's errors against what was said (the teacher: 23.7% on Piper's held-out requests: the bar to beat).
- `export.py`: 8.88 MB at 8 bits, ONNX equal to PyTorch (4e-6), gates pass.
- `probe.py --onnx`: the matcher reads the student's output.
- Not run here: a real training run (a GPU's work), the notebook on Kaggle or Colab.

**Licence note for the owner:** CIEMPIESS and the Google Latin American sets are CC BY-SA 4.0. Whether a model trained on
them must be shared alike is not settled; the safe course is to credit them on the sites (as tiny-voca is credited) and to
publish the ears file under CC BY-SA 4.0 too, or to train without them (`--sets librispeech` plus other sets).
