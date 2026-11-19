# Teaching the ears Mexican Spanish restaurant requests

**On hold (owner, 19 Nov 2026).** Everything below is built and checked on a CPU, and waits. Picking it up starts with
"What to do first": measure stock Whisper tiny on 5–10 real speakers before spending on a GPU.

The sites hear questions with Whisper tiny (39M parameters, about 40 MB at 8 bits, in the browser). It was not trained on
people asking a phone for tacos in San Miguel, and it shows. On 144 held-out synthetic Mexican Spanish requests (Piper's two
Mexican voices, dev split) stock Whisper tiny got **41.1% of the words wrong**; the app found the named place in 62.5% and
understood the request as said in 34.7%. "¿Qué onda?" became "Quero undar"; "cerca" became "Seca".
**With the name hint the sites send, words got worse (52.8% wrong)** for one more place found (65.6%): stock tiny sometimes
loops ("de de de de…") or copies the hint's comma-list style ("Entío, Lucas, Aycomida"). Synthetic voices may be harder than
real people; **the real speakers' test decides** (see "What to do first").
The plan: fine-tune the same model on a restaurant-request dataset, about 70% synthetic voices and 30% real native Mexican
speakers, with transcripts checked against the audio and many different speakers, then ship it in the same format, at the
same size, as the file the sites load today.

## What to do first (19 Nov 2026)

Measure before training: 5–10 native speakers each record one packet (`training/record/?set=asr&packet=N`, about 15
minutes); stock Whisper tiny is then measured on their test takes here, on a CPU, at no cost (`transcribe.py`,
`tools/asr-eval.mjs`). If it already understands most requests (85–90% or more), the sites keep it; if it is anywhere near the
synthetic numbers above, the fine-tune below is the most valuable step left (about 3 GPU hours, $2–4). Either way, the size
does not change: a fine-tuned Whisper tiny is the same 39M parameters and about the same file (about 46 MB, 28 MB compressed).

## The dataset

| Part | What | Where |
|---|---|---|
| **Text** | 3,892 things people say to a restaurant app: requests, corrections ("no, mejor de mariscos"), follow-ups ("¿y mañana?"), place names, local expressions (ahorita, chelas, botana, comida corrida), numbers and times in words, hesitant speech; Spanish mostly, some English and mixed. Split by sentence: 85% train, 5% dev, 10% test (test sentences are never synthesized for training) | `text/utterances.jsonl` (`tools/asr-text.mjs`) |
| **Synthetic voices, ~70%** | Piper's two Mexican voices (on a CPU) at varied speeds and pitches; 24 made-up Mexican speakers (age, gender, region, manner: Qwen3-TTS VoiceDesign, none a real person) and 6 English ones; optionally Chatterbox Multilingual as a second engine | `synth_piper.py`, `voices.json`, `gpu/synth_voices.py` |
| **Real speakers, ~30%** | native Mexican Spanish speakers on the recording page (`training/record/?set=asr&packet=N`): about 70 sentences each (60 for training, read by that speaker only; 12 test sentences) and 6 cards to say in their own words, with a typed transcript; speaker details by choice (age range, gender, state, microphone) | `prompts.json` (`tools/asr-prompts.mjs`), `CONSENT-ASR.md` |
| **General speech** | FLEURS Latin American Spanish and US English (CC BY 4.0), so the model keeps hearing everything else | `gpu/data.py fleurs` |

**The 70/30 mix is a sampling rule**, not a pile of hours: each training example is drawn from the restaurant set (80%) or
general speech (20%), and a restaurant example is synthetic 70% of the time and a real speaker's 30%, however many hours each
side has. So even a few speakers count for 30%, and the share holds as more record.

**Verified transcripts:** every clip is heard by Whisper large-v3; a synthetic clip whose words it hears more than 25%
differently is dropped (the TTS slipped), and a speaker's take more than 40% different (30% for the cards) is set aside for a
person to check (`review.jsonl`). The recording page itself flags clipped, cut-off, too short or too long takes.

**Speaker diversity:** 2 Piper voices × speed and pitch, 24 made-up Mexican speakers from nine states and four age groups,
every real speaker reading different sentences; augmentation as each example is drawn: speed, level, a phone's narrow band,
a room, babble made from other clips, noise.

**Natural requests, corrections, names and local expressions:** the text categories above, a third of the examples carrying
the page's name hint as Whisper's prompt (so hints keep working), and the measure below.

## Measured the way the app uses it (`tools/asr-eval.mjs`)

For each test set (real speakers' test takes: new voices and new sentences; synthetic dev; FLEURS test), stock and fine-tuned,
with and without the name hint: **word errors**, **places found** from what was heard, **understood as said** (the reader's
request from what was heard equals its request from what was said), and **language right**. The fine-tuned model replaces
stock Whisper tiny on a site only if, on the real speakers' test, words and places and understanding are all better, and
FLEURS (everything else) is no worse than one point of word error.

## Running it

1. **Record** (any time, several speakers): `training/record/?set=asr&packet=N`, a different packet for each speaker, consent
   first (`CONSENT-ASR.md`). The fine-tune runs without recordings too (synthetic only), but the real test needs them.
2. **On a GPU machine** (the same one as the voice run is fine): `bash tiny-speech/training/asr/gpu/setup.sh`, the zips in
   `~/tsw-asr/zips/`, then `bash …/run.sh sample` (listen to the made-up voices), then `bash …/run.sh all`.
   **About 3 GPU hours** (the made-up voices reading ~3,400 sentences, 1–1.5 h; checking ~10,000 clips with large-v3; FLEURS;
   4,000 training steps; export; transcribing the test sets): **about $1.50–4**.
3. **Back here:** `node tools/asr-eval.mjs heard/*.jsonl` for the table; the 8-bit model (`model-onnx/`, the layout of
   onnx-community/whisper-tiny) goes into a site's engines folder and its config (`apps/*.json` asr.models.es).

## Checked here, before any GPU time (19 Nov 2026, CPU)

- Piper's two Mexican voices: 12–23× faster than real time; 2,694 clips (3.1 hours) from the first 1,347 Spanish and mixed
  train and dev sentences (the rest: run `synth_piper.py` again; it resumes).
- Stock Whisper tiny on the 144 dev clips, with and without the hint: the baseline above (`transcribe.py`, `tools/asr-eval.mjs`).
- `gpu/finetune.py`: the mix, the augmentation and the name prompts run (6 steps on CPU).
- `gpu/export.py`: the fine-tuned model in onnx-community's layout, 8-bit, decoder 30.1 MB and encoder 11.7 MB (the file the
  sites load today: 30.7 and 10.1 MB); it transcribes with onnxruntime. The word table, shared by the lookup and the output
  layer, is kept once, at 8 bits, as onnx-community's file does.
- Not run here: the made-up voices (Qwen3-TTS needs the GPU; its VoiceDesign call is checked by `run.sh sample` first),
  large-v3 checking, FLEURS.

Licences: Piper es_MX-claude (dataset Apache-2.0), es_MX-ald (Unlicense; base CC0); Qwen3-TTS (Apache-2.0); Chatterbox (MIT);
FLEURS (CC BY 4.0: credit Google); Whisper (MIT). The restaurant text was written for this project.
