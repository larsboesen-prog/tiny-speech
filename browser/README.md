# tiny-speech shared core v0.3.0 — the browser files

One copy of the voice files that MapSMA /page5 and CredBrief /page40 kept as separate copies until
19 Nov 2026. Built from MapSMA's copies, which are /page40's plus the name hint, the Spanish language
and the Spanish-name lessons; /page40 never sends those and gets what it got before.

| File | What it does | Used by |
|---|---|---|
| `listen.js` | When a spoken question has ended, and which part is speech (0.7 s pause) | both pages |
| `pcm-worklet.js` | The microphone's raw sound in 2048-sample blocks | both pages |
| `asr-worker.js` | Speech to text (Whisper / Moonshine through transformers.js), module worker | both pages |
| `tinyvoca-worker.js` | tiny-voca voice (onnxruntime-web 1.18 + Pyodide dizione), classic worker | both pages |
| `check.html`, `check.js` | A page to try all four on a phone before a site switches | testing only |

Each worker keeps its site's cache names, and the voice worker takes the address of the site's `dizione.zip`,
so a visitor's stored engine files and voice are found again: switching downloads nothing twice. Since 0.3.0
(plan step B9) the names come from the site's config (`apps/mapsma.json`, `apps/credbrief.json`) in the
worker's address (`?libs=`, `?voice=`, `?dizione=`), built by `core/config.js` `workerUrl`; the workers hold
no table of sites and read no host name. `npm test` in `tiny-speech/` proves this against the sites' original
files (`test/fixtures/before/`).

## MapSMA: try it, then switch /page5

1. **Copy** these folders to the site under `/tiny-speech/`, keeping their layout (the workers import from the folders beside
   theirs): `browser/`, `engines/`, `lang/`, `core/`, `domains/`, `vendor/` (with `tiny-voca-js.gguf` from `npm run fetch:voice`, or
   leave it out and the voice loads it from Hugging Face), and `packs/dist/` as `/tiny-speech/packs/`. Nothing on /page5 changes yet.
2. **Try** `https://mapsma.com/tiny-speech/browser/check.html` on the iPhone that already used /page5:
   - *Load* under Voice: the line should end "fetched 0": nothing downloaded again. ("kept" counts the files found on the phone.)
   - *Load* under Speech to text, *Record*, ask a question: the words appear and the line ends with "ended by pause".
   - *Run round trip*: the voice says the sentence and Whisper writes it back.
   - *List this site's caches*: `mapsma-voice-libs-1` and `mapsma-tinyvoca-d94d2a0-8cd889e`, the same names /page5 uses.
   - The plain-JS voice: `check.html?voice=js`. Note its "Voice ready … ms" and how long the first sentence takes: that decides
     whether /page5 moves to it (B10's gate: first-sound time and memory on the phone).
3. **Switch** /page5: four lines in its page script, and a new `V`:

   | Line (18 Nov copy) | Before | After |
   |---|---|---|
   | 41 | `import { detector, speechAt16k } from './listen.js?v=20261118d';` | `import { detector, speechAt16k } from '/tiny-speech/browser/listen.js?v=0.3.0';` |
   | 401 | `new Worker('asr-worker.js?v=20261118d', { type: 'module' })` | `new Worker('/tiny-speech/browser/asr-worker.js?v=0.3.0&libs=mapsma-voice-libs-1', { type: 'module' })` |
   | 538 | `ctx.audioWorklet.addModule('pcm-worklet.js?v=20261118d')` | `ctx.audioWorklet.addModule('/tiny-speech/browser/pcm-worklet.js?v=0.3.0')` |
   | 723 | `new Worker('tinyvoca-worker.js?v=20261118d')` | `new Worker('/tiny-speech/browser/tinyvoca-worker.js?v=0.3.0&libs=mapsma-voice-libs-1&voice=mapsma-tinyvoca-&dizione=/page5/tinyvoca/dizione.zip')` |

   The worker addresses are what `workerUrl(config, "asr" | "voice")` (`core/config.js`) makes from `apps/mapsma.json`; a page
   that imports the core can build them instead of writing them out.

   `dizione.zip` stays where it is (`/page5/tinyvoca/`). `ask.js`, `read.js`, `spanish.js` stay MapSMA's until the places domain
   (`domains/places/`, identical answers proven by the golden tests) replaces them in a later switch.
4. **Check** /page5 on the iPhone: a question in English and one in Spanish, a Spanish name read aloud
   ("La Azotea"), the Timing numbers as before.
5. **Going back** is the four lines again: /page5's own copies stay in place until the shared files have
   run for a while; then they can go.

## The tiny ears on MapSMA (plan step B16, 20 Nov 2026), Whisper tiny kept as the other choice

The same worker (`asr-worker.js`) and the same messages: the model id **`tiny-ears`** is the 8.9 MB sound recognizer and San
Miguel's word list instead of Whisper (`engines/asr-ears.js`, `engines/ears-match.js`); any Whisper id works as before. One model
for both languages, no name hint (the names are in the word list), about 0.15 s for the model and 0.1–0.2 s for the word list per
question here (Whisper tiny: about 2 s). Its text comes back in lower case, words only ("hay música en vivo en raindog cantina").

| | Tiny ears | Whisper tiny |
|---|---|---|
| Spanish restaurant requests, synthetic Mexican voices, held out: understood as said | 80.6% | 29–31% |
| … read by two voices it never heard (Argentina, Spain) | 85.4% | 52.1% |
| English, tiny-voca's voice (4 questions): words right | 80–100% | 100% |
| First visit, MapSMA with the plain-JS voice | 28.6 MB (17.0 MB brotli) | 74.6 MB English only, 118.2 MB both |

1. **The model.** `ears-int8.onnx` from the training run's output (`python training/ears/kaggle/push.py output larsbo99/tiny-ears-train DIR`),
   copied to the site as `/tiny-speech/engines/ears/ears-int8-2026-11-22.onnx` (since 22 Nov: the English retrain; before, `-2026-11-20`) (`apps/mapsma.json` `asr.ears.model`; a new model is a new
   file name, so phones never keep an old one). In git since 21 Nov 2026 under CC BY-SA 4.0 (it learned partly from CC BY-SA speech:
   `models/ears.md`), with `engines/ears/vocab.json` (its 392 sounds).
2. **The word list**: `packs/dist/mx-sma/ears-lexicon.json` (545 KB, 95 KB brotli since 22 Nov 2026: the reader's words too), copied with the packs to `/tiny-speech/packs/`.
   Rebuilt with `node tools/ears-lexicon.mjs mx-sma` when the places change (a new city: the same command, no training).
3. **The page.** The worker's address from `workerUrl(config, "asr")` (now with `&ears=…&lexicon=…`), and the model of each question from
   `asrModel(config, lang, engine)` (`core/config.js`): `"tiny-ears"` for MapSMA, whatever the language, unless the reader chose Whisper in
   Settings (`engine = "whisper"`: whisper-tiny.en / whisper-tiny as today). If the worker answers `{type: "error", id: "tiny-ears"}` (the
   model file is missing), the page asks Whisper instead. The `language` and `hint` the page sends are ignored by the ears.
4. **Names by sound** (22 Nov 2026): with `&names=/tiny-speech/packs/<city>/ears-names.json` in the worker's address (5.6 KB: each place's
   name and other spoken forms, written by `tools/ears-lexicon.mjs`), every `text` message also carries `spot`: the five names that fit
   the sounds best, `[{id, name, perSound}]` (`engines/ears-spot.js`, about 20 ms). The page decides with `soundChoice(text, request, spot)`
   from the same file: answer about one name, offer two or three as buttons, or keep the words' answer (/page5 since update 5).
5. **Try it first**: `check.html` on the iPhone: MapSMA's config preselects "Tiny ears"; *Load*, *Record*, ask; the line under the words
   gives the model's and the word list's milliseconds. `check.html?engine=whisper` starts on Whisper. On the computer:
   `check.html?app=mapsma&ears=/engines/ears/<file>&lexicon=/packs/mx-sma/ears-lexicon.json` with the test server.

onnxruntime-web 1.18 (one thread) loads only when the ears are asked for, transformers.js only when Whisper is: a page on the ears
never downloads Whisper. The engine file `ort-wasm-simd.wasm` is the one the ONNX voice worker already keeps in the site's cache.
`test/ears.test.mjs` runs the worker in Chromium on four recorded questions and gets exactly what `training/asr/probe/probe.py` heard.

## CredBrief /page40 (later, the same way)

| Line (18 Nov copy) | After |
|---|---|
| 8 | `import { REC_MAX_MS, detector, speechAt16k } from '/tiny-speech/browser/listen.js?v=0.3.0';` |
| 265 | `new Worker('/tiny-speech/browser/asr-worker.js?v=0.3.0&libs=credbrief-page40-libs-1', { type: 'module' })` |
| 391 | `await ctx.audioWorklet.addModule('/tiny-speech/browser/pcm-worklet.js?v=0.3.0');` |
| 924 | `new Worker('/tiny-speech/browser/tinyvoca-worker.js?v=0.3.0&libs=credbrief-page40-libs-1&voice=credbrief-tinyvoca-&dizione=/page40/tinyvoca/dizione.zip')` |

Workers must come from the page's own site (browsers do not start a worker from another site), so each
site serves its own copy of these files; the copies are the same files, from this folder, at one version.

## Measured with the real models (19 Nov 2026)

`npm run test:live -- path/to/dizione.zip`: the check page in headless Chromium in a cloud container (one
thread), with the real transformers.js, Whisper, Pyodide, onnxruntime-web and tiny-voca from the network,
first visit (nothing stored): speech to text ready in 3.3 s, the voice in 6.5 s (12 files fetched).

| Round trip: tiny-voca (M2) says it, Whisper writes it | Heard | Voice | Speech to text |
|---|---|---|---|
| tiny.en: "La Azotea is open until ten tonight. Bocaciega closes at eleven." | "La Azotea is open until 10 tonight, Bocaciega closes at 11" | 374 ms for 4.3 s of speech | 2.1 s |
| tiny.en: "Find three restaurants in Centro that are open now." | word for word | 194 ms for 2.9 s | 1.9 s |
| tiny, Spanish: "¿Qué restaurantes están abiertos esta noche en el centro?" | "¿Qué restaurantes estas en el centro?" | 209 ms for 3.1 s | 1.9 s |

The Spanish line is the English voice reading Spanish (only names are taught Spanish sounds today):
the gap the bilingual tiny-voca voice is for. Speech to text here is slower than on the phones the
pages measured (0.3–1.5 s for a 3-second question): the container's CPU, not the files.

## The plain-JS voice (B10, 19 Nov 2026)

`tinyvoca-js-worker.js` is tiny-voca in plain JavaScript (`engines/tinyvoca-js.js`, upstream `js/` vendored in `vendor/tiny-voca/`):
one 8 MB file (`npm run fetch:voice`), no onnxruntime, no Pyodide, the model's SHA-256 checked before use. Same messages as
`tinyvoca-worker.js`, so a page switches by its address; new: `speak {lang: "es"}` reads Spanish sentences with Spanish sounds, and
`{type: "city", english, readings, names}` says which words inside the city's names stay English. Try it on the check page with
`check.html?voice=js`.

Live round trip on 19 Nov (headless Chromium in a cloud container, one thread; Whisper tiny.en for English, Whisper tiny told
Spanish for Spanish):

| | ONNX + Pyodide voice (sites today) | plain-JS voice |
|---|---|---|
| English, 2 sentences | 100%, 100% of words heard | 100%, 100% |
| Spanish, 3 sentences | 56%, 14%, 18% (Spanish through the English phonemizer) | 11%, 43%, 55% (Spanish sounds) |
| Speed | 12–16 × real time | 3–4 × real time |

Spanish is not usable from either until the voice is trained on Spanish (plan step 5): keep the phone's Mexican voice for Spanish
answers until then (review 1.4). The plain-JS voice is slower here than the ONNX one but faster than real time; its speed and
memory on the owner's iPhone and a cheap Android decide whether the sites switch to it.

## Releasing a new version

Change the version in the files' headers, `CORE` in the three scripts and `package.json` together; `npm test` checks the
version the files report. The `?v=` of each address is its file's content hash (plan step B13): `node tools/manifest.mjs
--addresses mapsma` prints a site's addresses, and `node tools/manifest.mjs` writes `browser/manifest.json` (every core file
and every engine file with its size and SHA-256) to deploy with them.

## Serving the engine files from the site itself (B13)

Today the workers fetch transformers.js, Whisper, onnxruntime, Pyodide and tiny-voca from jsDelivr and Hugging Face, so those
hosts see each visitor. `browser/engines.json` lists all 33 files (180.9 MB, recorded with the real libraries, each with its
SHA-256). `node tools/manifest.mjs --fetch DIR` downloads them and checks every hash; copy `DIR` to the site as
`/tiny-speech/engines/` and set `"engines": "/tiny-speech/engines/"` in the site's config (try it first with
`check.html?engines=/tiny-speech/engines/`). Files stay stored on a visitor's phone under their original addresses, so switching
downloads nothing again. Whisper's files are taken from the models' `main` revision: when Hugging Face changes one, `--fetch`
stops with a SHA-256 mismatch rather than serve a different model.

## Sizes

`node tools/sizes.mjs` writes `docs/sizes.md` from the files themselves (B11): each part raw, gzip and brotli, and what a page's
first visit costs. The check page's section 4 shows, on a phone, how long the city pack and the voice's first sound take, and
the memory the browser reports.
