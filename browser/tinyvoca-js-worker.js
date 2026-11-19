// tiny-speech shared core (browser/tinyvoca-js-worker.js, plan step B10): the tiny-voca voice in plain JavaScript, off the page's
// main thread. One 8 MB file instead of onnxruntime + Pyodide (about 45 MB), and no second WebAssembly runtime beside speech
// recognition's (the iPhone memory lesson, 17 Nov 2026). Same messages as tinyvoca-worker.js, so a page switches by its address;
// new: speak {lang: "es"} reads Spanish sentences with Spanish sounds (an American accent until the voice learns Spanish), and
// {type: "city", english, readings, names} tells it which words inside the city's names stay English.
//
// Address: tinyvoca-js-worker.js?v=…&cache=<cache name prefix, from the site's config (core/config.js workerUrl)>
//   [&model=<address of a GGUF>&sha256=<its SHA-256>] (the bilingual voice, or any other file: checked against sha256)
//   [&engines=<the site's folder of engine files> (plan step B13: the released voice from the site itself, same path)]
// The older &site=mapsma|credbrief still picks the cache names it picked before (a page not yet moved to a config).
// Messages in: load, speak {id, text | sentences, base, voice, speed, pitch, open, lang}, more {id, sentences, last}, teach {words},
// phones {id, text, lang}, city {english, readings, names}, stop. Out: status, ready {voices, sampleRate, core, kept, fetched},
// sentence {id, index, total, audio, sampleRate}, done {id, totalTime}, taught {words}, phones {id, text}, error {id, message}.
import { createVoice, MODEL, MODEL_URL } from "../engines/tinyvoca-js.js";

const CORE = "tiny-speech 0.3.0";
const HERE = new URL(self.location.href);
const param = (k) => HERE.searchParams.get(k);
// the cache's name: the config's prefix (?cache=); else the names the two sites used before configs (?site=); else our own
const OLD = { mapsma: "mapsma-tinyvoca-js-", credbrief: "credbrief-tinyvoca-js-" };
const PREFIX = param("cache") || OLD[param("site")] || "tiny-speech-tinyvoca-js-";
const EXPECT = (param("sha256") || MODEL.sha256).toLowerCase();
const SELF_HOSTED = param("engines") && new URL(param("engines").replace(/\/?$/, "/") + MODEL_URL.replace(/^https:\/\//, ""), HERE).href;
const MODEL_AT = new URL(param("model") || SELF_HOSTED || MODEL_URL, HERE).href;
const CACHE = PREFIX + (param("sha256") ? EXPECT : MODEL.revision).slice(0, 7);
const seen = { kept: 0, fetched: 0 };

const status = (text, progress) => postMessage({ type: "status", text, progress });
const hex = (buf) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");

// The model file: from this device if kept, else downloaded with progress; checked against its SHA-256 before use either way.
async function modelBytes() {
  let store = null;
  try { store = await caches.open(CACHE); } catch { store = null; }
  const hit = store && (await store.match(MODEL_AT));
  let bytes;
  if (hit) { bytes = await hit.arrayBuffer(); seen.kept++; }
  else {
    const response = await fetch(MODEL_AT);
    if (!response.ok) throw new Error(`${MODEL_AT}: ${response.status}`);
    const total = Number(response.headers.get("content-length")) || MODEL.bytes;
    const reader = response.body.getReader(), chunks = [];
    let got = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value); got += value.length;
      status("Loading the tiny-voca voice", Math.min(1, got / total));
    }
    const all = new Uint8Array(got);
    let at = 0;
    for (const c of chunks) { all.set(c, at); at += c.length; }
    bytes = all.buffer;
    seen.fetched++;
  }
  if (hex(await crypto.subtle.digest("SHA-256", bytes)) !== EXPECT) {
    if (store) await store.delete(MODEL_AT);
    throw new Error("the voice file does not match its SHA-256");
  }
  if (!hit && store) await store.put(MODEL_AT, new Response(bytes)).catch(() => {});
  return bytes;
}

let voice = null, loading = null, lexicon = null, city = null;

// A streamed answer is spoken while it is still being written (MapSMA / CredBrief, 17 Nov 2026): "speak" with open: true starts with
// the sentences there are, "more" adds the next ones, "more" with last: true says no more will come. Only then is "done" posted.
let current = null, job = null;
function wake() { const w = job && job.wake; if (job) job.wake = null; if (w) w(); }

async function speak({ id, text, sentences, base = 0, voice: who = 1, speed = 1, pitch = 0, open = false, lang = "en" }) {
  current = id;
  const started = performance.now();
  const list = Array.isArray(sentences) ? sentences.map(String) : [String(text || "")];
  wake();
  const mine = (job = { id, list, open: Boolean(open && Array.isArray(sentences)), wake: null });
  let made = 0;
  for (let index = 0; ; index++) {
    while (index >= list.length && mine.open && current === id) await new Promise((resolve) => { mine.wake = resolve; });
    if (current !== id) return;
    if (index >= list.length) break;
    if (!/[\p{L}\p{N}]/u.test(list[index])) continue;  // nothing to say (a lone citation): no audio for this sentence
    for (const u of voice.utterances(list[index], lang)) {
      if (current !== id) return;
      const audio = voice.synthesize(u, { voice: typeof who === "number" ? voice.voices[who] : who, speed, pitch, seed: made });
      made++;
      postMessage({ type: "sentence", id, index: base + index, total: base + list.length, audio, sampleRate: voice.sampleRate }, [audio.buffer]);
      await new Promise((resolve) => setTimeout(resolve, 0));  // let "stop" and "more" in between sentences
    }
  }
  if (!made) { postMessage({ type: "error", id, message: "Nothing to say in that text.", plain: true }); return; }
  postMessage({ type: "done", id, totalTime: performance.now() - started });
}

onmessage = async ({ data }) => {
  try {
    if (data.type === "load") {
      const started = performance.now();
      loading ||= modelBytes().then(async (bytes) => {
        status("Starting the tiny-voca voice");
        voice = await createVoice(bytes, { spanish: city || {} });
        if (lexicon) postMessage({ type: "taught", words: voice.teach(lexicon) });
        lexicon = null;
      });
      await loading;
      postMessage({ type: "ready", voices: voice.voices, sampleRate: voice.sampleRate, core: CORE, ms: Math.round(performance.now() - started), ...seen });
    } else if (data.type === "speak") {
      await (loading || Promise.reject(new Error("not loaded")));
      await speak(data);
    } else if (data.type === "more") {
      if (job && job.id === data.id) { job.list.push(...(data.sentences || []).map(String)); if (data.last) job.open = false; wake(); }
    } else if (data.type === "teach") {
      if (voice) postMessage({ type: "taught", words: voice.teach(data.words || {}) });
      else lexicon = { ...(lexicon || {}), ...(data.words || {}) };  // taught once the voice is up
    } else if (data.type === "city") {
      city = { english: data.english || [], readings: data.readings || {}, names: data.names || [] };
      if (voice) voice.setCity(city);
    } else if (data.type === "phones") {
      await (loading || Promise.reject(new Error("not loaded")));
      postMessage({ type: "phones", id: data.id, text: voice.phones(data.text, data.lang || "en") });
    } else if (data.type === "stop") {
      current = null;
      wake();
    }
  } catch (error) {
    if (data.type === "load") loading = null;
    postMessage({ type: "error", id: data.id, message: String((error && error.message) || error) });
  }
};
