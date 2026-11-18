# tiny-speech: architecture proposal (draft, 18 Nov 2026)

A bilingual (English / Mexican Spanish) voice front end for local data: restaurant finder
("sushi tonight, what's open?") and news search and playback. Speech in, speech out, on the device.
Status: **proposal; no engine chosen yet.** The three files in `src/` are early drafts written
before this proposal (text normalization, text language ID, a two-recognizer language "race").

Voice credit: [tiny-voca](https://github.com/n4ze3m/tiny-voca) by Muhammed Nazeem (Apache-2.0),
a 4.5M-parameter TTS model that runs on a CPU and in the browser.

## 1. Starting point: MapSMA /page5

[mapsma.com/page5](https://mapsma.com/page5/) already answers restaurant questions by voice, EN/ES:

| Area | page5 today | Implication |
|---|---|---|
| ASR | transformers.js worker; Whisper tiny.en (~40 MB) for EN, multilingual Whisper tiny forced to `es` for ES; record, then transcribe (0.7 s pause ends, 8 s max); ~0.3 s per 3 s question | No live partials |
| Language | Chosen by the user on an opening screen | No automatic detection |
| Names | Place names passed as a Whisper prompt: 10/10 vs 8/10 right on ten spoken tests | Any engine needs biasing (Sherpa: hotwords) |
| Interpreter | `read.js` (words -> request) + `ask.js` (request -> answer), no AI; sound-alike name matching, meal windows, "open now" rules | Reuse as the deterministic interpreter |
| Voice | tiny-voca ONNX + Pyodide dizione (~45 MB); Spanish names as phone overrides (`spanish.js`); Spanish answers in the phone's Mexican voice | Not yet one voice across both languages |
| Lessons | Two onnxruntime-web instances ran an iPhone out of memory (pinned 1.18 single-thread); Safari cache eviction; audio unlock on tap; Quiet mode | Design constraints |

## 2. Sherpa-ONNX + Zipformer (from the docs source)

- Streaming transducers with partials and endpointing, hotwords (transducer + `modified_beam_search`),
  Silero VAD (~2 MB), WASM builds (asr, vad, vad-asr, kws, tts), native builds for app/embedded.
- English: `streaming-zipformer-en-20M` (int8 encoder ~41 MB per the docs listing; LibriSpeech only).
- Spanish: no official streaming Zipformer in the docs. Community: kroko `es`, bookbot
  `zipformer-streaming-robust-es-v0` (quality and license unverified).
- `nemotron-3.5-asr-streaming-0.6b`: es-US/es-ES with automatic language tags, but ~627 MB int8 encoder:
  a teacher or server model only.
- Spoken LID via Whisper tiny is ~98 MB int8: too big to only pick between two languages.
- The WASM demos build one model into the bundle; two models need a custom build or runtime loading,
  and bring their own onnxruntime (see the iPhone memory lesson).
- Also: Moonshine v2 `base-es` (offline), Piper `es_MX` voices (ald, claude, daniela; one language
  each), Supertonic 3 (31 languages, one speaker id across languages; size and license to check).

## 3. Spanish vs Mexican Spanish

| Area | Generic Spanish | Mexican Spanish needs |
|---|---|---|
| ASR acoustics | Mixed data (Common Voice, audiobooks, parliament) | Measure on Mexican speech (Common Voice "México", CIEMPIESS); fine-tune if needed; vowel reduction ("pues" -> "ps") |
| ASR vocabulary | Generic | Nahuatl and San Miguel names via hotwords; English mixed in ("rooftop", "Is La Azotea open?") |
| Interpreter | Spain's meanings | ahorita, al rato, mande, "cuarto para las nueve" = 8:45, comida = midday meal, almuerzo = late breakfast |
| Voice | tiny-voca-es and mini-voz are Castilian | seseo, yeísmo, x as in México, "tl" onsets, Mexican intonation; a Mexican-accented teacher voice |

## 4. Proposed architecture

```
mic -> capture (16 kHz) -> VAD -> language gate -> ASR (EN|ES, hotwords from names)
                                                   | partials -> screen
                                                   v endpoint
                   reader (deterministic, per domain) -> request
                                                   v
                   fixed list of permitted actions -> local data (restaurants, news feed)
                                                   v
                   responder (es-MX / en templates, language-tagged text) -> one tiny-voca voice
```

Decisions (recommendation in bold):

1. Runtime: **browser first** (MapSMA, CredBrief exist), only engines that also run natively.
2. ASR: **bake-off before committing**: Whisper/Moonshine (baseline), Sherpa en-20M + a Spanish
   Zipformer, Vosk. Sherpa likely, if a Spanish model holds up on Mexican speech.
3. Language ID ladder: manual override (always) -> race of two recognizers over the first ~1 s
   (no extra model, ~2x CPU briefly; weak on name-only questions) -> tiny EN/ES classifier (<1 MB)
   -> one bilingual streaming model (LID for free, handles code-switching, ~30 MB instead of ~80 MB).
4. Voice: **tiny-voca plain-JS build** (one 8 MB GGUF, no Pyodide, no onnxruntime). Interim:
   `spanish.js` extended from names to sentences (same voice, American accent). Then train the
   bilingual voice.
5. Interpreter: lift `read.js` / `ask.js` into a domain-pluggable core; add news (this repo's
   `feed.xml`, or CredBrief /page40).

Size: VAD 2 MB + EN ASR ~42 MB + ES ASR 35–70 MB + runtime ~10 MB (to measure) + voice 25–40 MB
(~10 MB quantized) + interpreter and data 1–5 MB = about 100–170 MB. With one bilingual ASR: ~70–90 MB.

## 5. Design steps

0. Test set: 150–200 recorded questions (EN, es-MX, mixed, name-heavy, news). Metrics: LID accuracy,
   command success, time to first partial, total latency, iPhone memory, download size.
1. Shared core without models: actions, request format, lifted parser, news domain, responses,
   es-MX phonemizer; Node tests.
2. Voice runtime swap to plain-JS tiny-voca; Spanish in the same voice; listen tests with Mexican listeners.
3. ASR and LID bake-off on desktop and iPhone.
4. Build the chosen streaming path with the language gate and hotwords.
5. Train the bilingual tiny-voca voice (extended phone inventory, fine-tune from upstream, Mexican teacher, accent QA).
6. Optional: train a bilingual streaming recognizer, using Nemotron es-US to label Mexican audio.

## Open questions

- Is a local or embedded app a real target, or browser only?
- Language per question, or per session with a switch (as MapSMA)? Mixed-language questions expected?
- One app with both domains, or a shared core for MapSMA /page5 and CredBrief /page40?
