# tiny-speech: architecture (v2, 19 Nov 2026)

A bilingual (English / Mexican Spanish) voice core for small local-data apps: places to eat, drink and hear
music, and news, asked by voice and answered by voice, on the phone. It serves MapSMA /page5 (San Miguel de
Allende) and CredBrief /page40 today and is built to take more cities as data.

Voice: [tiny-voca](https://github.com/n4ze3m/tiny-voca) by Muhammed Nazeem (Apache-2.0), a 4.5M-parameter
text-to-speech model that runs on a CPU and in the browser.

This version folds in an independent review by Claude Fable 5.2 (`docs/review-2026-11-19.md`), which the
owner asked for. Its schemas, examples and evidence are there; this file keeps the decisions, the design and
the plan. Earlier drafts are in git history.

**Status:** shared core v0 built and tested (`browser/`: 19 offline tests, plus a live run with the real
models). Next: the build plan in section 11, from B0.

## 0. Decisions

| # | Decision (owner) | Consequence |
|---|---|---|
| D1 | Browser first, app later | Engines behind interfaces; only engines that also run natively; the app starts as a shell around the web build. |
| D2 | Language detected on every question, with a manual EN/ES override | A two-way language decision per question (section 6). |
| D3 | One shared core in this repo for MapSMA and CredBrief | The plumbing both sites copied by hand lives here once, versioned (v0 done). |
| D4 | Build around tiny-voca; keep the stack small with its ideas | tiny-voca is the voice; the other parts follow its recipe where it is measured to work. |
| D5 | Music means live music venues (a facet of places), not playback | Music hours per venue, genre words, freshness rules (section 8). |
| D6 | **Cities are data** (from the review, 19 Nov 2026) | No city, country or site name in code. A city is a pack built from data and loaded at run time; a new city needs no code change and no model training. |

Open, for the owner: see section 12.

## 1. What exists, measured

| | MapSMA /page5 (places, EN/ES) | CredBrief /page40 (news, EN) |
|---|---|---|
| Speech to text | transformers.js worker: Whisper tiny.en (~40 MB) for English, multilingual Whisper tiny told `es` for Spanish; record, then transcribe | Whisper tiny.en, Moonshine Tiny (~30 MB) or Base (~63 MB) |
| Language | chosen once, on an opening screen | English |
| Understanding | deterministic: `read.js` (words → request, language-blind: English and Spanish words in one pass), `ask.js` (request → answer) | a server model plans, searches the archive and streams the answer |
| Voice | tiny-voca through onnxruntime-web + Pyodide ("about 45 MB, once" on the page); Spanish names taught Spanish sounds; Spanish answers in the phone's own Mexican voice | tiny-voca M2, Kokoro, or the device voice |

Facts checked in the review and here:
- `read.js` + `ask.js` + `spanish.js` are 122 KB (40 KB gzipped). San Miguel's voice-relevant place data (places,
  info, hours, facts) is 58.5 KB (14.9 KB gzipped). Of `data.js`'s 1.3 MB, 1.25 MB is the map.
- The Whisper name hint is full: 214 of 223 prompt tokens, "our picks only".
- Opening hours have two sources: `/photos/hours.json` has 54 places; 45 are also in `data.js`, and 20 of those disagree (9 are only in `hours.json`).
- `live_music` is on three places (43, 69, X17).
- San Miguel is written into the code: name tables keyed by place id, area regexes, Susan York's picks as a request
  field, the time zone, the Jardín as centre, walking speed "for hills and cobbles" (review 1.1).
- Live run (19 Nov, headless Chromium, real models): tiny-voca says an English sentence and Whisper tiny.en writes it
  back word for word; Spanish read by today's English-only voice comes back 56% right (`browser/README.md`).

## 2. Layers

```
app config      per site: domains, city or cities, UI language, limits (recording length), cache prefix
city pack       one city's data: places, areas, hours, music, names, local words, collections
language packs  en, es + variety tables (es-MX first): numbers, clock, days, spelling → sounds, word tables, answer templates
core            capture, end of speech, engines, language decision, request shape, reader grammar, actions, responder, loader, timing
```

A layer reads only the layers below it; nothing below "city pack" contains a place's proper noun. A test greps the
code for every pack's proper nouns and fails on a hit.

```
tiny-speech/
  core/       request.js · reader/ · answer/ · respond.js · lang-decide.js · pack/ (schema, loader, name index)
  lang/       en/ · es/ · es/mx.json (variety)
  domains/    places/ (topic tables: cuisines, features, music genres; templates) · news/
  packs/      src/<city>/ (authored data with dates and sources) · dist/ (built, content-addressed)
  tools/      build-pack · validate · sizes · golden-test runner
  browser/    v0: listen, worklet, workers, check page
  engines/    AsrEngine: transformers.js Whisper · VoiceEngine: tiny-voca ONNX, tiny-voca plain JS, device voice
  docs/  test/
```

## 3. Interfaces

- `AsrEngine.transcribe(audio, {lang|null, hint}) → {text, lang, langScores: {en, es}, alternatives?, phones?, ms}`.
  `hint` is prepared per pack and language within the engine's budget. Streaming partials are optional.
- `decideLanguage({langScores, text, maskedText, prior, override}) → {lang, margin, why}`: a pure function.
- `Reader.read(text, now, pack) → request`: language-blind, as MapSMA's already is.
- `Domain.answer(request, pack, lang) → {sentences: [{lang, text, say?}], cards, effects}`: only speakable words reach the voice.
- `VoiceEngine.speak(sentences) / stop()`, with a `phoneset` name. Which engine speaks which language is configuration.
- `Pack.load(cityId) → pack`, `Pack.list() → [{id, names, centre}]`.

## 4. Sizes: today, and the target with what it depends on

| Part | Today | Target | Depends on |
|---|---|---|---|
| Voice | ONNX + Pyodide, ~45 MB (page's label) | plain JS, one 8 MB file | first-sound time and peak memory on the owner's iPhone and one cheap Android |
| Spanish voice | the phone's Mexican voice, 0 MB | bilingual tiny-voca, expected under 10 MB | a training run (GPU) and a listening test |
| Ears | Whisper tiny ~40 MB per language + onnxruntime 10–20 MB | (a) one multilingual tiny for both, if English holds up; (b) a tiny recognizer, 5–15 MB | (a) the recorded test set; (b) data, GPU and the gate in section 6 |
| Language | chosen once | two-way decision, 0 MB | — |
| Interpreter + language packs | 40 KB gzipped | under 100 KB gzipped | — |
| City pack | 15 KB gzipped for 96 places | 300 gzipped bytes a place | section 5 |

Near term, with no research: today's MapSMA English path is about 95–105 MB; the plain-JS voice brings it to
about 60 MB. `tools/sizes.mjs` (B11) will generate this table from the built files.

## 5. Cities (D6)

What is city-specific moves from code to a pack (review 3.1): places, hours (one source, with checked dates),
time zone, centre and walking speed, neighbourhoods, sights, name aliases and readings, curated lists (Susan
York's picks become a generic `collections` entry), local dishes and words, meal hours, music, the recognizer hint,
and later the ears' dictionary. Map geometry is a separate pack the voice never loads.

**Language variety, three levels:** language (`lang/es`), variety (`lang/es/mx.json`: ahorita, almuerzo as late
breakfast, "cuarto para las nueve", sound choices for the voice; later `co`, `ar`, `es`), city (pack `lexicon`:
local words, and readings for indigenous-origin names, where x is /s/, /h/ or /ʃ/ by name). Rule: **understand the
union, speak the local variety.** Packs store names as spelling + language + optional IPA reading, not as one voice
model's phones, so a new voice needs no pack rebuild.

**Pack files:** `index.json` (cities and current versions, fetched fresh), `<city>/<version>/manifest.json`
(immutable: tz, langs, variety, centre, bbox, meals, file hashes, counts, credits), `base.json` (places, areas,
collections, lexicon, built indexes), `live.<hash>.json` (hours, closures, music slots, each with a checked date).
Days are 0–6, Monday = 0, everywhere. Schemas and examples: review 3.3.

**Budget:** 300 gzipped bytes a place: 100 KB for a small city (up to 300 places), 500 KB for a medium one (1,500);
large cities split into zones, with a city-wide name index (~30 bytes a place). The builder fails above budget.

**Build and validation** (`tools/build-pack.mjs`, Node, no network): schema, ids, coordinates in bbox, time zone,
hours parse, checked dates; every name given a sound key, collisions listed, names that are ordinary words flagged
exact-only automatically (replacing hand-kept tables); every name has sounds for the voice, and names needing a
reading are listed; the hint built by rank within its token budget; a per-city question file run through the reader
and asker at fixed clocks. A build-time LLM may propose aliases, likely mis-hearings, descriptions and questions;
its output is committed as data and reviewed as a diff.

**Versions and loading:** version = date + content hash; versioned files cached for a year; the loader checks
SHA-256, swaps only after every file checks out, keeps the last good pack offline, stores at most three cities.
Cache names come from the app config (`cachePrefix`), not from host names in the workers.

**One site per city or many cities in one app:** both, by config (`city: "mx-sma"` or `city: "auto"`); "switch to
Querétaro" is a core action matched against `index.json`; one pack is active at a time.

**Never city-specific:** capture, end of speech, engines and model files; the request shape and the permitted
actions; the reader's grammar; language and variety packs; answer templates; loader, cache, privacy, timing, tests.

## 6. Hearing and language

- **Language decision:** two-way, not 99-way: compare Whisper's `<|en|>` and `<|es|>` scores, add a prior (last
  question, page language), then check with text evidence after transcription, with place names masked out
  ("Is La Azotea open?" is English). Only a low-margin disagreement re-runs in the other language. The reader stays
  language-blind, so a wrong guess costs recognition quality and the answer's language, not understanding.
- **Models in memory:** measure whether one multilingual Whisper tiny serves both languages; else two files, one
  loaded at a time. The two-recognizer race (`core/lid/race.js`) is parked: it contradicts the memory lesson.
- **Name hints** are a ranked budget per pack and language, not "the names": rank by how hard a name is to hear
  without help and how often it is asked; the rest goes through sound matching after the fact.
- **Ears (research):** a tiny phone recognizer with a language head, built tiny-voca's way. It ships only if, on
  the recorded test set, command success is not worse than Whisper tiny + the reader for each language and first
  partials come sooner. Requirement: a new city needs zero training (words and names come from the pack at load).
  Until then `AsrEngine` keeps the result shape that lets any recognizer be swapped in.
- **End of speech:** loudness (`listen.js`), unless noisy recordings (street, a bar with live music) fail.

## 7. Voice

- **Plain-JS tiny-voca** (upstream `js/`, one 8 MB GGUF) behind `VoiceEngine`, English first, gated on first-sound
  time and peak memory on two phones (upstream measured 9.7× real time and 238 MB peak in Node on an Apple M5; phones
  unmeasured). The ONNX worker stays as the fallback.
- **Spanish:** recommended: keep the phone's Mexican voice for Spanish answers until the bilingual voice passes a
  listening test; tiny-voca's Spanish (American accent) as a setting. Owner to confirm (section 12).
- **Bilingual voice:** an experiment with its own gate: about ten Spanish phones and a language token added to the
  inventory (`vocab_size` is 76 today), fine-tuned from the released checkpoint on Mexican teacher audio in one voice;
  judged by Whisper on names and by the owner's ear. No existing port is bilingual or Mexican.
- **Spanish text for the voice:** the responder emits only speakable words (as MapSMA's `sayTimeEs` does). Reading
  news aloud in Spanish needs Spanish text normalisation and stays out of scope until then.

## 8. Music (D5)

Per venue in the pack: `music: {genres, slots: [{days, from, to, checked}]}`. Ship recurring slots ("jazz on
Thursdays from 8") with a checked date; no band names without a source that keeps them fresh. "Tonight" and "now"
use the music's hours; the answer says how old the data is when it is old. Genre words in both languages live in
`domains/places`.

## 9. Flexibility for unexpected questions

In this order, each measured before the next: (1) concept tables in data (chela → beer, guitarrista → live music);
(2) an LLM-written question set per city, used as tests and as a source of synonyms, reviewed as a diff; (3) a tiny
classifier only if measured misses remain (its fixed weights are deterministic, but not rules the owner can read).
Low confidence asks one short question back.

## 10. Privacy

The recording never leaves the phone; a CredBrief question is sent to CredBrief as text. Engine files (transformers.js,
onnxruntime, Pyodide, models) are served by the site itself, pinned by SHA-256 in one manifest that replaces the
hand-kept `?v=` strings. A browser test checks that no request carries audio.

## 11. Build plan

From the review (section 4). B0 → B3 in order; the rest in any order after B3.

| # | Step | Done means | Status |
|---|---|---|---|
| B0 | Golden tests of today's reader and asker (300+ questions, EN/ES/mixed/mis-hearings, fixed clocks) | snapshot reviewed once; passes against the originals | done: 434 questions + 5 conversations, 1,756 answers |
| B1 | Pack schema, builder, validator; San Miguel as `mx-sma` | `dist/` built; report lists hours conflicts, missing data, collisions, size | done: 16.5 KB gzipped (budget 28.8 KB), 10 warnings |
| B2 | Reader split: grammar in core, tables in `lang/` and `domains/places`, names and areas from the pack | requests identical to B0; proper-noun grep passes | done: `domains/places/read.js`; language tables move to `lang/` in B6 |
| B3 | Asker and responder split: time zone, centre, meals, walking, collections from the pack | answers identical to B0; another time zone shifts answers correctly | done: all 1,756 answers identical |
| B4 | A made-up second city and a generated 5,000-place pack | suite runs per pack with no code change; name matching under 50 ms at 5,000 places | done: Villa Ejemplo (`xx-test`) answers with no code change; 9–25 ms a question at 1,500 places, 28–80 ms at 5,000 (so large cities use zones of ≤1,500) |
| B5 | Pack loader in the browser (hash check, cache, swap, offline, `setCity`) | Playwright: loads two cities, refuses a corrupted file, works offline | done: `core/pack/loader.js`, 8 browser tests |
| B6 | Language packs and the language decision (numbers and clock both ways; names masked) | table tests; text-only language accuracy on B0's questions | done: `lang/`, `core/lang-decide.js`; 419/419 labelled questions right with names masked (415 without) |
| B7 | Spanish spelling → sounds for sentences (from `spanish.js`) | name outputs unchanged; every template sentence valid for the phoneset | done: `lang/es/sounds.js`; names identical to MapSMA's; every Spanish answer sentence (5,862 words) in valid sounds |
| B8 | Music facet | "live jazz tonight" / "¿dónde hay trova el jueves?" answered from test slots | |
| B9 | Config instead of the `SITES` table; hint builder with a token budget; `AsrEngine` result shape | the 19 parity tests still pass | |
| B10 | Plain-JS voice worker behind `VoiceEngine` | same messages as the ONNX worker; real-file test when the GGUF is present | |
| B11 | `tools/sizes.mjs`; check page shows pack load and first-sound time | size table generated | |
| B12 | News, small (search titles, read, next, stop, hand-off) | works on `feed.xml`; "latest" says the feed has no dates | |
| B13 | Self-hosting manifest; no request leaves the origin or carries audio | Playwright | |

**Waits on others:** phone measurements (the owner's iPhone, one Android); the recorded question set (speakers,
phones, real places); the bilingual voice (GPU, a Mexican teacher voice, a listening test); the ears (data, GPU, the
gate); music data and who keeps it fresh; a real second city; switching the live sites (their sources and deploys).

## 12. Questions for the owner

1. Which city next, and of what kind (a small Mexican city needs only a pack; Mexico City needs zones; another
   country needs a variety table and other sounds for the voice)?
2. One site per city, or one app with a city switch?
3. Spanish answers until the bilingual voice exists: the phone's Mexican voice (recommended) or tiny-voca with an
   American accent?
4. Who keeps a city's data fresh, and how fresh must music be?
5. Is there a GPU budget for the ears, or should the plan assume Whisper tiny stays for a year?

## Appendix: background

- **Sherpa-ONNX** (from its docs source): streaming Zipformer transducers with hotwords; English `en-20M` (41 MB int8
  encoder per the docs listing); no official Spanish streaming model; Nemotron 3.5 streaming (es-US, es-ES, automatic
  language tags) has a 627 MB encoder, a teacher only; spoken language ID through Whisper tiny is 98 MB; the keyword
  spotter is 3M parameters (4.4 MB int8), Chinese and English phrases only.
- **Spanish vs Mexican Spanish:** recognition needs Mexican test speech and San Miguel's names; the reader needs
  Mexican words (ahorita, al rato, mande, comida as the midday meal, almuerzo as a late breakfast); the voice needs
  seseo, yeísmo, x as in México, "tl", and Mexican intonation, where existing Spanish tiny-voca ports are Castilian.
- **Published accuracy** (word error rates, other test sets than this app's): Whisper tiny.en 12.8%, Moonshine tiny
  12.7%, base 10.1% (English averages, Moonshine paper); Vosk small Spanish 16.0% / 16.7% / 11.2% (Common Voice /
  TEDx / audiobooks); Whisper tiny fine-tuned for Spanish ~20% on Common Voice. MapSMA's own: right place 10/10 with
  the name hint, 8/10 without (ten questions).
