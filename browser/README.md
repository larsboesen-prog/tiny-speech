# tiny-speech shared core v0.1.0 — the browser files

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

Each worker keeps its site's cache names (`?site=mapsma` or `?site=credbrief`, else the host name), and the
voice worker takes the address of the site's `dizione.zip` (`?dizione=`), so a visitor's stored engine
files and voice are found again: switching downloads nothing twice. `npm test` in `tiny-speech/` proves
this against the sites' original files (`test/fixtures/before/`).

## MapSMA: try it, then switch /page5

1. **Copy** this folder's six files to the site as `/tiny-speech/` (nothing else changes yet).
2. **Try** `https://mapsma.com/tiny-speech/check.html` on the iPhone that already used /page5:
   - *Load* under Voice: the line should end "fetched 0": nothing downloaded again. ("kept" counts the
     files found on the phone: the voice model, the dictionary files, dizione.zip, and however many
     engine files Pyodide and onnxruntime use.)
   - *Load* under Speech to text, *Record*, ask a question: the words appear and the line ends with
     "ended by pause".
   - *Run round trip*: the voice says the sentence and Whisper writes it back.
   - *List this site's caches*: `mapsma-voice-libs-1` and `mapsma-tinyvoca-d94d2a0-8cd889e`, the same
     names /page5 uses.
3. **Switch** /page5: four lines in its page script, and a new `V`:

   | Line (18 Nov copy) | Before | After |
   |---|---|---|
   | 41 | `import { detector, speechAt16k } from './listen.js?v=20261118d';` | `import { detector, speechAt16k } from '/tiny-speech/listen.js?v=0.1.0';` |
   | 401 | `new Worker('asr-worker.js?v=20261118d', { type: 'module' })` | `new Worker('/tiny-speech/asr-worker.js?v=0.1.0&site=mapsma', { type: 'module' })` |
   | 538 | `ctx.audioWorklet.addModule('pcm-worklet.js?v=20261118d')` | `ctx.audioWorklet.addModule('/tiny-speech/pcm-worklet.js?v=0.1.0')` |
   | 723 | `new Worker('tinyvoca-worker.js?v=20261118d')` | `new Worker('/tiny-speech/tinyvoca-worker.js?v=0.1.0&site=mapsma&dizione=/page5/tinyvoca/dizione.zip')` |

   `dizione.zip` stays where it is (`/page5/tinyvoca/`). `ask.js`, `read.js`, `spanish.js` are not part of v0.
4. **Check** /page5 on the iPhone: a question in English and one in Spanish, a Spanish name read aloud
   ("La Azotea"), the Timing numbers as before.
5. **Going back** is the four lines again: /page5's own copies stay in place until the shared files have
   run for a while; then they can go.

## CredBrief /page40 (later, the same way)

| Line (18 Nov copy) | After |
|---|---|
| 8 | `import { REC_MAX_MS, detector, speechAt16k } from '/tiny-speech/listen.js?v=0.1.0';` |
| 265 | `new Worker('/tiny-speech/asr-worker.js?v=0.1.0&site=credbrief', { type: 'module' })` |
| 391 | `await ctx.audioWorklet.addModule('/tiny-speech/pcm-worklet.js?v=0.1.0');` |
| 924 | `new Worker('/tiny-speech/tinyvoca-worker.js?v=0.1.0&site=credbrief&dizione=/page40/tinyvoca/dizione.zip')` |

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

## Releasing a new version

Change `0.1.0` in the files' headers, `CORE` in the three scripts, `package.json`, and every `?v=` the
pages use, together; `npm test` checks the version the files report.
