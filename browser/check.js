// tiny-speech check page: tries the shared core's files on a phone or a computer before a site switches to them.
// It uses the files exactly as a page does: listen.js and pcm-worklet.js for the microphone, asr-worker.js for speech to text,
// tinyvoca-worker.js for the voice. Put next to them (e.g. mapsma.com/tiny-speech/browser/check.html) it uses that site's config
// (apps/index.json by host name; plan step B9), so what it loads is what the site's page finds later. ?app= (or ?site=) picks a
// config by name; ?dizione= overrides where the phonemizer comes from.
import { CORE, detector, speechAt16k, to16k } from "./listen.js?v=0.3.0";
import { appConfig, appForHost, workerUrl, limitsOf } from "../core/config.js";
import { createPackLoader } from "../core/pack/loader.js";

const V = "0.3.0";
const params = new URLSearchParams(location.search);
async function siteConfig() {
  const name = params.get("app") || params.get("site");
  try {
    const index = await (await fetch("../apps/index.json", { cache: "no-cache" })).json();
    const entry = name ? index.apps.find((a) => a.app === name) : appForHost(index, location.hostname);
    if (entry) return appConfig(await (await fetch(`../apps/${entry.config}`, { cache: "no-cache" })).json());
  } catch { /* no app list here: test cache names */ }
  return appConfig({});
}
// ?engines=/folder/: try the site's own copies of the engine files (plan step B13) before the site's config says so.
const CONFIG = params.has("engines") ? appConfig({ ...(await siteConfig()), engines: params.get("engines") }) : await siteConfig();
const SITE = CONFIG.app;
const LIMITS = limitsOf(CONFIG);
const DIZIONE = params.get("dizione") ?? CONFIG.voice.dizione;
const ASR_URL = workerUrl(CONFIG, "asr", { v: V });
// ?voice=js: tiny-voca in plain JavaScript (one 8 MB file; Spanish sentences in Spanish sounds); else the ONNX + Pyodide worker the sites use.
const VOICE_JS = params.get("voice") === "js";
const VOICE_URL = VOICE_JS ? workerUrl(CONFIG, "voiceJs", { v: V, model: params.get("model") }) : workerUrl(CONFIG, "voice", { v: V, dizione: DIZIONE });

const $ = (id) => document.getElementById(id);
const t0 = performance.now();
function log(...parts) {
  const line = `${((performance.now() - t0) / 1000).toFixed(2)}s  ${parts.map((p) => (typeof p === "string" ? p : JSON.stringify(p))).join(" ")}`;
  const el = $("log");
  el.textContent = (el.textContent ? el.textContent + "\n" : "") + line;
  el.scrollTop = el.scrollHeight;
}
const show = (id, html) => { $(id).innerHTML = html; };
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);

$("about").textContent = `${CORE} · site: ${SITE || "(none: test cache names)"} · voice: ${VOICE_JS ? "tiny-voca in plain JS" : "tiny-voca ONNX + Pyodide, dizione: " + (DIZIONE || "next to the worker")}` +
  (CONFIG.engines ? ` · engine files from this site: ${CONFIG.engines}` : "");
log("check page", { core: CORE, site: SITE, asr: ASR_URL, voice: VOICE_URL });

// ---------- speech to text: asr-worker.js ----------
let asrWorker = null, asrReq = 0;
const asrWaiting = new Map();
let asrLoaded = null;  // model id once "ready"
function asr() {
  if (asrWorker) return asrWorker;
  asrWorker = new Worker(ASR_URL, { type: "module" });
  asrWorker.onmessage = ({ data }) => {
    if (data.type === "progress") { show("heard", `Loading ${esc(data.id)}: ${Math.round(data.frac * 100)}%`); return; }
    if (data.type === "text") {
      const w = asrWaiting.get(data.reqId);
      asrWaiting.delete(data.reqId);
      log("asr text", data);
      if (w) data.error ? w.reject(new Error(data.error)) : w.resolve(data);
      return;
    }
    log("asr", data);
    if (data.type === "ready") { asrLoaded = data.id; show("heard", `<span class="ok">Ready: ${esc(data.id)}</span> (${esc(data.core || "?")}${data.ms != null ? `, ${data.ms} ms` : ""}${data.kept != null ? `, engine files kept ${data.kept} / fetched ${data.fetched}` : ""})`); }
    if (data.type === "error") show("heard", `<span class="bad">Could not load ${esc(data.id)}: ${esc(data.message)}</span>`);
  };
  asrWorker.onerror = (e) => { log("asr worker error", e.message || "(no message)"); show("heard", `<span class="bad">The speech worker failed to start: ${esc(e.message || "")}</span>`); };
  return asrWorker;
}
function chosenModel() {
  const [model, language] = $("model").value.split("|");
  return { model, language: language || undefined };
}
function loadAsr() {
  const { model } = chosenModel();
  show("heard", `Loading ${esc(model)}…`);
  asr().postMessage({ type: "load", model });
}
function transcribeAudio(audio) {
  const { model, language } = chosenModel();
  const hint = $("useHint").checked && /whisper/i.test(model) ? $("hint").value.trim() : undefined;
  const reqId = ++asrReq;
  return new Promise((resolve, reject) => {
    asrWaiting.set(reqId, { resolve, reject });
    asr().postMessage({ type: "transcribe", reqId, model, language, hint, audio }, [audio.buffer]);
  });
}
// What Whisper hears that is not speech comes as tags ([BLANK_AUDIO], (wind blowing)), as on both sites.
const spoken = (text) => String(text || "").replace(/\[[^\]]*\]|\([^)]*\)/g, " ").replace(/\s+/g, " ").trim();

// ---------- the microphone: as MapSMA and CredBrief record (raw sound, no echo cancellation, ended by a pause) ----------
let micStream = null, rec = null;
async function getMic() {
  if (micStream && micStream.getAudioTracks().some((t) => t.readyState === "live")) return micStream;
  micStream = await navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1, echoCancellation: false, noiseSuppression: false, autoGainControl: false } });
  return micStream;
}
async function startRec() {
  const AC = window.AudioContext || window.webkitAudioContext;
  const ctx = new AC();  // made in the tap: iPhone and iPad start sound only inside a tap
  if (ctx.state === "suspended") ctx.resume().catch(() => {});
  let stream;
  try { stream = await getMic(); } catch (err) { ctx.close().catch(() => {}); show("heard", `<span class="bad">No microphone: ${esc(err.name || "")} ${esc(err.message || err)}</span>`); log("mic error", String(err)); return; }
  stream.getAudioTracks().forEach((t) => { t.enabled = true; });
  const r = { ctx, d: detector(ctx.sampleRate, LIMITS), began: 0, tick: 0, src: null, node: null, mute: null, via: "" };
  try {
    if (ctx.state === "suspended") await ctx.resume();
    r.src = ctx.createMediaStreamSource(stream);
    if (ctx.audioWorklet && window.AudioWorkletNode) {
      try { await ctx.audioWorklet.addModule(`pcm-worklet.js?v=${V}`); r.node = new AudioWorkletNode(ctx, "pcm-tap"); r.node.port.onmessage = (e) => hear(r, e.data); r.via = "AudioWorklet"; } catch { r.node = null; }
    }
    if (!r.node) { r.node = ctx.createScriptProcessor(2048, 1, 1); r.node.onaudioprocess = (e) => hear(r, new Float32Array(e.inputBuffer.getChannelData(0))); r.via = "ScriptProcessor"; }
    r.mute = ctx.createGain(); r.mute.gain.value = 0;  // the graph runs only when it reaches the speakers: so it does, silently
    r.src.connect(r.node); r.node.connect(r.mute); r.mute.connect(ctx.destination);
  } catch (err) {
    endRecording(r); show("heard", `<span class="bad">Recording could not start: ${esc(err.message || err)}</span>`); return;
  }
  r.began = performance.now();
  rec = r;
  $("mic").classList.add("rec");
  $("mic").textContent = "■ Stop";
  log("recording", { rate: ctx.sampleRate, via: r.via });
  r.tick = setInterval(() => {
    if (rec !== r) return;
    const used = performance.now() - r.began;
    if (used > 1500 && r.d.n === 0) { rec = null; endRecording(r); show("heard", '<span class="bad">The microphone gave no sound.</span>'); return; }
    if (used >= Number($("maxRec").value)) { stopRec("time"); return; }
    show("heard", r.d.speechAt < 0 ? "Listening… say something." : "Listening… it ends when you stop talking.");
  }, 100);
}
function hear(r, buf) {
  if (rec !== r) return;
  const event = r.d.feed(buf);
  $("level").style.width = `${Math.round(Math.min(1, Math.sqrt((r.d.rms || 0) / 0.12)) * 100)}%`;
  if (event === "speech") log("speech started");
  if (event === "end") stopRec("pause");
}
function endRecording(r) {
  clearInterval(r.tick);
  try { r.src?.disconnect(); r.node?.disconnect(); r.mute?.disconnect(); } catch { /* already gone */ }
  if (r.node?.port) r.node.port.onmessage = null; else if (r.node) r.node.onaudioprocess = null;
  r.ctx.close().catch(() => {});
  micStream?.getAudioTracks().forEach((t) => { t.enabled = false; });
  $("mic").classList.remove("rec");
  $("mic").textContent = "🎙 Record";
  $("level").style.width = "0";
}
async function stopRec(why) {
  const r = rec;
  if (!r) return;
  rec = null;
  endRecording(r);
  const audio = speechAt16k(r.d);
  const seconds = audio.length / 16000;
  log("recording ended", { why, seconds: Number(seconds.toFixed(2)), speechFound: r.d.speechAt >= 0 });
  if (audio.length < 16000 * 0.4) { show("heard", "That was too short. Try again."); return; }
  show("heard", `Turning ${seconds.toFixed(1)} s of speech into text…`);
  try {
    const out = await transcribeAudio(audio);
    const text = spoken(out.text);
    show("heard", `${text ? `<b>${esc(text)}</b>` : '<span class="bad">Nothing heard.</span>'}\n<span class="small">${seconds.toFixed(1)} s of speech · waited ${out.waitMs} ms for the model · ${out.runMs} ms to turn it into text · ended by ${why}</span>`);
  } catch (err) {
    show("heard", `<span class="bad">${esc(err.message || err)}</span>`);
  }
}

// ---------- playing sound: one <audio> player for every sentence, unlocked by the first tap (Safari) ----------
let playerEl = null, unlocked = false, queue = [], playing = false;
function wavBlob(samples, rate) {
  const n = samples.length, buf = new ArrayBuffer(44 + n * 2), v = new DataView(buf);
  const str = (o, t) => { for (let i = 0; i < t.length; i++) v.setUint8(o + i, t.charCodeAt(i)); };
  str(0, "RIFF"); v.setUint32(4, 36 + n * 2, true); str(8, "WAVE"); str(12, "fmt "); v.setUint32(16, 16, true); v.setUint16(20, 1, true);
  v.setUint16(22, 1, true); v.setUint32(24, rate, true); v.setUint32(28, rate * 2, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true);
  str(36, "data"); v.setUint32(40, n * 2, true);
  for (let i = 0; i < n; i++) { const x = Math.max(-1, Math.min(1, samples[i])); v.setInt16(44 + i * 2, x < 0 ? x * 0x8000 : x * 0x7fff, true); }
  return new Blob([buf], { type: "audio/wav" });
}
function player() { if (!playerEl) { playerEl = new Audio(); playerEl.setAttribute("playsinline", ""); playerEl.preload = "auto"; } return playerEl; }
function unlockAudio() {
  if (unlocked || playing) return;
  const el = player(), url = URL.createObjectURL(wavBlob(new Float32Array(2400), 24000));
  el.src = url; el.play().catch(() => {}).finally(() => setTimeout(() => URL.revokeObjectURL(url), 2000));
  unlocked = true;
}
document.addEventListener("pointerdown", unlockAudio, { capture: true });
document.addEventListener("keydown", unlockAudio, { capture: true });
function enqueue(samples, rate) {
  queue.push(URL.createObjectURL(wavBlob(samples, rate)));
  if (!playing) playNext();
}
function playNext() {
  const url = queue.shift();
  if (!url) { playing = false; return; }
  playing = true;
  const el = player();
  el.onended = el.onerror = () => { URL.revokeObjectURL(url); playNext(); };
  el.src = url;
  el.play().catch((err) => { log("play failed", String(err)); URL.revokeObjectURL(url); playNext(); });
}
function stopSound() {
  queue.forEach((u) => URL.revokeObjectURL(u));
  queue = [];
  if (playerEl) playerEl.pause();
  playing = false;
}

// ---------- the voice: tinyvoca-worker.js ----------
let voiceWorker = null, voiceReady = null, speakId = 0;
const speaking = new Map();  // id -> {chunks, resolve, reject, play}
function voice() {
  if (voiceWorker) return voiceWorker;
  voiceWorker = new Worker(VOICE_URL, VOICE_JS ? { type: "module" } : undefined);
  voiceWorker.onmessage = ({ data }) => {
    if (data.type === "status") { show("spoken", `${esc(data.text)}${data.progress != null ? ` ${Math.round(data.progress * 100)}%` : ""}`); return; }
    if (data.type === "sentence") {
      const job = speaking.get(data.id);
      if (!job) return;
      job.chunks.push({ audio: data.audio, rate: data.sampleRate });
      if (job.play) enqueue(data.audio, data.sampleRate);
      return;
    }
    log("voice", data.type === "ready" ? data : { ...data, audio: undefined });
    if (data.type === "ready") {
      voiceReady = data;
      show("spoken", `<span class="ok">Voice ready</span> (${esc(data.core || "?")}, ${data.ms} ms; files kept ${data.kept} / fetched ${data.fetched})`);
    } else if (data.type === "taught") {
      show("spoken", `Taught ${data.words} name${data.words === 1 ? "" : "s"}.`);
    } else if (data.type === "phones") {
      show("spoken", `Phones: <b>${esc(data.text)}</b>`);
    } else if (data.type === "done") {
      const job = speaking.get(data.id);
      speaking.delete(data.id);
      job?.resolve(job.chunks);
    } else if (data.type === "error") {
      const job = speaking.get(data.id);
      speaking.delete(data.id);
      if (job) job.reject(new Error(data.message)); else show("spoken", `<span class="bad">${esc(data.message)}</span>`);
    }
  };
  voiceWorker.onerror = (e) => { log("voice worker error", e.message || "(no message)"); show("spoken", `<span class="bad">The voice worker failed to start: ${esc(e.message || "")}</span>`); };
  return voiceWorker;
}
function loadVoice() { show("spoken", "Loading the voice…"); voice().postMessage({ type: "load" }); }
function teach() {
  let words;
  try { words = JSON.parse($("teach").value || "{}"); } catch (err) { show("spoken", `<span class="bad">Not JSON: ${esc(err.message)}</span>`); return; }
  voice().postMessage({ type: "teach", words });
  show("spoken", `Teaching ${Object.keys(words).length} names (taught once the voice has loaded)…`);
}
// First sound (plan step B11): from asking the voice to the first sentence's audio, the wait a reader hears before an answer.
let lastFirstSoundMs = null;
function speak(text, { play = true } = {}) {
  const id = ++speakId, asked = performance.now();
  return new Promise((resolve, reject) => {
    const chunks = [];
    chunks.push = function (...items) {
      if (!this.length && items.length) { lastFirstSoundMs = Math.round(performance.now() - asked); timing(`Voice: first sound after ${lastFirstSoundMs} ms.`); }
      return Array.prototype.push.apply(this, items);
    };
    speaking.set(id, { chunks, resolve, reject, play });
    voice().postMessage({ type: "speak", id, text, voice: Number($("voice").value), speed: 1.0, pitch: Number($("pitch").value), lang: $("sayLang").value });
  });
}

// ---------- the city pack, timings and memory (plan step B11) ----------
const timings = [];
function timing(line) {
  timings.push(line);
  $("timings").textContent = [...timings, memoryLine()].join("\n");
  log("timing", line);
}
// Chromium reports its JavaScript heap (performance.memory); other browsers report nothing here, and the page says so.
function memoryLine() {
  const m = performance.memory;
  return m ? `Memory: ${Math.round(m.usedJSHeapSize / 1e6)} MB used of the page's JavaScript heap (the workers' memory is not included).`
    : "Memory: not reported by this browser.";
}
async function loadPack() {
  const packs = params.get("packs") || (CONFIG.packs ? CONFIG.packs.replace(/[^/]*$/, "") : "../packs/");
  const loader = createPackLoader({ base: packs, cachePrefix: CONFIG.caches.packs });
  const started = performance.now();
  try {
    const city = params.get("city") || CONFIG.city || (await loader.list()).index.cities[0].id;
    const r = await loader.load(city);
    const ms = Math.round(performance.now() - started);
    timing(`City pack ${city} ${r.version}: ${r.pack.places.length} places, from ${r.from === "device" ? "this device" : "the network"}${r.offline ? " (offline)" : ""}, in ${ms} ms.`);
    return { city, version: r.version, from: r.from, places: r.pack.places.length, ms };
  } catch (err) {
    timing(`City pack: could not load (${err.message || err}).`);
    return { error: String(err.message || err) };
  }
}
const join = (chunks) => {
  const out = new Float32Array(chunks.reduce((n, c) => n + c.audio.length, 0));
  let at = 0;
  for (const c of chunks) { out.set(c.audio, at); at += c.audio.length; }
  return out;
};

// ---------- round trip: the voice speaks, speech to text listens ----------
// Number words count as their digits ("ten" = "10" = "diez"), as Whisper writes numbers either way.
const NUMBERS = Object.fromEntries([
  ..."zero one two three four five six seven eight nine ten eleven twelve".split(" ").map((w, i) => [w, String(i)]),
  ..."cero uno dos tres cuatro cinco seis siete ocho nueve diez once doce".split(" ").map((w, i) => [w, String(i)]),
  ["una", "1"], ["un", "1"],
]);
const words = (s) => (String(s).toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").match(/[a-z0-9ñ]+/g) || []).map((w) => NUMBERS[w] || w);
function overlap(said, heard) {
  const want = words(said), got = new Set(words(heard));
  const hit = want.filter((w) => got.has(w)).length;
  return want.length ? hit / want.length : 0;
}
async function roundTrip() {
  const text = $("say").value.trim();
  if (!text) return null;
  show("trip", "Speaking…");
  const started = performance.now();
  try {
    if (!voiceReady) loadVoice();
    const chunks = await speak(text);
    const spokeMs = Math.round(performance.now() - started);
    const audio = join(chunks);
    const rate = chunks[0]?.rate || 24000;
    show("trip", `Spoke ${(audio.length / rate).toFixed(1)} s in ${spokeMs} ms. Listening…`);
    const out = await transcribeAudio(to16k(audio, rate));
    const heard = spoken(out.text), score = overlap(text, heard);
    const result = { said: text, heard, score, spokeMs, firstSoundMs: lastFirstSoundMs, waitMs: out.waitMs, runMs: out.runMs, seconds: audio.length / rate };
    show("trip", `Said: ${esc(text)}\nHeard: <b>${esc(heard || "(nothing)")}</b>\n<span class="${score >= 0.8 ? "ok" : "bad"}">${Math.round(score * 100)}% of the words heard</span> <span class="small">· voice ${spokeMs} ms · speech to text ${out.runMs} ms (+${out.waitMs} ms waiting for the model)</span>`);
    log("round trip", result);
    return result;
  } catch (err) {
    show("trip", `<span class="bad">${esc(err.message || err)}</span>`);
    log("round trip failed", String(err.message || err));
    return { error: String(err.message || err) };
  }
}

async function listCaches() {
  if (!("caches" in self)) { log("no Cache Storage here (not a secure page?)"); return; }
  for (const name of (await caches.keys()).sort()) log("cache", name, (await (await caches.open(name)).keys()).length, "files");
}

$("loadAsr").onclick = loadAsr;
$("mic").onclick = () => (rec ? stopRec("tap") : startRec());
$("loadVoice").onclick = loadVoice;
$("teachBtn").onclick = teach;
$("speak").onclick = () => { if (!voiceReady) loadVoice(); stopSound(); speak($("say").value).then(() => log("spoken"), (err) => show("spoken", `<span class="bad">${esc(err.message)}</span>`)); };
$("stop").onclick = () => { voice().postMessage({ type: "stop" }); stopSound(); };
$("phones").onclick = () => voice().postMessage({ type: "phones", id: 0, text: $("say").value, lang: $("sayLang").value });
$("roundTrip").onclick = roundTrip;
$("clearLog").onclick = () => { $("log").textContent = ""; };
$("cacheList").onclick = listCaches;
$("loadPack").onclick = loadPack;
$("memoryBtn").onclick = () => timing("(now)");
$("model").onchange = () => { if (asrLoaded) loadAsr(); };

// The longest question: the site's own limit (config), unless chosen above.
if ([...$("maxRec").options].some((o) => Number(o.value) === LIMITS.REC_MAX_MS)) $("maxRec").value = String(LIMITS.REC_MAX_MS);

// For automated checks (and the console): the same steps the buttons take.
window.tinySpeechCheck = { CORE, SITE, CONFIG, ASR_URL, VOICE_URL, DIZIONE, loadAsr, loadVoice, teach, speak, transcribeAudio, roundTrip, listCaches, loadPack, memoryLine };
