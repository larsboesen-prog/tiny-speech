// Record place names once in your own voice (owner, 22 Nov 2026: "add a simple page where I can record 30 to 50 place names once in my
// own voice. Use those recordings as a test set, not for training"). The microphone is recorded as /page5 records it (raw sound, no echo
// cancellation, ended by a pause: browser/listen.js), cut to the speech and turned to 16 kHz, the rate the ears hear. The takes are kept
// in this browser (IndexedDB) until saved as one file: {names: [{id, name, prompt, seconds, wav (16 kHz 16-bit mono WAV, base64)}]}.
// Nothing is sent anywhere by this page. tools/names-test.mjs measures the names found before and after names-by-sound on that file.
import { detector, speechAt16k } from "../browser/listen.js";

const $ = (id) => document.getElementById(id);
const LIMITS = { REC_MAX_MS: 6000, END_SILENCE_MS: 900 };
let NAMES = [], cur = 0, takes = new Map();  // id -> Float32Array (16 kHz)

// ---------- kept in this browser: IndexedDB (a reload or a closed tab loses nothing) ----------
const DB = "record-names", STORE = "takes";
const db = new Promise((resolve) => {
  try {
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => resolve(null);
  } catch { resolve(null); }
});
async function keep(id, pcm) {
  const d = await db; if (!d) return;
  try { d.transaction(STORE, "readwrite").objectStore(STORE).put(toInt16(pcm).buffer, id); } catch { /* not kept: still in memory */ }
}
async function forget(id) { const d = await db; if (!d) return; try { const s = d.transaction(STORE, "readwrite").objectStore(STORE); id == null ? s.clear() : s.delete(id); } catch { /* none */ } }
async function kept() {
  const d = await db; if (!d) return new Map();
  return new Promise((resolve) => {
    const out = new Map();
    try {
      const req = d.transaction(STORE, "readonly").objectStore(STORE).openCursor();
      req.onsuccess = () => { const c = req.result; if (!c) return resolve(out); out.set(String(c.key), fromInt16(new Int16Array(c.value))); c.continue(); };
      req.onerror = () => resolve(out);
    } catch { resolve(out); }
  });
}
const toInt16 = (x) => { const o = new Int16Array(x.length); for (let i = 0; i < x.length; i++) o[i] = Math.max(-1, Math.min(1, x[i])) * 32767; return o; };
const fromInt16 = (x) => { const o = new Float32Array(x.length); for (let i = 0; i < x.length; i++) o[i] = x[i] / 32767; return o; };
function wav(pcm) {  // 16 kHz 16-bit mono
  const s = toInt16(pcm), b = new DataView(new ArrayBuffer(44 + s.length * 2));
  const str = (o, t) => { for (let i = 0; i < t.length; i++) b.setUint8(o + i, t.charCodeAt(i)); };
  str(0, "RIFF"); b.setUint32(4, 36 + s.length * 2, true); str(8, "WAVE"); str(12, "fmt "); b.setUint32(16, 16, true); b.setUint16(20, 1, true); b.setUint16(22, 1, true);
  b.setUint32(24, 16000, true); b.setUint32(28, 32000, true); b.setUint16(32, 2, true); b.setUint16(34, 16, true); str(36, "data"); b.setUint32(40, s.length * 2, true);
  for (let i = 0; i < s.length; i++) b.setInt16(44 + i * 2, s[i], true);
  return new Uint8Array(b.buffer);
}
const b64 = (u8) => { let s = ""; for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode(...u8.subarray(i, i + 0x8000)); return btoa(s); };

// ---------- the page ----------
function state(t) { $("state").textContent = t; }
function render() {
  const n = NAMES[cur];
  $("n").textContent = `Name ${cur + 1} of ${NAMES.length}${takes.has(n.id) ? " · recorded (record again to replace)" : ""}`;
  $("say").textContent = `“${n.prompt}”`;
  $("prog").textContent = `${takes.size} of ${NAMES.length} recorded`;
  $("save").disabled = !takes.size;
  for (const li of $("list").children) {
    const id = li.dataset.id, t = takes.get(id);
    li.classList.toggle("cur", id === n.id);
    const small = li.querySelector("small");
    small.textContent = t ? `✓ ${(t.length / 16000).toFixed(1)} s` : "not yet";
    small.classList.toggle("done", !!t);
    li.querySelector(".play").disabled = !t;
  }
}
function list() {
  $("list").innerHTML = "";
  NAMES.forEach((n, i) => {
    const li = document.createElement("li");
    li.dataset.id = n.id;
    li.innerHTML = `<div class="t"><b></b><small>not yet</small></div><div class="b"><button type="button" class="play" disabled>Play</button><button type="button" class="pick">Record</button></div>`;
    li.querySelector("b").textContent = `${i + 1}. ${n.prompt}`;
    li.querySelector(".play").addEventListener("click", () => play(n.id));
    li.querySelector(".pick").addEventListener("click", () => { cur = i; render(); window.scrollTo({ top: 0, behavior: "smooth" }); startRec(); });
    $("list").appendChild(li);
  });
}
let player = null;
function play(id) {
  const t = takes.get(id); if (!t) return;
  if (player) { player.pause(); URL.revokeObjectURL(player.src); }
  player = new Audio(URL.createObjectURL(new Blob([wav(t)], { type: "audio/wav" })));
  player.play().catch(() => {});
}

// ---------- the microphone, as /page5 and the demo record ----------
let micStream = null, rec = null;
async function startRec() {
  if (rec) return stopRec();
  const AC = window.AudioContext || window.webkitAudioContext;
  const ctx = new AC();  // made in the tap: iPhone and iPad start sound only inside a tap
  if (ctx.state === "suspended") ctx.resume().catch(() => {});
  try {
    if (!micStream || !micStream.getAudioTracks().some((t) => t.readyState === "live"))
      micStream = await navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1, echoCancellation: false, noiseSuppression: false, autoGainControl: false } });
  } catch (err) { ctx.close().catch(() => {}); micHelp(err); return; }
  micStream.getAudioTracks().forEach((t) => { t.enabled = true; });
  $("micHelp").hidden = true;
  const r = { ctx, d: detector(ctx.sampleRate, LIMITS), id: NAMES[cur].id, began: 0, tick: 0, src: null, node: null, mute: null };
  try {
    if (ctx.state === "suspended") await ctx.resume();
    r.src = ctx.createMediaStreamSource(micStream);
    if (ctx.audioWorklet && window.AudioWorkletNode) {
      try { await ctx.audioWorklet.addModule(new URL("../browser/pcm-worklet.js", import.meta.url).href); r.node = new AudioWorkletNode(ctx, "pcm-tap"); r.node.port.onmessage = (e) => hear(r, e.data); } catch { r.node = null; }
    }
    if (!r.node) { r.node = ctx.createScriptProcessor(2048, 1, 1); r.node.onaudioprocess = (e) => hear(r, new Float32Array(e.inputBuffer.getChannelData(0))); }
    r.mute = ctx.createGain(); r.mute.gain.value = 0;  // the graph runs only when it reaches the speakers: so it does, silently
    r.src.connect(r.node); r.node.connect(r.mute); r.mute.connect(ctx.destination);
  } catch (err) { end(r); state(`Recording could not start: ${err.message || err}`); return; }
  r.began = performance.now();
  rec = r;
  $("rec").classList.add("on"); $("rec").textContent = "Stop";
  state("Listening… say the question.");
  r.tick = setInterval(() => {
    if (rec !== r) return;
    const used = performance.now() - r.began;
    if (used > 1500 && r.d.n === 0) { rec = null; end(r); state("The microphone gave no sound."); return; }
    if (used >= LIMITS.REC_MAX_MS) stopRec();
  }, 100);
}
function hear(r, buf) {
  if (rec !== r) return;
  const ev = r.d.feed(buf);
  $("level").style.width = `${Math.round(Math.min(1, Math.sqrt((r.d.rms || 0) / 0.12)) * 100)}%`;
  if (ev === "end") stopRec();
}
function end(r) {
  clearInterval(r.tick);
  try { r.src?.disconnect(); r.node?.disconnect(); r.mute?.disconnect(); } catch { /* already gone */ }
  if (r.node?.port) r.node.port.onmessage = null; else if (r.node) r.node.onaudioprocess = null;
  r.ctx.close().catch(() => {});
  micStream?.getAudioTracks().forEach((t) => { t.enabled = false; });
  $("rec").classList.remove("on"); $("rec").textContent = "Record";
  $("level").style.width = "0";
}
function stopRec() {
  const r = rec; if (!r) return;
  rec = null; end(r);
  if (r.d.speechAt < 0) { state("No speech heard. Tap Record and try again, a little closer."); return; }
  const pcm = speechAt16k(r.d);
  if (pcm.length < 16000 * 0.4) { state("That was too short. Tap Record and try again."); return; }
  takes.set(r.id, pcm); keep(r.id, pcm);
  const i = NAMES.findIndex((n) => n.id === r.id);
  state(`Kept ${(pcm.length / 16000).toFixed(1)} s for “${NAMES[i].name}”.`);
  const next = NAMES.findIndex((n, k) => k > i && !takes.has(n.id)), first = NAMES.findIndex((n) => !takes.has(n.id));
  cur = next >= 0 ? next : first >= 0 ? first : i;
  if (takes.size === NAMES.length) state("All 40 recorded. Save the file below.");
  render();
}
const IOS = /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
function micHelp(err) {
  const name = (err && err.name) || "";
  $("micHelp").hidden = false;
  $("micHelp").textContent = name === "NotAllowedError"
    ? (IOS ? "The microphone is blocked for this site. In Safari: tap the page menu left of the address (or aA), then Website Settings → Microphone → Allow, and reload."
      : "The microphone is blocked for this site: allow it in the browser's site settings (the icon left of the address), then reload.")
    : `No microphone (${name || err}).`;
  state("");
}

// ---------- saving: one file, to hand over ----------
async function save() {
  const out = { about: "Place names recorded once by the owner: a test set for MapSMA's names by sound, not for training; not to be published",
    city: "mx-sma", made: new Date().toISOString().slice(0, 10), rate: 16000,
    names: NAMES.filter((n) => takes.has(n.id)).map((n) => ({ id: n.id, name: n.name, prompt: n.prompt, seconds: +(takes.get(n.id).length / 16000).toFixed(2), wav: b64(wav(takes.get(n.id))) })) };
  const blob = new Blob([JSON.stringify(out)], { type: "application/json" });
  const file = `my-place-names-${out.made}.json`;
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob); a.download = file;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 60000);
  $("saveNote").textContent = `Saved ${file} (${(blob.size / 1e6).toFixed(1)} MB, ${out.names.length} names). Now hand it over on the page Claude gave you.`;
}

$("rec").addEventListener("click", () => startRec());
$("save").addEventListener("click", () => save());
$("clear").addEventListener("click", async () => {
  if (!takes.size || !confirm("Delete all recordings on this device?")) return;
  takes.clear(); await forget(null); cur = 0; state("Deleted."); render();
});

(async () => {
  try {
    NAMES = (await (await fetch(new URL("names.json?v=20261122", import.meta.url))).json()).names;
  } catch (err) { state(`The names could not be loaded: ${err.message || err}`); return; }
  takes = await kept();
  for (const id of [...takes.keys()]) if (!NAMES.some((n) => n.id === id)) takes.delete(id);
  const first = NAMES.findIndex((n) => !takes.has(n.id));
  cur = first >= 0 ? first : 0;
  list(); render();
  $("rec").disabled = false;
  state(takes.size ? `${takes.size} kept from before. Tap Record for the next one.` : "Tap Record, say the question, then stop talking.");
})();
