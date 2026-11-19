// tiny-speech shared core v0.3.0 (browser/tinyvoca-worker.js): tiny-voca text to speech for MapSMA /page5 and CredBrief /page40, run
// off the page's main thread. Until 19 Nov 2026 each site had its own copy (built and tested on /page40, then copied to /page5, which
// added "teach" for the Spanish names and "phones"). This one file replaces both: /page40 sends neither and gets what it got before.
//
// Adapted from tiny-voca's browser demo, web/public/worker.js (https://github.com/n4ze3m/tiny-voca, commit b510350, Apache-2.0).
// Changes: the model, its config and the phonemizer data come from Hugging Face at one fixed revision (d94d2a0), so a later change there
// cannot change this page; the dizione phonemizer (https://github.com/n4ze3m/dizione, commit 8cd889e, Apache-2.0) is served by
// each site (tinyvoca/dizione.zip beside this worker, or the address in ?dizione=); cache keys carry those revisions.
//
// Address: tinyvoca-worker.js?v=…&libs=<cache for engine files>&voice=<cache prefix for the voice>&dizione=/page5/tinyvoca/dizione.zip
// (a classic worker), made by core/config.js workerUrl from the site's config (apps/*.json). Each site keeps the cache names it had
// before the shared core, so its visitors' stored engine files and voice are found again and nothing is downloaded twice; without
// them (a test copy) the caches get names of their own. No site or host names here (plan step B9).
// Messages in: {type: "load"}, {type: "speak", id, text | sentences, base, voice, speed, pitch, open}, {type: "more", id, sentences, last},
// {type: "teach", words} (MapSMA's Spanish names), {type: "phones", id, text} (for testing) and {type: "stop"}. With "sentences" (the page's
// own split of an answer) each piece of audio carries index = base + its place in that list, so the page can show which sentence is read.
// Messages out: status, ready {voices, sampleRate, core, ...}, sentence (its audio, as soon as it is made), done, taught, phones, error.

const CORE = "tiny-speech 0.3.0";

const HERE = new URL(self.location.href);
const SITE = { libs: HERE.searchParams.get("libs") || "tiny-speech-libs-1", voice: HERE.searchParams.get("voice") || "tiny-speech-tinyvoca-" };

const PYODIDE = "https://cdn.jsdelivr.net/pyodide/v0.26.4/full/";
// onnxruntime-web 1.18.0, not newer: from 1.19 every build is the multi-thread one, which reserves a 4 GB shared memory block even on
// one thread. Speech recognition (transformers.js) already holds one such block, and Lars's iPhone could not reserve a second:
// "no available backend found. ERR: [wasm] RangeError: Out of memory" (17 Nov 2026). 1.18.0 with numThreads = 1 loads its
// single-thread build (ort-wasm-simd.wasm), whose memory grows as needed. The model (IR 8, opset 17) is well within what 1.18 reads.
const ORT = "https://cdn.jsdelivr.net/npm/onnxruntime-web@1.18.0/dist/";
const MODEL_REV = "d94d2a0338fd1e0eab7dd896ec0ad23d8cdf7c14";
const HF = `https://huggingface.co/n4ze3m/tiny-voca/resolve/${MODEL_REV}/`;
// Self-hosting (plan step B13): with ?engines=<folder>, Pyodide, onnxruntime and the model come from the site itself, at the same path
// under that folder as on their own hosts (https://cdn.jsdelivr.net/… → <folder>cdn.jsdelivr.net/…), pinned by SHA-256 in
// browser/manifest.json. Files are still kept under their original addresses, so a visitor's stored copies are found either way.
const ENGINES = HERE.searchParams.get("engines");
const MIRROR = ENGINES ? new URL(ENGINES, HERE).href : "";
const mirror = (url) => (MIRROR && new URL(url).origin !== HERE.origin ? MIRROR + url.replace(/^https:\/\//, "").replace(/(@\d[\w.-]*)$/, "$1/index.js") : url);  // the site's own files (dizione.zip) as they are
const original = (url) => (MIRROR && url.startsWith(MIRROR) ? "https://" + url.slice(MIRROR.length) : url);
// dizione commit 8cd889e, as each site serves it: ?dizione=/page5/tinyvoca/dizione.zip, else tinyvoca/dizione.zip beside this worker.
// The same address as before gives the same cache key, so a visitor's stored copy is found again.
const DIZIONE_ZIP = new URL(HERE.searchParams.get("dizione") || "tinyvoca/dizione.zip", HERE).href;
const DATA = ["lexicon.tsv", "align.json", "g2p.json", "g2p.npz", "homographs.json"];
const CACHE = SITE.voice + MODEL_REV.slice(0, 7) + "-8cd889e";

// The libraries (Pyodide's runtime, its standard library and numpy; onnxruntime's engine) are kept in cache storage as well, not only in
// the browser's ordinary cache, which iPhone Safari may empty between visits. A reload then starts from this device, without the
// network (Lars, 17 Nov 2026: "every time I refresh browser it reloads model"). Their URLs carry their versions: a kept copy never goes
// stale. `seen` counts files read from this device and files fetched, for the start-up report.
const LIBS = SITE.libs;
const seen = { kept: 0, fetched: 0 };
const netFetch = self.fetch.bind(self);
self.fetch = async (input, init) => {
  const url = original(String(input instanceof Request ? input.url : input));
  if (!url.startsWith(PYODIDE) && !url.startsWith(ORT)) return netFetch(input, init);
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

importScripts(mirror(PYODIDE) + "pyodide.js", mirror(ORT) + "ort.wasm.min.js");

let pyodide, phonemize, session, config;
let lexicon = null, taught = 0;  // MapSMA: {word: phones} for the Spanish names, from the page ("teach"); taught once the phonemizer is up

function teach() {
  if (!lexicon || !pyodide || !phonemize) return;
  taught = pyodide.globals.get("teach_json")(JSON.stringify(lexicon));
  lexicon = null;
  postMessage({ type: "taught", words: taught });
}

const status = (text, progress) => postMessage({ type: "status", text, progress });

// Downloaded files are kept in the browser's cache storage: a second visit starts without the network.
async function download(url, label) {
  let store = null;
  try {
    store = await caches.open(CACHE);
    const hit = await store.match(url);
    if (hit) { seen.kept += 1; return new Uint8Array(await hit.arrayBuffer()); }
  } catch (error) { store = null; }
  const bytes = await fetchBytes(mirror(url), label);
  seen.fetched += 1;
  if (store) store.put(url, new Response(bytes)).catch(() => {});
  return bytes;
}

async function fetchBytes(url, label) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`${url}: ${response.status}`);
  const total = Number(response.headers.get("content-length")) || 0;
  if (!response.body || !total) return new Uint8Array(await response.arrayBuffer());
  const reader = response.body.getReader();
  const chunks = [];
  let received = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    received += value.length;
    status(label, received / total);
  }
  const bytes = new Uint8Array(received);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
  return bytes;
}

async function loadPhonemizer() {
  status("Loading the tiny-voca phonemizer");
  pyodide = await loadPyodide({ indexURL: mirror(PYODIDE) });
  await pyodide.loadPackage("numpy");
  const [source, ...files] = await Promise.all([
    download(DIZIONE_ZIP, "Loading the tiny-voca phonemizer"),
    ...DATA.map((name) => download(HF + "phonemizer/" + name, "Loading the tiny-voca dictionary")),
  ]);
  status("Starting the tiny-voca phonemizer");
  pyodide.FS.mkdirTree("/dizione-data");
  DATA.forEach((name, index) => pyodide.FS.writeFile("/dizione-data/" + name, files[index]));
  pyodide.unpackArchive(source.buffer, "zip", { extractDir: "/dizione-src" });
  pyodide.runPython(`
import json, os, sys
os.environ["DIZIONE_DATA"] = "/dizione-data"
sys.path.insert(0, "/dizione-src")
import dizione

# MapSMA /page5 (17 Nov 2026): Spanish names said the Spanish way. The page sends {word: phones} (spanish.js); each is added to the
# phonemizer's override list, which wins over its English dictionary and its guesses. A word it refuses is skipped.
def teach_json(words_json):
    taught = 0
    phonemizer = dizione.get()
    for word, phones in json.loads(words_json).items():
        try:
            phonemizer.add_overrides({word: phones})
            taught += 1
        except Exception:
            pass
    return taught

def phonemize_json(text):
    try:
        result = dizione.phonemize(text)
    except ValueError:
        if any(word for mark, words in dizione.pieces(text) if not mark for word in words):
            raise
        return "null"
    return json.dumps({"ids": list(result.ids), "stress": list(result.stress), "text": str(result)})

phonemize_json("Warm up.")
`);
  phonemize = pyodide.globals.get("phonemize_json");
  teach();
}

async function loadModel() {
  config = await (await fetch(mirror(HF + "config.json"))).json();
  const bytes = await download(HF + "onnx/model.onnx", "Loading the tiny-voca voice");
  status("Starting the tiny-voca voice");
  ort.env.wasm.wasmPaths = mirror(ORT);
  ort.env.wasm.numThreads = 1;
  session = await ort.InferenceSession.create(bytes, { executionProviders: ["wasm"] });
}

const ABBREVIATIONS = /(?:\b(?:mr|mrs|ms|dr|prof|sr|jr|st|vs|etc|no|inc|ltd|co|e\.g|i\.e|a\.m|p\.m)|\b[A-Z])\.$/i;

function sentences(text) {
  const parts = [];
  let current = "";
  for (const piece of text.replace(/\s+/g, " ").trim().split(/(?<=[.!?…]["')\]]?)\s+(?=["'(\[]?[A-Z0-9])/)) {
    current = current ? current + " " + piece : piece;
    if (!ABBREVIATIONS.test(current)) { parts.push(current); current = ""; }
  }
  if (current) parts.push(current);
  return parts.filter((part) => /[\p{L}\p{N}]/u.test(part));
}

function finished(text) {
  const body = text.replace(/\s+$/, "");
  if (!body) return text;
  const last = body.split(/\s+/).pop();
  const marked = /[\p{L}\p{N}]/u.test(last) ? /[.!?…,;:]["'”’)\]»]*$/.test(last) : /[.!?…]/.test(last) || /^[,;:]$/.test(last);
  return marked ? text : body + ".";
}

function fit(sentence) {
  const result = JSON.parse(phonemize(sentence));
  if (!result) return [];
  if (result.ids.length <= config.model.max_tokens - 12) return [result];
  const pieces = sentence.split(/(?<=[,;:—])\s+/);
  if (pieces.length > 1) return pieces.flatMap(fit);
  const words = sentence.split(" ");
  if (words.length < 2) return [];
  const half = Math.ceil(words.length / 2);
  return [...fit(words.slice(0, half).join(" ")), ...fit(words.slice(half).join(" "))];
}

// pitch: the model's pitch_shift input. Measured 16 Nov 2026 for the male voice M2: 0 = about 189 Hz, -0.1 = 170, -0.2 = 155, -0.3 = 140,
// -0.5 = 115; -2 and below fall to the model's 50 Hz floor. Length is unchanged.
async function synthesize(phones, voice, speed, pitch = 0) {
  const count = phones.ids.length;
  const integers = (values) => new ort.Tensor("int64", BigInt64Array.from(values.map(BigInt)), [1, count]);
  const scalar = (value) => new ort.Tensor("float32", Float32Array.from([value]), [1]);
  const output = await session.run({
    tokens: integers(phones.ids), stress: integers(phones.stress),
    voice: new ort.Tensor("int64", BigInt64Array.from([BigInt(voice)]), [1]),
    speed: scalar(speed), pitch_shift: scalar(Math.max(-0.6, Math.min(0.3, Number(pitch) || 0))), pitch_range: scalar(1),
  });
  return output.audio.data;
}

// Clean sound (Lars, 17 Nov 2026: "some statics or cracks in playback which is not in the original voice"). His recording showed two
// causes. (1) The sentence was scaled to peak at 0.99 of full scale. The phone then resamples 24 kHz to its own rate, and the curve
// between two samples can rise above both: 336 samples hit the ceiling in seven seconds of speech and were cut flat, which is heard
// as crackle. So the peak now leaves 3 dB of room (0.7). (2) Each sentence is its own clip, and a clip that does not start and end at
// zero clicks when it starts and stops: the level is centred on zero and the first and last EDGE_MS fade in and out.
const PEAK = 0.7;
const EDGE_MS = 8;
function limitPeak(samples, rate = 24000) {
  const n = samples.length;
  if (!n) return;
  let sum = 0;
  for (let i = 0; i < n; i++) sum += samples[i];
  const offset = sum / n;
  let loudest = 0;
  for (let i = 0; i < n; i++) { samples[i] -= offset; loudest = Math.max(loudest, Math.abs(samples[i])); }
  if (loudest > PEAK) for (let i = 0; i < n; i++) samples[i] *= PEAK / loudest;
  const edge = Math.min(Math.floor(n / 2), Math.round(rate * EDGE_MS / 1000));
  for (let i = 0; i < edge; i++) {
    const g = 0.5 - 0.5 * Math.cos(Math.PI * i / edge);  // a raised cosine: no corner at either end of the fade
    samples[i] *= g;
    samples[n - 1 - i] *= g;
  }
}

let current = null;  // the id being spoken; a new "speak" or a "stop" ends the old one between sentences
// A streamed answer (17 Nov 2026) is spoken while it is still being written: "speak" with open: true starts with the sentences there
// are, "more" adds the next ones, and "more" with last: true says no more will come. Only then is "done" posted.
let job = null;  // {id, list, open, wake}

function wake() {
  const w = job && job.wake;
  if (job) job.wake = null;
  if (w) w();
}

async function speak({ id, text, sentences: given, base = 0, voice, speed, pitch = 0, open = false }) {
  current = id;
  const started = performance.now();
  const list = Array.isArray(given) ? given.map((s) => String(s)) : sentences(finished(text));
  wake();  // an earlier answer still waiting for sentences ends now: it sees it is no longer current
  const mine = (job = { id, list, open: Boolean(open && Array.isArray(given)), wake: null });
  let made = 0;
  for (let index = 0; ; index++) {
    while (index >= list.length && mine.open && current === id) await new Promise((resolve) => { mine.wake = resolve; });
    if (current !== id) return;
    if (index >= list.length) break;
    if (!/[\p{L}\p{N}]/u.test(list[index])) continue;  // nothing to say (a lone citation): no audio for this sentence
    for (const phones of fit(finished(list[index]))) {
      if (current !== id) return;
      const audio = await synthesize(phones, voice, speed, pitch);
      const heard = audio.slice();
      limitPeak(heard, config.sample_rate);
      made += 1;
      postMessage({ type: "sentence", id, index: base + index, total: base + list.length, audio: heard, sampleRate: config.sample_rate }, [heard.buffer]);
    }
  }
  if (!made) { postMessage({ type: "error", id, message: "tiny-voca only reads English for now.", plain: true }); return; }
  postMessage({ type: "done", id, totalTime: performance.now() - started });
}

let loading = null;
onmessage = async ({ data }) => {
  try {
    if (data.type === "load") {
      // Each part names itself in an error, with the error's kind (RangeError, ...), so a failure on a phone we cannot test on says
      // where it happened (Lars's iPhone, 17 Nov 2026).
      const tagged = (where) => (error) => { throw new Error(`${where}: ${(error && error.name) || "Error"}: ${(error && error.message) || error}`); };
      const started = performance.now(), ms = {};
      const timed = (part, promise) => promise.then((value) => { ms[part] = Math.round(performance.now() - started); return value; });
      loading = loading || Promise.all([timed("phonemizer", loadPhonemizer()).catch(tagged("phonemizer")), timed("model", loadModel()).catch(tagged("voice model"))]);
      await loading;
      postMessage({ type: "ready", voices: config.voices, sampleRate: config.sample_rate, core: CORE, ms: Math.round(performance.now() - started), parts: ms, ...seen });
    } else if (data.type === "speak") {
      await (loading || Promise.reject(new Error("not loaded")));
      await speak(data);
    } else if (data.type === "more") {
      if (job && job.id === data.id) {
        job.list.push(...(data.sentences || []).map((s) => String(s)));
        if (data.last) job.open = false;
        wake();
      }
    } else if (data.type === "teach") {  // MapSMA: the Spanish names (see teach_json)
      lexicon = data.words || null;
      teach();
    } else if (data.type === "phones") {  // for testing: how a text will be said, as phones
      await (loading || Promise.reject(new Error("not loaded")));
      postMessage({ type: "phones", id: data.id, text: (JSON.parse(phonemize(data.text)) || {}).text || "" });
    } else if (data.type === "stop") {
      current = null;
      wake();
    }
  } catch (error) {
    loading = data.type === "load" ? null : loading;
    postMessage({ type: "error", id: data.id, message: String((error && error.message) || error) });
  }
};
