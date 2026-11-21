// tiny-speech demo (GitHub Pages): the whole loop on the visitor's device, with the files of this repository.
//   microphone (browser/listen.js, pcm-worklet.js: raw sound, ended by a pause)
//   → tiny ears (browser/asr-worker.js, model "tiny-ears": 8.9 MB Conformer + the city's word list)
//   → language (core/lang-decide.js: English or Spanish, names masked; or the visitor's choice)
//   → reader and answer (domains/places/ask.js: rules, no AI model, from the San Miguel pack in packs/dist/)
//   → MX1 voice (browser/tinyvoca-js-worker.js: tiny-voca in plain JavaScript, one 8 MB file, English and Spanish).
// Nothing the visitor says leaves the device: sound goes to a worker on this page, never to a server.
import { detector, speechAt16k } from "../browser/listen.js";
import { appConfig, limitsOf } from "../core/config.js";
import { createPackLoader } from "../core/pack/loader.js";
import { decideLanguage, namesOf } from "../core/lang-decide.js";
import { createAsker, nowAt } from "../domains/places/ask.js";

const CITY = "mx-sma";
const at = (path) => new URL(path, import.meta.url).href;
const EARS_MODEL = at("../engines/ears/ears-int8-2026-11-20.onnx");
const EARS_LEXICON = at(`../packs/dist/${CITY}/ears-lexicon.json`);
const VOICE_FILE = at("../vendor/tiny-voca/tiny-voca-mx1-2026-11-21.gguf");
const VOICE_SHA = "921d4f8406fd7f988541c5a5487e5b8712740440a93f2f68b836baec4e1a07c6";
const ASR_URL = at(`../browser/asr-worker.js?libs=tiny-speech-demo-libs-1&ears=${encodeURIComponent(EARS_MODEL)}&lexicon=${encodeURIComponent(EARS_LEXICON)}`);
const VOICE_URL = at(`../browser/tinyvoca-js-worker.js?cache=tiny-speech-demo-voice-&model=${encodeURIComponent(VOICE_FILE)}&sha256=${VOICE_SHA}`);
const LIMITS = limitsOf(appConfig({}));
const EXAMPLES = ["Is La Azotea open now?", "¿Dónde hay tacos al pastor?", "Live music tonight", "Desayuno cerca del Jardín", "Rooftop bars open now", "4 more"];

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
const ready = { ears: false, pack: false, voice: false };
const state = (text) => { $("state").textContent = text; };
const part = (id, html) => { $(id).innerHTML = html; };
function checkReady() {
  const mic = $("mic");
  if (!rec) { mic.disabled = !(ready.ears && ready.pack); mic.textContent = mic.disabled ? "Loading…" : "Ask"; }
  if (ready.ears && ready.pack && !busy) state(ready.voice ? "Tap Ask and speak, in English or Spanish." : "Tap Ask and speak. The voice is still loading.");
}

// ---------- the city: the San Miguel pack, and one asker per answer language ----------
let pack = null, names = [], askers = {};
const packLoading = createPackLoader({ base: at("../packs/dist/"), cachePrefix: "tiny-speech-demo" }).load(CITY).then((r) => {
  pack = r.pack;
  names = namesOf(pack);
  askers = { en: createAsker({ pack, lang: "en" }), es: createAsker({ pack, lang: "es" }) };
  ready.pack = true;
  part("packState", `<span class="ready">Ready</span> · San Miguel, ${pack.places.length} places, version ${esc(r.version)}`);
  voice().postMessage({ type: "city", english: pack.lexicon?.english || [], readings: pack.lexicon?.readings || {}, names: pack.places.map((p) => p.name) });
  checkReady();
}, (err) => part("packState", `Could not load the city: ${esc(err.message || err)}`));

// ---------- tiny ears: speech to text in a worker ----------
let asrWorker = null, asrReq = 0;
const asrWaiting = new Map();
function asr() {
  if (asrWorker) return asrWorker;
  asrWorker = new Worker(ASR_URL, { type: "module" });
  asrWorker.onmessage = ({ data }) => {
    if (data.type === "progress") { part("earsState", `Loading ${Math.round(data.frac * 100)}%`); return; }
    if (data.type === "ready") { ready.ears = true; part("earsState", `<span class="ready">Ready</span> · ${data.ms != null ? `${data.ms} ms` : "kept"}${data.kept ? " (from this device)" : ""}`); checkReady(); return; }
    if (data.type === "error") { part("earsState", `Could not load: ${esc(data.message)}`); return; }
    if (data.type === "text") {
      const w = asrWaiting.get(data.reqId);
      asrWaiting.delete(data.reqId);
      if (w) data.error ? w.reject(new Error(data.error)) : w.resolve(data);
    }
  };
  asrWorker.onerror = (e) => part("earsState", `The speech worker failed: ${esc(e.message || "")}`);
  return asrWorker;
}
function transcribe(audio) {
  const reqId = ++asrReq;
  return new Promise((resolve, reject) => {
    asrWaiting.set(reqId, { resolve, reject });
    asr().postMessage({ type: "transcribe", reqId, model: "tiny-ears", audio }, [audio.buffer]);
  });
}

// ---------- MX1: the voice in a worker; one <audio> player, unlocked by the first tap (Safari) ----------
let voiceWorker = null, mx1 = 0, speakId = 0, playerEl = null, unlocked = false, queue = [], playing = false;
const speaking = new Map();
function voice() {
  if (voiceWorker) return voiceWorker;
  voiceWorker = new Worker(VOICE_URL, { type: "module" });
  voiceWorker.onmessage = ({ data }) => {
    if (data.type === "status") { part("voiceState", `${esc(data.text)}${data.progress != null ? ` ${Math.round(data.progress * 100)}%` : ""}`); return; }
    if (data.type === "ready") {
      mx1 = Math.max(0, (data.voices || []).indexOf("MX1"));
      ready.voice = true;
      part("voiceState", `<span class="ready">Ready</span> · ${data.ms} ms${data.kept ? " (from this device)" : ""}`);
      checkReady();
      return;
    }
    const job = speaking.get(data.id);
    if (data.type === "sentence" && job) {
      if (job.first == null) { job.first = Math.round(performance.now() - job.asked); job.onFirst?.(job.first); }
      job.say.chunks.push({ samples: data.audio, rate: data.sampleRate });
      enqueue(data.audio, data.sampleRate);
    } else if (data.type === "done" || data.type === "error") {
      speaking.delete(data.id);
      if (job && data.type === "done") job.say.complete = true;
      job?.resolve(data);
      playButton();
    }
  };
  voiceWorker.onerror = (e) => part("voiceState", `The voice worker failed: ${esc(e.message || "")}`);
  voiceWorker.postMessage({ type: "load" });
  return voiceWorker;
}
function speak(sentences, lang, onFirst) {
  stopSpeaking();
  const id = ++speakId, say = (lastSay = { sentences, lang, chunks: [], complete: false });
  return new Promise((resolve) => {
    speaking.set(id, { asked: performance.now(), first: null, onFirst, resolve, say });
    voice().postMessage({ type: "speak", id, sentences, voice: mx1, speed: 1.0, lang });
    playButton();
  });
}
// Stop and Play: the last answer's sound is kept, so Play repeats it at once (or reads it again if it was stopped halfway);
// Stop ends it: the voice stops making sentences and the player stops. Asking again, or Escape, stops it too.
let lastSay = null;  // {sentences, lang, chunks: [{samples, rate}], complete}
const busySpeaking = () => playing || speaking.size > 0;
const ICON = { stop: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="6" y="6" width="12" height="12" rx="2" fill="currentColor"/></svg>',
  play: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5.5v13l10.5-6.5z" fill="currentColor"/></svg>' };
function playButton() {
  const b = $("play"), on = busySpeaking();
  b.hidden = !lastSay;
  b.classList.toggle("on", on);
  const es = lastSay?.lang === "es";
  b.innerHTML = on ? `${ICON.stop}<span>${es ? "Parar" : "Stop"}</span>` : `${ICON.play}<span>${es ? "Escuchar otra vez" : "Play again"}</span>`;
  b.setAttribute("aria-label", on ? "Stop the spoken answer" : "Play the answer again");
}
function stopSpeaking() {
  if (voiceWorker) voiceWorker.postMessage({ type: "stop" });
  for (const job of speaking.values()) job.resolve({ type: "stopped" });
  speaking.clear();
  stopSound();
  playButton();
}
function replay() {
  if (!lastSay) return;
  if (!lastSay.complete || !lastSay.chunks.length) { speak(lastSay.sentences, lastSay.lang); return; }
  stopSpeaking();
  for (const c of lastSay.chunks) enqueue(c.samples, c.rate);
  playButton();
}
function wavBlob(samples, rate) {
  const n = samples.length, buf = new ArrayBuffer(44 + n * 2), v = new DataView(buf);
  const str = (o, t) => { for (let i = 0; i < t.length; i++) v.setUint8(o + i, t.charCodeAt(i)); };
  str(0, "RIFF"); v.setUint32(4, 36 + n * 2, true); str(8, "WAVE"); str(12, "fmt "); v.setUint32(16, 16, true); v.setUint16(20, 1, true);
  v.setUint16(22, 1, true); v.setUint32(24, rate, true); v.setUint32(28, rate * 2, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true);
  str(36, "data"); v.setUint32(40, n * 2, true);
  for (let i = 0; i < n; i++) { const x = Math.max(-1, Math.min(1, samples[i])); v.setInt16(44 + i * 2, x < 0 ? x * 0x8000 : x * 0x7fff, true); }
  return new Blob([buf], { type: "audio/wav" });
}
function player() { if (!playerEl) { playerEl = new Audio(); playerEl.setAttribute("playsinline", ""); } return playerEl; }
function unlockAudio() {
  if (unlocked || playing) return;
  const el = player(), url = URL.createObjectURL(wavBlob(new Float32Array(2400), 24000));
  el.src = url; el.play().catch(() => {}).finally(() => setTimeout(() => URL.revokeObjectURL(url), 2000));
  unlocked = true;
}
document.addEventListener("pointerdown", unlockAudio, { capture: true });
document.addEventListener("keydown", unlockAudio, { capture: true });
function enqueue(samples, rate) { queue.push(URL.createObjectURL(wavBlob(samples, rate))); if (!playing) playNext(); }
function playNext() {
  const url = queue.shift();
  if (!url) { playing = false; playButton(); return; }
  if (!playing) { playing = true; playButton(); }
  const el = player();
  el.onended = el.onerror = () => { URL.revokeObjectURL(url); playNext(); };
  el.src = url;
  el.play().catch(() => { URL.revokeObjectURL(url); playNext(); });
}
function stopSound() { queue.forEach((u) => URL.revokeObjectURL(u)); queue = []; if (playerEl) playerEl.pause(); playing = false; }

// ---------- the microphone: raw sound, no echo cancellation, ended by a pause (as the sites record) ----------
let micStream = null, rec = null, busy = false;
async function startRec() {
  stopSpeaking();
  const AC = window.AudioContext || window.webkitAudioContext;
  const ctx = new AC();  // made in the tap: iPhone and iPad start sound only inside a tap
  if (ctx.state === "suspended") ctx.resume().catch(() => {});
  try {
    if (!micStream || !micStream.getAudioTracks().some((t) => t.readyState === "live")) {
      micStream = await navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1, echoCancellation: false, noiseSuppression: false, autoGainControl: false } });
    }
  } catch (err) { ctx.close().catch(() => {}); micHelp(err); return; }
  micStream.getAudioTracks().forEach((t) => { t.enabled = true; });
  $("micHelp").hidden = true;
  const r = { ctx, d: detector(ctx.sampleRate, LIMITS), began: 0, tick: 0, src: null, node: null, mute: null };
  try {
    if (ctx.state === "suspended") await ctx.resume();
    r.src = ctx.createMediaStreamSource(micStream);
    if (ctx.audioWorklet && window.AudioWorkletNode) {
      try { await ctx.audioWorklet.addModule(at("../browser/pcm-worklet.js")); r.node = new AudioWorkletNode(ctx, "pcm-tap"); r.node.port.onmessage = (e) => hear(r, e.data); } catch { r.node = null; }
    }
    if (!r.node) { r.node = ctx.createScriptProcessor(2048, 1, 1); r.node.onaudioprocess = (e) => hear(r, new Float32Array(e.inputBuffer.getChannelData(0))); }
    r.mute = ctx.createGain(); r.mute.gain.value = 0;  // the graph runs only when it reaches the speakers: so it does, silently
    r.src.connect(r.node); r.node.connect(r.mute); r.mute.connect(ctx.destination);
  } catch (err) { endRecording(r); state(`Recording could not start: ${err.message || err}`); return; }
  r.began = performance.now();
  rec = r;
  $("mic").classList.add("rec");
  $("mic").textContent = "Stop";
  state("Listening… say something.");
  r.tick = setInterval(() => {
    if (rec !== r) return;
    const used = performance.now() - r.began;
    if (used > 1500 && r.d.n === 0) { rec = null; endRecording(r); state("The microphone gave no sound."); return; }
    if (used >= LIMITS.REC_MAX_MS) { stopRec(); return; }
    if (r.d.speechAt >= 0) state("Listening… it ends when you stop talking.");
  }, 100);
}
function hear(r, buf) {
  if (rec !== r) return;
  const event = r.d.feed(buf);
  $("level").style.width = `${Math.round(Math.min(1, Math.sqrt((r.d.rms || 0) / 0.12)) * 100)}%`;
  if (event === "end") stopRec();
}
function endRecording(r) {
  clearInterval(r.tick);
  try { r.src?.disconnect(); r.node?.disconnect(); r.mute?.disconnect(); } catch { /* already gone */ }
  if (r.node?.port) r.node.port.onmessage = null; else if (r.node) r.node.onaudioprocess = null;
  r.ctx.close().catch(() => {});
  micStream?.getAudioTracks().forEach((t) => { t.enabled = false; });
  $("mic").classList.remove("rec");
  $("level").style.width = "0";
  checkReady();
}
async function stopRec() {
  const r = rec;
  if (!r) return;
  rec = null;
  endRecording(r);
  const audio = speechAt16k(r.d), seconds = audio.length / 16000;
  if (audio.length < 16000 * 0.4) { state("That was too short. Try again."); return; }
  busy = true;
  state("Turning speech into text…");
  try {
    const out = await transcribe(audio);
    const text = String(out.text || "").trim();
    if (!text) { state("Nothing heard. Try again, a little closer."); return; }
    await ask(text, `${seconds.toFixed(1)} s of speech · tiny ears ${out.runMs} ms (${out.matchMs} ms of it the word list)`);
  } catch (err) {
    state(`Speech to text failed: ${err.message || err}`);
  } finally { busy = false; checkReady(); }
}

// When the browser refuses the microphone: what to do, for this kind of device. NotAllowedError is a refusal the page cannot
// overturn (a "Don't allow" remembered for this site, the phone's setting, or an app's built-in browser that gives no microphone).
const IOS = /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
const ANDROID = /Android/.test(navigator.userAgent);
function micHelp(err) {
  const name = err?.name || "";
  let steps;
  if (name === "NotFoundError" || name === "OverconstrainedError") steps = ["This device has no microphone the browser can use. Type the question instead."];
  else if (!window.isSecureContext || !navigator.mediaDevices) steps = ["The microphone works only on a secure page (https://). Open https://larsboesen-prog.github.io/tiny-speech/demo/ ."];
  else if (IOS) steps = [
    "If you opened this link inside another app (Claude, Mail, Slack, WhatsApp…), open it in <b>Safari</b> instead: the share button, then <i>Open in Safari</i>.",
    "In Safari: tap the page menu left of the address (or <b>aA</b>), then <b>Website Settings</b> › <b>Microphone</b> › <b>Allow</b> (or <i>Ask</i>), and reload.",
    "Still blocked: iPhone <b>Settings</b> › <b>Apps</b> › <b>Safari</b> (older iPhones: Settings › Safari) › <b>Microphone</b> › <i>Ask</i> or <i>Allow</i>."];
  else if (ANDROID) steps = [
    "If you opened this link inside another app, open it in <b>Chrome</b> instead (the ⋮ menu, <i>Open in Chrome</i>).",
    "In Chrome: tap the icon left of the address › <b>Permissions</b> (or <i>Site settings</i>) › <b>Microphone</b> › <b>Allow</b>, and reload.",
    "Still blocked: Android <b>Settings</b> › <b>Apps</b> › <b>Chrome</b> › <b>Permissions</b> › <b>Microphone</b> › <i>Allow</i>."];
  else steps = [
    "Click the icon left of the address (a lock or sliders) › <b>Microphone</b> › <b>Allow</b>, and reload.",
    "On a Mac, also <b>System Settings</b> › <b>Privacy &amp; Security</b> › <b>Microphone</b>: your browser switched on. On Windows: <b>Settings</b> › <b>Privacy</b> › <b>Microphone</b>."];
  state(name === "NotFoundError" ? "No microphone found." : "The browser did not let this page use the microphone.");
  $("micHelp").innerHTML = `<ol>${steps.map((x) => `<li>${x}</li>`).join("")}</ol><p>Or type the question, or tap an example: the answer is still read aloud.</p><p class="meta">${esc(name || String(err))}</p>`;
  $("micHelp").hidden = false;
}

// ---------- a question: language, answer, voice ----------
let override = null, lastLang = null;
const last = { en: null, es: null };
async function ask(text, heardHow = "typed") {
  await packLoading;
  if (!pack) return null;
  const t0 = performance.now();
  const d = decideLanguage({ text, names, prior: lastLang, override });
  const res = askers[d.lang].answer(text, nowAt(pack.tz), last[d.lang], null);
  if (res.kind === "list") last[d.lang] = res;
  lastLang = d.lang;
  const ms = performance.now() - t0;
  $("heard").textContent = text;
  $("heardMeta").textContent = `${heardHow} · ${d.lang === "es" ? "Spanish" : "English"} (${d.why})`;
  const byId = Object.fromEntries(pack.places.map((p) => [p.id, p]));
  const lines = res.lines || [{ text: res.show }];
  // the lines in their order: a paragraph each, and the places among them as a list
  const nameless = (l) => { const name = byId[l.id].name; return l.text && l.text.startsWith(name) ? l.text.slice(name.length).replace(/^[\s·,:]+/, "") : l.text; };
  let html = "", open = false;
  for (const l of lines) {
    const place = l.id && byId[l.id];
    if (place && !open) { html += "<ul>"; open = true; }
    if (!place && open) { html += "</ul>"; open = false; }
    html += place ? `<li><b>${esc(place.name)}</b>${nameless(l) ? ` · ${esc(nameless(l))}` : ""}</li>` : `<p>${esc(l.text)}</p>`;
  }
  $("answer").innerHTML = html + (open ? "</ul>" : "");
  const sentences = (res.say || []).map((s) => s.text).filter(Boolean);
  const meta = `answered in ${ms < 10 ? ms.toFixed(1) : Math.round(ms)} ms`;
  $("answerMeta").textContent = meta;
  if (!ready.voice) { $("answerMeta").textContent = `${meta} · the voice is still loading`; return res; }
  state(d.lang === "es" ? "Hablando…" : "Speaking…");
  const done = speak(sentences, d.lang, (first) => { $("answerMeta").textContent = `${meta} · MX1 first sound after ${first} ms`; });
  done.then(() => { if (!busy && !rec) checkReady(); });
  return res;
}

// ---------- the page ----------
for (const text of EXAMPLES) {
  const b = document.createElement("button");
  b.type = "button"; b.className = "chip"; b.textContent = text;
  b.onclick = () => { $("q").value = text; ask(text); };
  $("examples").append(b);
}
$("typed").addEventListener("submit", (e) => { e.preventDefault(); const t = $("q").value.trim(); if (t) ask(t); });
$("mic").onclick = () => (rec ? stopRec() : startRec());
$("play").onclick = () => (busySpeaking() ? stopSpeaking() : replay());
document.addEventListener("keydown", (e) => { if (e.key === "Escape" && busySpeaking()) stopSpeaking(); });
for (const b of document.querySelectorAll(".lang button")) b.onclick = () => {
  override = b.dataset.lang || null;
  for (const x of document.querySelectorAll(".lang button")) x.setAttribute("aria-pressed", String(x === b));
};
asr().postMessage({ type: "load", model: "tiny-ears" });
voice();

// For automated checks (and the console).
window.tinySpeechDemo = { ask, transcribe, speak, ready, packLoading, playback: () => ({ playing, making: speaking.size, kept: lastSay?.chunks.length || 0, complete: !!lastSay?.complete }) };
