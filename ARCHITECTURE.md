# tiny-speech: architecture proposal (draft, 18 Nov 2026)

A bilingual (English / Mexican Spanish) voice front end for local data: restaurant finder
("sushi tonight, what's open?") and news search and playback. Speech in, speech out, on the device.
Status: **shared core v0 built** (`browser/`, tested in `test/`); the voice is tiny-voca (D4). The files
in `core/` are early drafts written before this proposal (text normalization, text language ID, a
two-recognizer language "race", which the tiny recognizer's language head would make unnecessary).

Voice credit: [tiny-voca](https://github.com/n4ze3m/tiny-voca) by Muhammed Nazeem (Apache-2.0),
a 4.5M-parameter TTS model that runs on a CPU and in the browser.

## 0. Decisions (18 Nov 2026)

| # | Decision | Consequence |
|---|---|---|
| D1 | **Browser first, app later** | Everything sits behind engine interfaces; only engines that also run natively (Sherpa-ONNX, tiny-voca GGUF via plain JS / llama.cpp / Rust). The app starts as a shell around the web build (Capacitor for phones, Tauri for desktop), then swaps in native engines. |
| D2 | **Language detected on every question**, with a manual EN/ES override | A language gate before recognition. Near term: Whisper's own language guess on the recorded question. Streaming: a race of two recognizers, later a small classifier or one bilingual model. |
| D3 | **A shared core in this repo** used by MapSMA /page5 and CredBrief /page40 | The voice plumbing both sites copy by hand moves here once, versioned; each domain plugs in its own reader and actions. |
| D4 | **Build around tiny-voca**: extend what that model does, and keep the whole stack small with its ideas (19 Nov 2026) | The voice is tiny-voca, made bilingual. The other parts follow the same recipe (section 4a), so large off-the-shelf engines become baselines and fallbacks, not the target. |
| D5 | **Music means live music venues in San Miguel** (19 Nov 2026), alongside food, drink and news | Music is a facet of MapSMA's places, not playback: data per venue (genres, nights, times), the reader's existing `music` topic extended, genre and band words in the ears' dictionary (section 4b). |

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

### 4a. tiny-voca's ideas, applied to the whole stack (D4)

What keeps tiny-voca small (4.5M parameters, one 8 MB file):

1. **A narrow job, trained from scratch, taught by a big model.** Its audio came from a large TTS
   (Qwen3-TTS) and was screened by Whisper; the whole model cost $9.56 of GPU time.
2. **Known structure in code, not in weights.** Durations, pitch and energy are explicit, and the
   waveform comes from a source-filter synthesizer (26k parameters) instead of a neural vocoder.
3. **Rules and tables first, a tiny learned part for the rest.** The phonemizer (dizione) is a
   dictionary, rules and a small model for unknown words.
4. **One small file, no runtime.** GGUF with 8-bit matrices; plain JavaScript in the browser, Node and
   Bun; the same file in llama.cpp, a Rust port and an ESP32.

| Part | Built the tiny-voca way | Target size |
|---|---|---|
| Voice | tiny-voca made bilingual: one voice for English and Mexican Spanish. About ten Spanish phones and a language token are added to its inventory; Spanish phones come from rules (Spanish spelling is regular: `spanish.js`, from names to sentences); fine-tuned from the released checkpoint on teacher audio in one voice, with Mexican-accent checks | 8–10 MB (8-bit), at most ~32 MB |
| Ears | tiny-voca in reverse: a small streaming phone recognizer over the voice's own phone set, with a two-way language head on the same encoder. Words come from a lexicon of what the app knows (commands, cuisines, times, place names, news terms), and spoken names are matched by sound as MapSMA's `read.js` already does. Trained on real English and Mexican Spanish speech (Common Voice incl. México, CIEMPIESS) plus synthetic speech, labelled by a big recognizer and forced alignment | 5–15 MB |
| Language | the recognizer's language head: no second model, no race | ~0 |
| End of speech | `listen.js` (loudness), as today | 0 |
| Interpreter | MapSMA's `read.js` / `ask.js`: rules and tables | 1–5 MB |
| Runtime | plain JavaScript like tiny-voca's `js/`: no onnxruntime, no Pyodide (also ends the iPhone memory problem); GGUF files carry over to the app | — |

Total about 20–35 MB, against 100–170 MB for the off-the-shelf stack in section 2.

Risk, plainly: the voice is the safe part (tiny-voca already has more than a dozen language ports).
The ears are the research bet: a recognizer trained from scratch should handle a closed vocabulary
(commands and names; Sherpa's 3M-parameter keyword spotter shows how small that can be), but not open
dictation. So:

- Open questions ("ask CredBrief anything") keep Whisper tiny (~40 MB) as an optional download.
- Whisper/Moonshine (today's pages), Sherpa and Vosk become the baselines the tiny recognizer is
  measured against, not the target.
- News: deterministic commands locally on the feed (this repo's `feed.xml`, or CredBrief's archive);
  open questions go to CredBrief's server as one permitted action, as page40 does today.

Flexibility for unexpected questions, still small: a full English and Spanish dictionary (tiny-voca packs
125k English words into 0.55 MB; Spanish needs only a word list, its sounds follow from spelling) with a
language model weighted to food, drink, music and San Miguel; words outside it kept as sound-spellings
and matched by sound; the reader spots known concepts in any wording (a bilingual concept table) and
searches the site's data for the rest; a large language model writes and labels thousands of possible
questions at build time (never on the phone) to fill the concept table, a tiny classifier and the ears'
training text; low confidence asks one short question back. About 8–12 MB in all.

### 4b. Music venues (D5)

MapSMA already has most of the reading: `read.js` has a `music` topic ("live music", "jazz",
"música en vivo", "conciertos"…) matched to the `live_music` feature in `facts.js`, but only two places
carry that feature (18 Nov 2026). What music needs:

- **Data, per venue** (in `data/facts.json`, beside `c`, `d`, `f`): `live_music` in `f`, plus
  `m: {g: ["jazz", "trova"], when: {"thu": "20:00–23:00", "fri": "21:00–00:30"}}`: genres, and the music's own
  hours in the opening-hours format (past midnight allowed). Music-first places (bars, jazz clubs) join
  `data.js` like any place; the Jardín's mariachis are already a sight.
- **Reading:** genre words in English and Spanish (jazz, blues, rock, trova, bolero, son, mariachi, salsa,
  cumbia, flamenco, DJ, karaoke, open mic, acoustic…), "who is playing", "para bailar"; "tonight" and
  "now" measured against the music's hours, not only the kitchen's; "quiet", "sin música" as a wish too.
- **Answers:** "Three places with live jazz tonight: …, music from 9 p.m." / "Tres lugares con jazz en
  vivo esta noche: …, música desde las nueve."
- **Ears:** genre words and venue and band names in the dictionary and the language model, refreshed
  with the data.

## 5. Design steps

0. **Test set and timing.** 150–200 recorded questions (EN, es-MX, mixed, name-heavy, news). Metrics:
   language accuracy, command success, first partial, page40's timing split, iPhone memory, download size.
1. **Shared core v0, no behavior change.** Move `listen.js`, the capture worklet, the ASR worker (union of
   both variants: name hints and language) and the voice worker here; both pages switch to it. (Built.)
2. **Voice v1, the tiny-voca way.** Swap the voice worker to plain-JS tiny-voca (one 8 MB GGUF instead
   of onnxruntime + Pyodide, about 45 MB); Spanish answers in the same voice through rules (American
   accent until step 5).
3. **Auto language per question** on today's engine (Whisper's language guess, then the matching
   model), with the override, until the tiny recognizer replaces it.
4. **Command layer.** Lift `read.js` / `ask.js` into `domains/places`; build `domains/news`
   (search, read, next, pause, stop) plus the CredBrief hand-off. Node tests.
5. **Train the bilingual tiny-voca voice** (extended phone inventory, fine-tune from upstream,
   Mexican teacher voice, accent checks).
6. **Ears, research track.** Data and test set first; a phone recognizer prototype with a language
   head; measured against Whisper tiny and Sherpa on the step-0 questions.
7. **App shell** (Capacitor / Tauri) around the web build; the same GGUF files natively.

## Open points

- Where the sites load the core from (copied into each site per release, or served from one place).
  The MapSMA and CredBrief sources are not in this session; only their published pages were read.
- Mixed-language questions (code-switching) are out of scope for now (D2 is per question).
