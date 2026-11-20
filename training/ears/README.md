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
| ~100 hours of speech, converted to 16 kHz FLAC | `prepare.py` | 45–75 min |
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

**Training** (`train.py`): the teacher's top 8 sounds per frame as a soft target (frames the teacher is sure are silence
count half), plus CTC on the teacher's best sequence. The audio is made harder as it is drawn: speed ±10%, noise, another
voice behind, a phone's 300–3400 Hz band, a room's echo, hidden mel bands and moments. The learning rate runs on the clock
(warm-up, then cosine to the end of the time given), so the run fits any session length. It checks against the teacher on
held-out clips every 30 minutes (`dev_sound_error_vs_teacher`: lower is better) and keeps the best (`best.pt`).

**Export** (`export.py`) gates: the 8-bit file is at most 10 MB; the 32-bit ONNX gives the same numbers as PyTorch; the 8-bit
file's best sound agrees with the 32-bit one on at least 90% of frames. The mel filter bank stays 32-bit (it multiplies a
power spectrum).

## Running it

**Kaggle (recommended):** free, about 30 GPU hours a week, sessions up to 12 hours that keep running with the browser
closed. Needs a phone-verified account (for the GPU and the internet). New notebook → File → Import notebook →
`ears.ipynb`; Settings: Accelerator **GPU T4**, Internet **on**; **Save Version → Save & Run All**. The result is in the
notebook's Output: `tiny-ears/onnx/ears-int8.onnx`, `report.json`, `train/log.jsonl`.
From this repository's cloud session, with a Kaggle API token saved as a network secret for `api.kaggle.com` (never in a
file or the chat): fill `kaggle/kernel-metadata.json`'s id with the username, copy `ears.ipynb` next to it, then
`kaggle kernels push -p <folder>`, `kaggle kernels status`, `kaggle kernels output`.

**Colab:** Runtime → Change runtime type → **T4 GPU**; Run all. Free sessions are shorter and can stop when idle; the
results and checkpoints go to Google Drive (`MyDrive/tiny-ears`) and running again resumes.

**Any GPU machine:** `python run.py all --work ~/ears-work --out ~/tiny-ears --hours 11`.

**Then, here:** the probe with the student, on the same 144 Piper clips (choose nothing on the held-out half):
`python ../asr/probe/probe.py --onnx tiny-ears/onnx/ears-int8.onnx --cache probe-emissions-ears --manifest <clips.jsonl>
--split dev --lexicon lexicon.json --out heard/ears.jsonl`, then `node tools/asr-eval.mjs`. The bar: it should keep most of
the large recognizer's 58.3%, and beat Whisper tiny (29–31%) clearly; then the real speakers' test decides.

## Checked here, on a CPU (20 Nov 2026)

- `student.py`: 7,536,088 parameters; frames line up with the teacher's for any length.
- `prepare.py`: one CIEMPIESS Light shard (4,143 clips, 5.8 hours) and the Piper training clips; no dev or test clip gets in.
- `teach.py`: 300 clips labelled (9× real time on this CPU; a T4 in half precision is far faster).
- `train.py`: runs, saves, resumes. It learns: on 40 clean clips the student left the silence-only phase after about 120
  steps and fitted the teacher's labels (loss 13.7 → 0.36). On 260 clips with every hardening on, 350 CPU steps were
  still in that phase: expected this early; a GPU run takes tens of thousands of steps.
- `export.py`: 8.88 MB at 8 bits, ONNX equal to PyTorch (4e-6), gates pass.
- `probe.py --onnx`: the matcher reads the student's output.
- Not run here: a real training run (a GPU's work), the notebook on Kaggle or Colab.

**Licence note for the owner:** CIEMPIESS and the Google Latin American sets are CC BY-SA 4.0. Whether a model trained on
them must be shared alike is not settled; the safe course is to credit them on the sites (as tiny-voca is credited) and to
publish the ears file under CC BY-SA 4.0 too, or to train without them (`--sets librispeech` plus other sets).
