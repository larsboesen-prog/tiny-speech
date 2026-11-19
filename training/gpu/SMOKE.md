# Dry run on a CPU, 19 Nov 2026

Every stage of `run.sh` that does not need a GPU, run here on a handful of clips (PyTorch 2.8 on CPU, upstream tiny-voca at
`42024af`, patched by `patch_upstream.py`), so the paid run does not find the mistakes. The audio was made by the voices
themselves: the released voice reading English, and the untrained bilingual file (`node tools/voice-gguf.mjs init`) reading
Spanish, written as a recording-page session zip at 48 kHz.

| Stage | Result |
|---|---|
| `patch_upstream.py` | 87 symbols, `<es>` = 86, speakers F2, M2, MX1 by default, x voiceless; the symbol table equals the page's; a second run is refused |
| `recordings.py` | 14 takes from the zip kept, resampled to 24 kHz; Spanish and English reference clips of 12–18 s; the consent tick carried over |
| `init_checkpoint.py` | released step 104,737 grown to 87 symbols and 3 speakers; only the mel head is new; **the new token and speaker rows equal the JavaScript tool's to the last bit** |
| `tiny_voca.prepare` | 12 of 12 clips accepted, MX1 included |
| `tiny_voca.annotate` (CPU) | complete; every Spanish sound has an aligner label; English clips all kept; 4 of 6 Spanish clips from the *untrained* voice rejected as weak alignment (expected: real recordings and the teacher's clips are what training reads) |
| `tiny_voca.train --init-from init.pt --new-data` | 12 steps, critics from step 6, inference.pt written; losses start low (mel 0.54), so the released weights were taken over; `--resume` continues (12 → 15) |
| `dump.py` → `tools/voice-gguf.mjs pack` | 184 tensors → a 7,998,304-byte GGUF the page's engine loads; it speaks Spanish (after `<es>`) and English as MX1 |
| `gates.py` (CPU, 10 sentences a language) | runs end to end; see below |
| `originals.py` (one of the 16 shards, read locally) | 57 of the listed clips found in that shard, written as 24 kHz FLAC |
| `manifest.py` | the sources joined; splits by sentence; every text in the phoneme table |

**Not run here:** `teacher.py` (Qwen3-TTS 1.7B needs the GPU) and `setup.sh` itself (it installs on the rented machine).
Two things found and fixed on the way: the aligner loads its model by name offline, so `setup.sh` now points the cache's
"main" at the pinned revision; and `run.sh` no longer restarts a training run that already reached its steps.

**A first measurement, not a gate:** after 15 CPU steps on 5 clips, i.e. essentially the released English model with the new
Spanish rows started from their nearest English sounds, Whisper small heard 72% of the Spanish words of 10 held-out
sentences said as MX1 (82% as F2), and 93% of the English words. Training on the speaker's Spanish is what must take the
Spanish past the 90% gate.
