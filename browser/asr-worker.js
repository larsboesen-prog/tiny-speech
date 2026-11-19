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
// Messages out: progress {id, frac}, ready {id, core}, warm {id, ms}, error {id, message}, text {reqId, text | error, waitMs, runMs}.

import { env, pipeline } from "https://cdn.jsdelivr.net/npm/@huggingface/transformers@3.8.1";

const CORE = "tiny-speech 0.3.0";

const HERE = new URL(self.location.href);
const SITE = { libs: HERE.searchParams.get("libs") || "tiny-speech-libs-1" };

// One core: a 3-second question takes about 0.3 s on one thread (measured 16 Nov), and the rest of the machine stays free.
env.backends.onnx.wasm.numThreads = 1;

// transformers.js keeps the model files in cache storage itself, but fetches onnxruntime's engine (a .wasm of 10-20 MB) through the
// browser's ordinary cache, which iPhone Safari may empty. That file is kept in cache storage here (17 Nov 2026); its URL carries its
// version. `seen` counts engine files read from this device and fetched, for the start-up report.
const LIBS = SITE.libs;
const seen = { kept: 0, fetched: 0 };
const netFetch = self.fetch.bind(self);
self.fetch = async (input, init) => {
  const url = String(input instanceof Request ? input.url : input);
  if (!/^https:\/\/cdn\.jsdelivr\.net\/npm\/[^?#]+\.wasm$/.test(url)) return netFetch(input, init);
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

let asr = null;
let asrId = "";
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
  serial(() => model(new Float32Array(16000), genOpts(id, 16000)))
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
  const promise = pipeline("automatic-speech-recognition", id, {
    device: "wasm",
    dtype: "q8",  // the small quantized files (about 40 MB for Whisper tiny.en, 30 MB for Moonshine Tiny, 63 MB for Moonshine Base)
    progress_callback: (p) => {
      if (p.status === "progress" && p.total) {
        files[p.file] = [p.loaded, p.total];
        const v = Object.values(files);
        postMessage({ type: "progress", id, frac: v.reduce((a, x) => a + x[0], 0) / v.reduce((a, x) => a + x[1], 0) });
      }
    },
  }).then((model) => {
    const old = asr;
    asr = model;
    asrId = id;
    loading = null;
    letGo(old);
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

onmessage = async ({ data }) => {
  if (data.type === "load") {
    if (asr && asrId === data.model) postMessage({ type: "ready", id: data.model, core: CORE });  // already loaded: say so again
    else load(data.model).catch(() => {});
  } else if (data.type === "transcribe") {
    try {
      const asked = performance.now();
      const model = await load(data.model);
      let began = 0;  // for the page's timing window: waiting for the model (and its warm-up) vs turning speech into text
      let h = null;
      try {
        const text = data.hint || fitNames(model, data.model, data.hintNames, data.hintBudget);
        h = hintFor(model, data.model, text, data.language);
      } catch (error) { h = null; }  // a hint that cannot be built: plain Whisper
      const lang = !h && data.language && multilingual(data.model) ? { language: data.language, task: "transcribe" } : {};
      const opts = { ...genOpts(data.model, data.audio.length), ...(h ? { decoder_input_ids: h.init } : lang) };
      const out = await serial(() => { began = performance.now(); return model(data.audio, opts); });
      postMessage({ type: "text", reqId: data.reqId, text: withoutHint(out.text, h), waitMs: Math.round(began - asked), runMs: Math.round(performance.now() - began) });
    } catch (error) {
      postMessage({ type: "text", reqId: data.reqId, error: String((error && error.message) || error) });
    }
  }
};
