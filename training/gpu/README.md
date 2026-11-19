# Training the bilingual voice on a rented GPU

The scripts that turn the speaker's recordings into one tiny-voca voice that speaks English and Mexican Spanish
(`training/RECIPE.md`). They run on one rented machine with an NVIDIA GPU; nothing here needs a GPU on your side.

**Cost and time (estimate):** about 7–9 GPU hours on one RTX 4090: the teacher reads about 8 hours of sentences (3–4 h),
annotation (under 1 h), training 30,000 steps (2–3 h), gates (15 min). At about $0.40–1.25 an hour, depending on the service,
**about $5–12**. `HOURS` (default 10) stops the run cleanly by then, whatever it has done.

## What runs, in order (`run.sh`)

| Stage | Script | What it does |
|---|---|---|
| recordings | `recordings.py` | the session zips → 24 kHz clips; the calm reference sentences joined into one Spanish and one English reference clip |
| sample | `teacher.py --sample 20` | the teacher reads 20 sentences a language in the speaker's voice, for you to hear **before** the full run |
| teacher | `teacher.py` | Qwen3-TTS reads `training/data/teacher.jsonl` (7,576 sentences) in the speaker's voice; Whisper keeps only clips it hears right, in the right language |
| originals | `originals.py` | tiny-voca's own F2/M2 English clips (1,432), so English does not drift |
| manifest | `manifest.py` | the three sources → train / validation / test (by sentence) |
| init | `init_checkpoint.py` | the released checkpoint grown to 87 symbols and a third speaker, MX1 (`LIKE`: starts from M2 or F2) |
| prepare, annotate | upstream `tiny_voca.prepare`, `tiny_voca.annotate` | features; alignment with upstream's wav2vec2 aligner (it knows every Spanish sound) |
| train | upstream `tiny_voca.train --init-from … --new-data` | fine-tuning, fresh critics from step 4,000 |
| dump, gates | `dump.py`, `gates.py` | the weights for the page's GGUF; the 400 held-out sentences read and heard back |

Upstream tiny-voca is cloned at a pinned commit and patched by `patch_upstream.py` (the Spanish symbols, and a "table" front
end that reads each sentence's tokens from `training/data/phonemes.jsonl`, made here by the same code the page runs).

## Steps

1. **Rent** one machine: an RTX 4090 (24 GB) or larger, a PyTorch / CUDA 12 image, about 60 GB of disk (RunPod, Vast.ai,
   Lambda…). Open a terminal on it, and use `tmux` so a closed browser tab does not stop the run.
2. **Copy this repository onto it** (it is private: `git clone` with a GitHub token, or upload the `tiny-speech` folder as a zip).
3. **Set up:** `bash tiny-speech/training/gpu/setup.sh` (about 10 minutes; downloads the models).
4. **Upload the recording zips** from the recording page into `~/tsw/zips/`.
5. **Hear a sample first:** `bash tiny-speech/training/gpu/run.sh sample`, then listen to the files in `~/tsw/teacher-sample/listen/`.
   Go on only if it sounds like the speaker, and Mexican in Spanish.
6. **The full run:** `LIKE=M2 bash tiny-speech/training/gpu/run.sh all` (`LIKE=F2` for a female speaker). If the machine stops,
   run the same command again: finished stages are skipped and training resumes from its last checkpoint.
7. **Download** `~/tsw/result.tar.gz` (about 40 MB), then **stop the machine** (a stopped machine still costs for its disk; delete it
   when the result is safe).

## Back here

```
tar xzf result.tar.gz -C tiny-speech/training/result
node tools/voice-gguf.mjs pack training/result/dump --like M2     # → vendor/tiny-voca/tiny-voca-bilingual.gguf
```
Then the gates (`training/RECIPE.md` section 7): `training/result/gates/gates.json` (words heard right in each language: at
least 90%), the names gate on `gates/heard.jsonl`, your ear on `gates/listen/`, and size and speed on your iPhone with the
check page (`browser/check.html?voice=js&model=…`). Spanish answers switch from the phone's voice only when all four pass (D7).

## Checked here, before any GPU time

- `tools/voice-gguf.mjs` rebuilds the released `tiny-voca-js.gguf` byte for byte from its float32 source, and the untrained
  bilingual file speaks English with exactly the released model's samples (`test/voice-bilingual.test.mjs`).
- `training/data/phonemes.jsonl` has tokens for every text, made with the page's own code; for tiny-voca's 1,432 English
  clips they equal the tokens its own Python phonemizer gave.
- See `training/gpu/SMOKE.md` for the CPU dry run of the Python stages (patch, init, prepare, annotate, a few training steps, dump).
