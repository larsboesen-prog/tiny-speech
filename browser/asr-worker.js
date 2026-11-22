// tiny-speech shared core v0.3.0 (browser/asr-worker.js): speech to text for MapSMA /page5 and CredBrief /page40. Until 19 Nov 2026
// each site had its own copy (built and tested on /page40, then copied to /page5, which added the name hint and the language). This
// one file replaces both: /page40 sends neither a hint nor a language and gets what it got before; /page5 sends both.
//
// Speech to text off the page's main thread: loading and running Whisper or Moonshine here keeps the page, the mouse and the stop
// button responsive while the reader speaks (Lars, 16 Nov 2026: "the mouse cursor stalls ... blocks my ability to end question" when
// this ran on the main thread).
//
// Address: asr-worker.js?v=…&libs=<cache name for engine files> (a module worker), made by core/config.js workerUrl from the
// site's config (apps/*.json): each site keeps the cache name it had before the shared core, so a visitor's stored engine files
// are found again. Without ?libs= (a test copy) the cache gets a name of its own. No site or host names here (plan step B9).
// Messages in: {type: "load", model} and {type: "transcribe", reqId, model, audio (16 kHz Float32Array), language ("es": multilingual
// Whisper only), hint (names, as text) or hintNames (names in order of need) with hintBudget (tokens)}.
// Messages out: progress {id, frac}, ready {id, core}, warm {id, ms}, error {id, message}, text {reqId, text | error, waitMs, runMs,
// spot? (the ears with ?names=)}.
//
// The tiny ears (plan step B16, 20 Nov 2026): model "tiny-ears" is the 8.9 MB sound recognizer and the city's word list
// (engines/asr-ears.js) instead of Whisper, through the same messages; Whisper tiny stays a choice (any other model id). Its files:
// ?ears=<the model file> (default ../engines/ears/ears-int8.onnx; its vocab.json beside it) and ?lexicon=<the city's word list>
// (packs/<city>/ears-lexicon.json), made by core/config.js workerUrl from the site's asr.ears. It needs no hint and no language
// (one model, both languages); its text comes back in lower case, words only. onnxruntime-web 1.18 (one thread, the same engine
// file the voice worker keeps) is loaded only when the ears are asked for, and transformers.js only when Whisper is.
// Names by sound (22 Nov 2026): with ?names=<the city's ears-names.json>, the text message also carries `spot`, the five place names
// that fit the sounds best ([{id, name, perSound}], engines/ears-spot.js), for the page to use when the words missed the name, and
// `heardId`. Learning from the visitor's picks: {type: "learn", heardId, id} (they chose place id for that question) → {type:
// "learned", id, phones} (how the name sounded, for the page to keep on the device); {type: "readings", readings: [{id, phones}]} gives
// them back next visit (→ {type: "readings", used}); {type: "forget"} drops them.

const CORE = "tiny-speech 0.3.0";
const TRANSFORMERS = "https://cdn.jsdelivr.net/npm/@huggingface/transformers@3.8.1";

const HERE = new URL(self.location.href);
const SITE = { libs: HERE.searchParams.get("libs") || "tiny-speech-libs-1" };

// Self-hosting (plan step B13): with ?engines=<folder>, every engine file comes from the site itself, at the same path under that
// folder as on its own host (https://cdn.jsdelivr.net/npm/… → <folder>cdn.jsdelivr.net/npm/…, models under <folder>huggingface.co/),
// pinned by SHA-256 in browser/manifest.json: no third party sees the visitor. Without it, the files come from their hosts as before.
const ENGINES = HERE.searchParams.get("engines");
const EARS = {
  model: new URL(HERE.searchParams.get("ears") || "../engines/ears/ears-int8.onnx", HERE).href,
  lexicon: HERE.searchParams.get("lexicon") ? new URL(HERE.searchParams.get("lexicon"), HERE).href : "",
  names: HERE.searchParams.get("names") ? new URL(HERE.searchParams.get("names"), HERE).href : "",
};
EARS.vocab = new URL("vocab.json", EARS.model).href;
const ORT = "https://cdn.jsdelivr.net/npm/onnxruntime-web@1.18.0/dist/";  // 1.18 as the voice worker: from 1.19 every build reserves 4 GB
// A package's own address (…/transformers@3.8.1) is also a folder there (…@3.8.1/dist/…): on the site its file is …@3.8.1/index.js.
const mirror = (url) => (ENGINES ? new URL(ENGINES + url.replace(/^https:\/\//, "").replace(/(@\d[\w.-]*)$/, "$1/index.js"), HERE).href : url);

// The library, loaded once, when Whisper is first asked for (from its host, or the site's copy); the settings below are made before
// anything uses it.
let libsLoading = null;
const libs = () => libsLoading || (libsLoading = import(mirror(TRANSFORMERS)).then(({ env, pipeline }) => {
  // One core: a 3-second question takes about 0.3 s on one thread (measured 16 Nov), and the rest of the machine stays free.
  env.backends.onnx.wasm.numThreads = 1;
  if (ENGINES) {
    env.remoteHost = mirror("https://huggingface.co/");
    const wasm = env.backends.onnx.wasm.wasmPaths;
    if (typeof wasm === "string") env.backends.onnx.wasm.wasmPaths = mirror(wasm);
  }
  return { env, pipeline };
}));

// The tiny ears' runtime and engine, loaded once, when the ears are first asked for.
let earsLoading = null;
const earsLibs = () => earsLoading || (earsLoading = Promise.all([
  import(mirror(ORT) + "esm/ort.wasm.min.js").then((m) => {
    const ort = m.InferenceSession ? m : m.default;
    ort.env.wasm.numThreads = 1;
    ort.env.wasm.wasmPaths = mirror(ORT);
    return ort;
  }),
  // with the worker's own version (and whether it finds names by sound), so a browser that kept an older engine file fetches this one
  import(new URL(`../engines/asr-ears.js?v=${encodeURIComponent(HERE.searchParams.get("v") || "")}${EARS.names ? "&names=1" : ""}`, import.meta.url).href),
]).then(([ort, engine]) => ({ ort, engine })));

// transformers.js keeps the model files in cache storage itself, but fetches onnxruntime's engine (a .wasm of 10-20 MB) through the
// browser's ordinary cache, which iPhone Safari may empty. That file is kept in cache storage here (17 Nov 2026); its URL carries its
// version. `seen` counts engine files read from this device and fetched, for the start-up report.
const LIBS = SITE.libs;
const seen = { kept: 0, fetched: 0 };
const netFetch = self.fetch.bind(self);
self.fetch = async (input, init) => {
  const url = String(input instanceof Request ? input.url : input);
  const engine = /^https:\/\/cdn\.jsdelivr\.net\/npm\/[^?#]+\.wasm$/.test(url) || (ENGINES && url.startsWith(mirror("https://cdn.jsdelivr.net/npm/")) && /\.wasm$/.test(url));
  if (!engine) return netFetch(input, init);
  let store = null;
  try {
    store = await caches.open(LIBS);
    const hit = await store.match(url);
    if (hit) { seen.kept += 1; return hit; }
  } catch (error) { store = null; }
  const response = await netFetch(input, init);
  seen.fetched += 1;
  if (store && response.ok) store.put(url, response.clone()).catch(() => {});
  return response;
};

const isEars = (id) => String(id || "").startsWith("tiny-ears");

// The model file, kept in cache storage like the engine files (its address carries its version: a new model is a new file name).
async function keptBytes(url, id) {
  let store = null;
  try {
    store = await caches.open(LIBS);
    const hit = await store.match(url);
    if (hit) { seen.kept += 1; return new Uint8Array(await hit.arrayBuffer()); }
  } catch (error) { store = null; }
  const response = await netFetch(url);
  if (!response.ok) throw new Error(`${url}: ${response.status}`);
  const total = Number(response.headers.get("content-length")) || 0, parts = [];
  let got = 0;
  for (const reader = response.body.getReader(); ;) {
    const { done, value } = await reader.read();
    if (done) break;
    parts.push(value); got += value.length;
    if (total) postMessage({ type: "progress", id, frac: got / total });
  }
  const bytes = new Uint8Array(got);
  let at = 0;
  for (const part of parts) { bytes.set(part, at); at += part.length; }
  seen.fetched += 1;
  if (store) store.put(url, new Response(bytes, { headers: { "content-type": "application/octet-stream" } })).catch(() => {});
  return bytes;
}

async function loadEars() {
  if (!EARS.lexicon) throw new Error("the tiny ears need the city's word list: ?lexicon= in the worker's address (asr.ears.lexicon in the site's config)");
  const json = (url) => netFetch(url).then((r) => { if (!r.ok) throw new Error(`${url}: ${r.status}`); return r.json(); });
  const [{ ort, engine }, model, vocab, lexicon, names] = await Promise.all([earsLibs(), keptBytes(EARS.model, "tiny-ears"), json(EARS.vocab), json(EARS.lexicon),
    EARS.names ? json(EARS.names).catch(() => null) : null]);  // no names file: words only, as before
  return engine.createEars({ ort, model, vocab, lexicon, names });
}

// One call for both kinds of model: Whisper's pipeline, or the ears' hear().
const runModel = (model, id, audio) => (model.hear ? model.hear(audio) : model(audio, genOpts(id, audio.length)));

let asr = null;
let asrId = "";
let pendingReadings = [];  // names learned before, sent before the ears had loaded
let loading = null;  // {id, promise} while a model loads
let running = Promise.resolve();  // the transcription in progress, so a model is not let go in the middle of one

// One run at a time: the warm-up and the reader's question never run side by side on the one engine.
function serial(fn) {
  const job = running.then(fn, fn);
  running = job.catch(() => {});
  return job;
}

// How much a model may write. A question gets five seconds of speech at most (about 20 words): Whisper's 64 tokens are two to three
// times that, and only stop a rare runaway repeat that would take seconds. transformers.js lets Moonshine write only 6 tokens per whole
// second of audio (rounded down), which cut "the talks in Istanbul" to "the talks in Ist" in a 3.6-second question (16 Nov): 8 a
// second, rounded up, plus 4.
function genOpts(id, samples) {
  return /moonshine/i.test(id) ? { max_new_tokens: Math.ceil((samples / 16000) * 8) + 4 } : { max_new_tokens: 64 };
}

// A model's first run sets up its engine and is slower than every later one (measured 17 Nov 2026, see index.html): one run on a
// second of silence, right after loading, so the reader's first question does not pay for it.
function warm(model, id) {
  const t = performance.now();
  serial(() => runModel(model, id, new Float32Array(16000)))
    .then(() => postMessage({ type: "warm", id, ms: Math.round(performance.now() - t) }), () => {});
}

// One model at a time: after a switch in Settings the previous one is let go once it has finished, instead of keeping all three
// (about 135 MB) in this worker's memory.
function letGo(old) {
  if (!old || old === asr) return;
  running.finally(() => { if (old !== asr) old.dispose().catch(() => {}); });
}

function load(id) {
  if (asr && asrId === id) return Promise.resolve(asr);
  if (loading && loading.id === id) return loading.promise;
  const files = {}, started = performance.now();
  const promise = (isEars(id) ? loadEars() : libs().then(({ pipeline }) => pipeline("automatic-speech-recognition", id, {
    device: "wasm",
    dtype: "q8",  // the small quantized files (about 40 MB for Whisper tiny.en, 30 MB for Moonshine Tiny, 63 MB for Moonshine Base)
    progress_callback: (p) => {
      if (p.status === "progress" && p.total) {
        files[p.file] = [p.loaded, p.total];
        const v = Object.values(files);
        postMessage({ type: "progress", id, frac: v.reduce((a, x) => a + x[0], 0) / v.reduce((a, x) => a + x[1], 0) });
      }
    },
  }))).then((model) => {
    const old = asr;
    asr = model;
    asrId = id;
    loading = null;
    letGo(old);
    if (model.addReadings && pendingReadings.length) { let used = 0; try { used = model.addReadings(pendingReadings); } catch { /* none */ } postMessage({ type: "readings", used }); pendingReadings = []; }
    postMessage({ type: "ready", id, core: CORE, ms: Math.round(performance.now() - started), ...seen });
    warm(model, id);
    return model;
  }).catch((error) => {
    loading = null;
    postMessage({ type: "error", id, message: String((error && error.message) || error) });
    throw error;
  });
  loading = { id, promise };
  return promise;
}

// Place names, sent by MapSMA (17 Nov 2026; Lars: "It has problems with my Spanish names"): the page sends the place names with each question, and
// Whisper reads them first, as if it had just heard them ("<|startofprev|> names <|startoftranscript|> <|notimestamps|>": Whisper's
// prompt; transformers.js 3.8 takes it as decoder_input_ids, its prompt_ids option is not wired up). On ten spoken test questions
// the right place was found 10 times with the names, 8 without (La Azotea, Bocaciega, Tostévere, Café Umarán and Estoril were heard
// better), for about 0.4 s more a question. The names come back at the start of the text and are cut off here. Whisper only:
// Moonshine has no prompt.
const HINT_TOKENS = 220;  // Whisper takes at most 223 prompt tokens; the page keeps its list under this (214 on 17 Nov), so nothing is cut
let hint = null;  // {id, text, language, init (token ids), prefix (the names as Whisper writes them back)}
// MapSMA's Spanish page (17 Nov 2026) uses the multilingual Whisper tiny: it is told the language ("<|es|> <|transcribe|>" after
// "<|startoftranscript|>"), with or without the names; the English-only tiny.en takes no language.
const multilingual = (id) => /whisper/i.test(id) && !/\.en$/.test(id);
function langTokens(model, id, language) {
  if (!language || !multilingual(id)) return [];
  const tid = (t) => model.tokenizer.model.tokens_to_ids.get(t), lang = tid(`<|${language}|>`), task = tid("<|transcribe|>");
  return lang != null && task != null ? [lang, task] : [];
}
function hintFor(model, id, text, language) {
  if (!text || !/whisper/i.test(id)) return null;
  if (hint && hint.id === id && hint.text === text && hint.language === language) return hint;
  const tok = model.tokenizer, tid = (t) => tok.model.tokens_to_ids.get(t);
  const sop = tid("<|startofprev|>"), sot = tid("<|startoftranscript|>"), nts = tid("<|notimestamps|>");
  if (sop == null || sot == null) return null;
  let ids = tok.encode(" " + String(text).trim(), { add_special_tokens: false });
  if (ids.length > HINT_TOKENS) ids = ids.slice(-HINT_TOKENS);
  hint = { id, text, language, init: [sop, ...ids, sot, ...langTokens(model, id, language), ...(nts != null ? [nts] : [])], prefix: tok.decode(ids, { skip_special_tokens: true }).trim() };
  return hint;
}
// Names in order of need (core/pack/hint.js hintNames: the hardest to hear first) packed into the budget with this model's own
// tokenizer, so the count is exact: a name that does not fit is left out, and a shorter one after it may still go in. The same
// rule as fitHint in core/pack/hint.js, which the build report uses with the same tokenizer.
let fitted = null;  // {key, text}
function fitNames(model, id, names, budget) {
  if (!Array.isArray(names) || !names.length || !/whisper/i.test(id)) return "";
  const limit = Math.min(HINT_TOKENS, Number.isFinite(budget) ? budget : HINT_TOKENS);
  const key = `${id}|${limit}|${names.join("\u0001")}`;
  if (fitted && fitted.key === key) return fitted.text;
  const count = (list) => model.tokenizer.encode(" " + list.join(", ") + ".", { add_special_tokens: false }).length;
  const used = [];
  for (const name of names) if (count([...used, name]) <= limit) used.push(name);
  fitted = { key, text: used.length ? used.join(", ") + "." : "" };
  return fitted.text;
}
function withoutHint(text, h) {
  const t = String(text || "").trim();
  if (!h) return t;
  if (t.startsWith(h.prefix)) return t.slice(h.prefix.length).trim();
  const tail = h.prefix.slice(-24), k = t.lastIndexOf(tail);  // written back a little differently: cut after its last words
  return k >= 0 ? t.slice(k + tail.length).trim() : t;
}

// The name hint can pull Whisper tiny off course: on 144 Mexican Spanish requests (synthetic voices, 19 Nov 2026) it got 41% of
// the words wrong without the hint and 53% with it, looping ("de de de de…") or writing the names back as a comma list. An
// answer like that is heard again, once, without the hint (training/asr/README.md).
const WORD = "[\\p{L}\\p{N}']+", EDGE = "(?<![\\p{L}\\p{N}'])", END = "(?![\\p{L}\\p{N}'])";
const LOOP_1 = new RegExp(`${EDGE}(${WORD})${END}(?:[\\s,.]+\\1${END}){3,}`, "iu");                 // a word four times in a row
const LOOP_2 = new RegExp(`${EDGE}(${WORD}\\s+${WORD})${END}(?:[\\s,.]+\\1${END}){2,}`, "iu");  // two words three times
export function hintWentWrong(text, hintText) {
  const t = String(text || "").trim();
  if (!t) return true;  // only the hint came back
  if (LOOP_1.test(t) || LOOP_2.test(t)) return true;
  const names = String(hintText || "").replace(/\.$/, "").split(/,\s*/).filter((n) => n.length > 3);
  const copied = names.filter((n) => t.toLowerCase().includes(n.toLowerCase())).length;
  const words = t.split(/\s+/).length, commas = (t.match(/,/g) || []).length;
  return copied >= 4 || (words >= 4 && commas >= words * 0.6);  // the hint's names, or its comma list, written back
}

onmessage = async ({ data }) => {
  if (data.type === "learn") {  // the visitor picked a place for a question: the ears remember how its name sounded
    let phones = null;
    try { phones = asr && asr.learnFrom ? asr.learnFrom(data.heardId, data.id) : null; } catch { phones = null; }  // never the worker's end
    postMessage({ type: "learned", id: data.id, heardId: data.heardId, phones });
  } else if (data.type === "readings") {  // names learned on an earlier visit (kept by the page)
    if (asr && asr.addReadings) { let used = 0; try { used = asr.addReadings(data.readings); } catch { /* none */ } postMessage({ type: "readings", used }); }
    else pendingReadings = [...pendingReadings, ...(data.readings || [])];
  } else if (data.type === "forget") {
    pendingReadings = [];
    try { if (asr && asr.forget) asr.forget(); } catch { /* none */ }
  } else if (data.type === "load") {
    if (asr && asrId === data.model) postMessage({ type: "ready", id: data.model, core: CORE });  // already loaded: say so again
    else load(data.model).catch(() => {});
  } else if (data.type === "transcribe") {
    try {
      const asked = performance.now();
      const model = await load(data.model);
      let began = 0;  // for the page's timing window: waiting for the model (and its warm-up) vs turning speech into text
      if (model.hear) {  // the tiny ears: no hint, no language, nothing to retry
        const out = await serial(() => { began = performance.now(); return model.hear(data.audio); });
        postMessage({ type: "text", reqId: data.reqId, text: out.text, engine: "tiny-ears", waitMs: Math.round(began - asked), runMs: Math.round(performance.now() - began), matchMs: out.matchMs,
          ...(out.spot ? { spot: out.spot, spotMs: out.spotMs, heardId: out.heardId } : {}) });
        return;
      }
      let h = null;
      try {
        const text = data.hint || fitNames(model, data.model, data.hintNames, data.hintBudget);
        h = hintFor(model, data.model, text, data.language);
      } catch (error) { h = null; }  // a hint that cannot be built: plain Whisper
      const plain = data.language && multilingual(data.model) ? { language: data.language, task: "transcribe" } : {};
      const opts = { ...genOpts(data.model, data.audio.length), ...(h ? { decoder_input_ids: h.init } : plain) };
      const out = await serial(() => { began = performance.now(); return model(data.audio, opts); });
      let text = withoutHint(out.text, h), retried = null;
      if (h && hintWentWrong(text, h.prefix)) {  // the hint led it astray: the same audio once more, without it
        const again = await serial(() => model(data.audio, { ...genOpts(data.model, data.audio.length), ...plain }));
        text = String(again.text || "").trim();
        retried = "hint";
      }
      postMessage({ type: "text", reqId: data.reqId, text, ...(retried ? { retried } : {}), waitMs: Math.round(began - asked), runMs: Math.round(performance.now() - began) });
    } catch (error) {
      postMessage({ type: "text", reqId: data.reqId, error: String((error && error.message) || error) });
    }
  }
};
