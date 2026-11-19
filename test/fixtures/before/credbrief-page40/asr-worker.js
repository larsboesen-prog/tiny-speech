// Speech to text for page40 (Ask CredBrief), off the page's main thread: loading and running Whisper or Moonshine here keeps the page,
// the mouse and the stop button responsive while the reader speaks (Lars, 16 Nov 2026: "the mouse cursor stalls ... blocks my ability
// to end question" when this ran on the main thread).
//
// Messages in: {type: "load", model} and {type: "transcribe", reqId, model, audio (16 kHz Float32Array)}.
// Messages out: progress {id, frac}, ready {id}, warm {id, ms}, error {id, message}, text {reqId, text | error, waitMs, runMs}.

import { env, pipeline } from "https://cdn.jsdelivr.net/npm/@huggingface/transformers@3.8.1";

// One core: a 3-second question takes about 0.3 s on one thread (measured 16 Nov), and the rest of the machine stays free.
env.backends.onnx.wasm.numThreads = 1;

// transformers.js keeps the model files in cache storage itself, but fetches onnxruntime's engine (a .wasm of 10-20 MB) through the
// browser's ordinary cache, which iPhone Safari may empty. That file is kept in cache storage here (17 Nov 2026); its URL carries its
// version. `seen` counts engine files read from this device and fetched, for the start-up report.
const LIBS = "credbrief-page40-libs-1";
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
    postMessage({ type: "ready", id, ms: Math.round(performance.now() - started), ...seen });
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

onmessage = async ({ data }) => {
  if (data.type === "load") {
    if (asr && asrId === data.model) postMessage({ type: "ready", id: data.model });  // already loaded: say so again
    else load(data.model).catch(() => {});
  } else if (data.type === "transcribe") {
    try {
      const asked = performance.now();
      const model = await load(data.model);
      let began = 0;  // for the page's timing window: waiting for the model (and its warm-up) vs turning speech into text
      const out = await serial(() => { began = performance.now(); return model(data.audio, genOpts(data.model, data.audio.length)); });
      postMessage({ type: "text", reqId: data.reqId, text: String(out.text || "").trim(), waitMs: Math.round(began - asked), runMs: Math.round(performance.now() - began) });
    } catch (error) {
      postMessage({ type: "text", reqId: data.reqId, error: String((error && error.message) || error) });
    }
  }
};
