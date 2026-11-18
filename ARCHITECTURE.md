# tiny-speech: architecture proposal (draft, 18 Nov 2026)

A bilingual (English / Mexican Spanish) voice front end for local data: restaurant finder
("sushi tonight, what's open?") and news search and playback. Speech in, speech out, on the device.
Status: **proposal; no engine chosen yet.** The three files in `src/` are early drafts written
before this proposal (text normalization, text language ID, a two-recognizer language "race").

Voice credit: [tiny-voca](https://github.com/n4ze3m/tiny-voca) by Muhammed Nazeem (Apache-2.0),
a 4.5M-parameter TTS model that runs on a CPU and in the browser.

## 0. Decisions (18 Nov 2026)

| # | Decision | Consequence |
|---|---|---|
| D1 | **Browser first, app later** | Everything sits behind engine interfaces; only engines that also run natively (Sherpa-ONNX, tiny-voca GGUF via plain JS / llama.cpp / Rust). The app starts as a shell around the web build (Capacitor for phones, Tauri for desktop), then swaps in native engines. |
| D2 | **Language detected on every question**, with a manual EN/ES override | A language gate before recognition. Near term: Whisper's own language guess on the recorded question. Streaming: a race of two recognizers, later a small classifier or one bilingual model. |
| D3 | **A shared core in this repo** used by MapSMA /page5 and CredBrief /page40 | The voice plumbing both sites copy by hand moves here once, versioned; each domain plugs in its own reader and actions. |

## 1. Starting point: MapSMA /page5 and CredBrief /page40

[mapsma.com/page5](https://mapsma.com/page5/) answers restaurant questions by voice, EN/ES.
[credbrief.com/page40](https://credbrief.com/page40/) answers news questions by voice, EN.

| Area | page5 (places) | page40 (news) | Implication |
|---|---|---|---|
| ASR | transformers.js worker; Whisper tiny.en (~40 MB); multilingual Whisper tiny forced to `es`; record, then transcribe (0.7 s pause ends, 8 s max) | Same worker; Whisper tiny.en, Moonshine Tiny (~30 MB) or Base (~63 MB); 5 s max | No live partials yet |
| Language | Chosen once on an opening screen | English only | D2 replaces both |
| Names | Place names as a Whisper prompt: 10/10 vs 8/10 right on ten spoken tests | None | Any engine needs biasing (Sherpa: hotwords) |
| Answers | Deterministic: `read.js` (words -> request) + `ask.js` (request -> answer), no AI | Server: a small model plans, searches CredBrief's archive and streams the answer (`found`, `delta`, `done`) | News needs both: local commands and a hand-off to the server |
| Voice | tiny-voca ONNX + Pyodide (~45 MB); Spanish names as phone overrides (`spanish.js`); Spanish answers in the phone's Mexican voice | tiny-voca M2 with a pitch setting, Kokoro-82M (~90 MB), or the device voice; reads each sentence as it streams in | Not yet one voice across both languages |
| Measuring | — | Timing panel: last word to first word heard, split into pause, loading, speech to text, server, voice, page | Reuse as the core's latency metric |
| Lessons | Two onnxruntime-web instances ran an iPhone out of memory (pinned 1.18 single-thread); Safari cache eviction (Cache Storage + `persist()`); one `<audio>` unlocked on the first tap (Web Audio stayed silent on one browser); no echo cancellation (voice-call mode on a Mac); never play while recording; Quiet mode | | Hard rules for the core |
| Duplication | `listen.js`, `asr-worker.js`, `tinyvoca-worker.js` copied from page40 | | Already drifted: 1, 48 and 37 lines differ |

## 2. Sherpa-ONNX + Zipformer (from the docs source)

- Streaming transducers with partials and endpointing, hotwords (transducer + `modified_beam_search`),
  Silero VAD (~2 MB), WASM builds (asr, vad, vad-asr, kws, tts), native builds for app/embedded.
- English: `streaming-zipformer-en-20M` (int8 encoder ~41 MB per the docs listing; LibriSpeech only).
- Spanish: no official streaming Zipformer in the docs. Community: kroko `es`, bookbot
  `zipformer-streaming-robust-es-v0` (quality and license unverified).
- `nemotron-3.5-asr-streaming-0.6b`: es-US/es-ES with automatic language tags, but ~627 MB int8 encoder:
  a teacher or server model only.
- Spoken LID via Whisper tiny is ~98 MB int8 in Sherpa: too big to only pick between two languages.
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

## 4. Architecture

```
mic -> capture (AudioWorklet, 16 kHz) -> endpointing/VAD -> language gate (EN|ES, override)
        -> ASR engine (hotwords from the domain's names)  -- partials -> screen
        -> reader (deterministic, per domain) -> request
        -> fixed list of permitted actions -> local data (places, news feed)
                                           -> or hand-off: "ask CredBrief" (server answer, streamed)
        -> responder (es-MX / en templates, language-tagged sentences) -> voice engine (one tiny-voca voice)
```

### Shared core layout (D3)

```
tiny-speech/
  core/       no DOM; runs in page, worker, Node tests, app shell
    text/       normalize, numbers and clock times (en, es-MX)
    lid/        text LID, recognizer race, gate
    request.js  request shape and the permitted-action list (MapSMA read.js pattern)
    respond.js  language-tagged sentences for the voice and the screen
    es-mx.js    Spanish -> voice phones (spanish.js, from names to whole sentences)
  domains/
    places/     MapSMA's reader and answers (read.js, ask.js), data passed in
    news/       feed search, read aloud, next/pause/stop; "ask CredBrief" hand-off
  browser/    the plumbing both sites copy today
    capture (pcm-worklet), listen.js, asr worker, voice worker, player (one <audio>), timing, cache/persist
  engines/    AsrEngine: transformers.js (today), sherpa-onnx (streaming)
              VoiceEngine: tiny-voca plain JS (GGUF), device voice
```

Each site loads a pinned version (the `?v=` pattern both pages use). Interfaces:

- `AsrEngine`: `load()`, `start({lang|null, hotwords})`, events `partial`, `final {text, lang, words?}`.
- `LanguageGate`: `manual` | `whisper-lid` | `race` | `classifier`; always overridable.
- `Domain`: `read(text, lang, context) -> request`, `answer(request) -> {sentences, cards, effects}`.
- `VoiceEngine`: `speak([{lang, text}])`, `stop()`; one voice for both languages.

### Recommendations

1. ASR: **bake-off before committing**: transformers.js Whisper/Moonshine (baseline), Sherpa en-20M +
   a Spanish Zipformer, Vosk. Sherpa likely, if a Spanish model holds up on Mexican speech; it also
   runs natively for the app (D1).
2. Voice: **tiny-voca plain-JS build** (one 8 MB GGUF, no Pyodide, no onnxruntime): removes the second
   runtime that ran the iPhone out of memory, and the same GGUF runs in llama.cpp and Rust for the app.
   Interim Spanish: same voice through `es-mx.js` (American accent). Then train the bilingual voice.
3. News: deterministic commands locally on the feed (this repo's `feed.xml`, or CredBrief's archive);
   open questions go to CredBrief's server as one permitted action, as page40 does today.

Size: VAD 2 MB + EN ASR ~42 MB + ES ASR 35–70 MB + runtime ~10 MB (to measure) + voice 25–40 MB
(~10 MB quantized) + interpreter and data 1–5 MB = about 100–170 MB. With one bilingual ASR: ~70–90 MB.

## 5. Design steps

0. **Test set and timing.** 150–200 recorded questions (EN, es-MX, mixed, name-heavy, news). Metrics:
   language accuracy, command success, first partial, page40's timing split, iPhone memory, download size.
1. **Shared core v0, no behavior change.** Move `listen.js`, the capture worklet, the ASR worker (union of
   both variants: name hints and language) and the voice worker here; both pages switch to it.
2. **Auto language per question** on today's engine (Whisper's language guess, then the matching
   model), with the override. Swap to plain-JS tiny-voca; Spanish answers in the same voice.
3. **Command layer.** Lift `read.js` / `ask.js` into `domains/places`; build `domains/news`
   (search, read, next, pause, stop) plus the CredBrief hand-off. Node tests.
4. **Streaming bake-off** in the browser: Sherpa WASM (EN + ES candidates, hotwords) vs baseline;
   race-based language gate.
5. **Train the bilingual tiny-voca voice** (extended phone inventory, fine-tune from upstream,
   Mexican teacher voice, accent checks).
6. **App shell** (Capacitor / Tauri) around the web build; native Sherpa adapter. Optional: train one
   bilingual streaming recognizer, using Nemotron es-US to label Mexican audio.

## Open points

- Where the sites load the core from (copied into each site per release, or served from one place).
  The MapSMA and CredBrief sources are not in this session; only their published pages were read.
- Mixed-language questions (code-switching) are out of scope for now (D2 is per question).
