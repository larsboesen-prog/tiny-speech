// tiny-speech check page: tries the shared core's files on a phone or a computer before a site switches to them.
// It uses the files exactly as a page does: listen.js and pcm-worklet.js for the microphone, asr-worker.js for speech to text,
// tinyvoca-worker.js for the voice. Put next to them (e.g. mapsma.com/tiny-speech/check.html) it uses that site's cache names,
// so what it loads is what the site's page finds later. ?site= and ?dizione= override the defaults.
import { CORE, detector, speechAt16k, to16k } from "./listen.js?v=0.1.0";

const V = "0.1.0";
const params = new URLSearchParams(location.search);
const HOST_SITE = /(^|\.)mapsma\.com$/.test(location.hostname) ? "mapsma" : /(^|\.)credbrief\.com$/.test(location.hostname) ? "credbrief" : "";
const SITE = params.get("site") ?? HOST_SITE;
const DIZIONE = params.get("dizione") ?? ({ mapsma: "/page5/tinyvoca/dizione.zip", credbrief: "/page40/tinyvoca/dizione.zip" }[SITE] || "");
const ASR_URL = `asr-worker.js?v=${V}&site=${encodeURIComponent(SITE)}`;
const VOICE_URL = `tinyvoca-worker.js?v=${V}&site=${encodeURIComponent(SITE)}${DIZIONE ? "&dizione=" + encodeURIComponent(DIZIONE) : ""}`;

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

$("about").textContent = `${CORE} · site: ${SITE || "(none: test cache names)"} · dizione: ${DIZIONE || "next to the worker"}`;
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
  const r = { ctx, d: detector(ctx.sampleRate), began: 0, tick: 0, src: null, node: null, mute: null, via: "" };
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
  voiceWorker = new Worker(VOICE_URL);
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
function speak(text, { play = true } = {}) {
  const id = ++speakId;
  return new Promise((resolve, reject) => {
    speaking.set(id, { chunks: [], resolve, reject, play });
    voice().postMessage({ type: "speak", id, text, voice: Number($("voice").value), speed: 1.0, pitch: Number($("pitch").value) });
  });
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
    const result = { said: text, heard, score, spokeMs, waitMs: out.waitMs, runMs: out.runMs, seconds: audio.length / rate };
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
$("phones").onclick = () => voice().postMessage({ type: "phones", id: 0, text: $("say").value });
$("roundTrip").onclick = roundTrip;
$("clearLog").onclick = () => { $("log").textContent = ""; };
$("cacheList").onclick = listCaches;
$("model").onchange = () => { if (asrLoaded) loadAsr(); };

// For automated checks (and the console): the same steps the buttons take.
window.tinySpeechCheck = { CORE, SITE, DIZIONE, loadAsr, loadVoice, teach, speak, transcribeAudio, roundTrip, listCaches };
