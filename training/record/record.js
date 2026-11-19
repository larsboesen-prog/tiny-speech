// The recording page (training/RECIPE.md step 4, a real voice): one clip per sentence, raw from the microphone (no echo
// cancelling, noise suppression or automatic gain), checked as it is made, kept in this browser's IndexedDB so a reload or a
// crash loses nothing, and downloaded as one zip per session for the GPU pipeline (training/gpu/). Nothing is uploaded.
// ?set=asr: the speech-recognition set instead (training/asr/README.md): native Mexican speakers read restaurant requests and
// say some in their own words (a typed transcript then goes with the take); its own list, storage, consent and speaker details.
const VERSION = "record 2";
const $ = (id) => document.getElementById(id);
const SET = new URL(location.href).searchParams.get("set") === "asr" ? "asr" : "voice";
const db = await openDb();
const list = await (await fetch(SET === "asr" ? "../asr/prompts.json" : "sentences.json")).json();
const state = { session: 1, index: 0, ctx: null, stream: null, node: null, recording: false, chunks: [], take: null, noiseDb: null, device: "", settings: {} };

// ---------- storage ----------
function openDb() {
  return new Promise((resolve, reject) => {
    const r = indexedDB.open(SET === "asr" ? "tiny-speech-recording-asr" : "tiny-speech-recording", 1);
    r.onupgradeneeded = () => { r.result.createObjectStore("clips", { keyPath: "id" }); r.result.createObjectStore("meta", { keyPath: "k" }); };
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
}
const tx = (store, mode, fn) => new Promise((resolve, reject) => {
  const t = db.transaction(store, mode), s = t.objectStore(store), out = fn(s);
  t.oncomplete = () => resolve(out?.result ?? out);
  t.onerror = () => reject(t.error);
});
const putClip = (c) => tx("clips", "readwrite", (s) => s.put(c));
const getClip = (id) => tx("clips", "readonly", (s) => s.get(id));
const allClips = () => tx("clips", "readonly", (s) => s.getAll());
const putMeta = (k, v) => tx("meta", "readwrite", (s) => s.put({ k, v }));
const getMeta = async (k) => (await tx("meta", "readonly", (s) => s.get(k)))?.v;
let kept = new Set((await allClips()).map((c) => c.id));

// ---------- sound ----------
const db20 = (x) => (x > 0 ? 20 * Math.log10(x) : -120);
function frames(x, rate, ms = 20) {
  const n = Math.max(1, Math.round((rate * ms) / 1000)), out = [];
  for (let i = 0; i + n <= x.length; i += n) { let s = 0; for (let j = i; j < i + n; j++) s += x[j] * x[j]; out.push(db20(Math.sqrt(s / n))); }
  return { db: out, n };
}
const median = (a) => { const b = [...a].sort((p, q) => p - q); return b.length ? b[b.length >> 1] : -120; };

/** Trim the silence around speech (keeping 0.3 s each side) and check the take. */
export function analyse(x, rate, { noiseDb = null, expected = null } = {}) {
  const { db, n } = frames(x, rate);
  const floor = noiseDb ?? median(db.slice(0, 10));
  const gate = Math.max(floor + 12, -55);
  const first = db.findIndex((d) => d > gate), last = db.length - 1 - [...db].reverse().findIndex((d) => d > gate);
  const flags = [];
  if (first < 0) return { clip: x, flags: ["silent"], peakDb: -120, snrDb: 0, seconds: x.length / rate };
  const pad = Math.round(0.3 * rate);
  const from = Math.max(0, first * n - pad), to = Math.min(x.length, (last + 1) * n + pad);
  const clip = x.slice(from, to);
  let peak = 0, clipped = 0;
  for (const v of clip) { const a = Math.abs(v); if (a > peak) peak = a; if (a >= 0.999) clipped++; }
  const speech = db.slice(first, last + 1).filter((d) => d > gate);
  const snrDb = median(speech) - floor, peakDb = db20(peak), seconds = clip.length / rate;
  if (clipped > 2) flags.push("clipped");
  if (peakDb < -30) flags.push("quiet");
  if (snrDb < 25) flags.push("noisy");
  if (first * n < 0.1 * rate) flags.push("started-early");
  if ((last + 1) * n > x.length - 0.1 * rate) flags.push("cut-off");
  if (expected && seconds < expected * 0.45) flags.push("short");
  if (expected && seconds > expected * 2.5) flags.push("long");
  return { clip, flags, peakDb: +peakDb.toFixed(1), snrDb: +snrDb.toFixed(1), seconds: +seconds.toFixed(2) };
}

export function wav(samples, rate) {
  const buf = new ArrayBuffer(44 + samples.length * 2), v = new DataView(buf);
  const w = (o, s) => [...s].forEach((c, i) => v.setUint8(o + i, c.charCodeAt(0)));
  w(0, "RIFF"); v.setUint32(4, 36 + samples.length * 2, true); w(8, "WAVEfmt "); v.setUint32(16, 16, true); v.setUint16(20, 1, true);
  v.setUint16(22, 1, true); v.setUint32(24, rate, true); v.setUint32(28, rate * 2, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true);
  w(36, "data"); v.setUint32(40, samples.length * 2, true);
  for (let i = 0; i < samples.length; i++) v.setInt16(44 + i * 2, Math.max(-32768, Math.min(32767, Math.round(samples[i] * 32767))), true);
  return new Blob([buf], { type: "audio/wav" });
}

// ---------- zip (stored, no compression: WAV hardly compresses) ----------
const CRC = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
const crc32 = (u8) => { let c = 0xffffffff; for (let i = 0; i < u8.length; i++) c = CRC[(c ^ u8[i]) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
export async function zip(files) {  // files: [{name, data: Blob | string}]
  const parts = [], central = [], enc = new TextEncoder();
  let offset = 0;
  const d = new Date(), time = (d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1), date = ((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate();
  for (const f of files) {
    const data = typeof f.data === "string" ? enc.encode(f.data) : new Uint8Array(await f.data.arrayBuffer());
    const name = enc.encode(f.name), crc = crc32(data);
    const h = new DataView(new ArrayBuffer(30));
    h.setUint32(0, 0x04034b50, true); h.setUint16(4, 20, true); h.setUint16(6, 0x0800, true); h.setUint16(8, 0, true); h.setUint16(10, time, true); h.setUint16(12, date, true);
    h.setUint32(14, crc, true); h.setUint32(18, data.length, true); h.setUint32(22, data.length, true); h.setUint16(26, name.length, true); h.setUint16(28, 0, true);
    parts.push(h.buffer, name, data);
    const c = new DataView(new ArrayBuffer(46));
    c.setUint32(0, 0x02014b50, true); c.setUint16(4, 20, true); c.setUint16(6, 20, true); c.setUint16(8, 0x0800, true); c.setUint16(10, 0, true); c.setUint16(12, time, true); c.setUint16(14, date, true);
    c.setUint32(16, crc, true); c.setUint32(20, data.length, true); c.setUint32(24, data.length, true); c.setUint16(28, name.length, true); c.setUint32(42, offset, true);
    central.push(c.buffer, name);
    offset += 30 + name.length + data.length;
  }
  const size = central.reduce((s, p) => s + (p.byteLength ?? p.length), 0);
  const e = new DataView(new ArrayBuffer(22));
  e.setUint32(0, 0x06054b50, true); e.setUint16(8, files.length, true); e.setUint16(10, files.length, true); e.setUint32(12, size, true); e.setUint32(16, offset, true);
  return new Blob([...parts, ...central, e.buffer], { type: "application/zip" });
}

// ---------- microphone ----------
async function listMics() {
  try {
    const devices = (await navigator.mediaDevices.enumerateDevices()).filter((d) => d.kind === "audioinput");
    const sel = $("mic"), was = sel.value;
    sel.innerHTML = '<option value="">Default · Predeterminado</option>' + devices.map((d) => `<option value="${d.deviceId}">${d.label || "Microphone"}</option>`).join("");
    sel.value = was;
  } catch { /* labels come after permission */ }
}
async function startMic() {
  state.stream?.getTracks().forEach((t) => t.stop());
  state.stream = await navigator.mediaDevices.getUserMedia({ audio: { deviceId: $("mic").value || undefined, channelCount: 1, echoCancellation: false, noiseSuppression: false, autoGainControl: false } });
  const track = state.stream.getAudioTracks()[0];
  state.device = track.label;
  state.settings = track.getSettings ? track.getSettings() : {};
  await putMeta("mic", { device: state.device, settings: state.settings });
  if (!state.ctx) {
    state.ctx = new AudioContext();
    await state.ctx.audioWorklet.addModule("tap-worklet.js");
  }
  await state.ctx.resume();
  state.node?.disconnect();
  const src = state.ctx.createMediaStreamSource(state.stream);
  state.node = new AudioWorkletNode(state.ctx, "tap");
  state.node.port.onmessage = (e) => {
    const x = e.data;
    let s = 0; for (const v of x) s += v * v;
    const dB = db20(Math.sqrt(s / x.length));
    $("level").style.width = `${Math.max(0, Math.min(100, ((dB + 60) / 60) * 100))}%`;
    if (state.recording || state.listening) state.chunks.push(x);
  };
  src.connect(state.node);
  await listMics();
  state.noiseDb = (await getMeta("noiseDb")) ?? null;
}
const joined = () => { const n = state.chunks.reduce((s, c) => s + c.length, 0), out = new Float32Array(n); let o = 0; for (const c of state.chunks) { out.set(c, o); o += c.length; } return out; };

async function checkRoom() {
  $("room").textContent = "Quiet please… · Silencio…";
  state.chunks = []; state.listening = true;
  await new Promise((r) => setTimeout(r, 5000));
  state.listening = false;
  const { db } = frames(joined(), state.ctx.sampleRate, 50);
  state.noiseDb = +median(db).toFixed(1);
  await putMeta("noiseDb", state.noiseDb);
  const verdict = state.noiseDb < -60 ? ["ok", "very quiet, good · muy silencioso"] : state.noiseDb < -50 ? ["ok", "quiet enough · suficiente"] : ["bad", "too noisy: close windows, turn off fans · demasiado ruido"];
  $("room").innerHTML = `<span class="${verdict[0]}">Room noise ${state.noiseDb} dB: ${verdict[1]}</span>`;
}

// ---------- sentences ----------
const inSession = () => list.filter((r) => String(r.session) === String(state.session));
const current = () => inSession()[state.index];
function show() {
  const rows = inSession(), r = current();
  const done = rows.filter((x) => kept.has(x.id)).length;
  $("progress").textContent = `${done} of ${rows.length} kept in this session · ${kept.size} in all`;
  if (!r) { $("sentence").textContent = "This session is done. Download it below. · Sesión terminada."; return; }
  $("num").textContent = `${r.n} · ${state.index + 1}/${rows.length}`;
  $("lang").textContent = r.lang === "es" ? "Español (México)" : "English";
  $("why").textContent = r.why === "reference" ? "reference: calm and natural · referencia: tranquila y natural"
    : r.why === "scenario" ? "say it your own way · dilo con tus propias palabras" : "";
  $("sentence").textContent = r.text;
  $("sentence").classList.toggle("card", r.why === "scenario");
  $("saidBox").hidden = r.why !== "scenario";
  if (r.why === "scenario") getClip(r.id).then((c) => { $("said").value = c?.text || ""; });
  $("sentence").lang = r.lang === "es" ? "es-MX" : "en-US";
  state.take = null;
  $("play").disabled = !kept.has(r.id); $("keep").disabled = true;
  $("status").innerHTML = kept.has(r.id) ? '<span class="ok">Recorded ✓ (record again to replace it) · Ya grabada</span>' : "";
  renderDownloads();
}
async function toggle() {
  const r = current();
  if (!r || !state.ctx) return;
  if (!state.recording) {
    state.chunks = []; state.recording = true;
    $("rec").innerHTML = "Stop <kbd>Space</kbd>"; $("status").innerHTML = '<span class="rec">● Recording · Grabando</span>';
    $("keep").disabled = true; $("play").disabled = true;
    return;
  }
  state.recording = false;
  $("rec").innerHTML = "Record again <kbd>Space</kbd>";
  const rate = state.ctx.sampleRate, a = analyse(joined(), rate, { noiseDb: state.noiseDb, expected: r.seconds });
  state.take = { ...a, rate };
  const words = { clipped: "clipped: move back or lower the input · saturada", quiet: "too quiet: come closer · muy bajo", noisy: "noisy room · ruido",
    "started-early": "started too soon: wait half a second · empezaste muy pronto", "cut-off": "cut off at the end: wait before stopping · cortada al final",
    short: "shorter than expected: was every word read? · ¿se leyó todo?", long: "longer than expected: was it one take? · más larga de lo esperado", silent: "nothing heard · no se oyó nada" };
  $("status").innerHTML = a.flags.length ? `<span class="warn">${a.flags.map((f) => words[f]).join("; ")}</span> (level ${a.peakDb} dB, ${a.seconds} s)`
    : `<span class="ok">Good: level ${a.peakDb} dB, ${a.snrDb} dB above the room, ${a.seconds} s · Bien</span>`;
  $("keep").disabled = a.flags.includes("silent"); $("play").disabled = false;
}
async function keep() {
  const r = current(), t = state.take;
  if (!r || !t || t.flags.includes("silent")) return;
  // in their own words: the take goes with what was actually said, typed by the speaker or a helper (checked again later)
  const said = r.why === "scenario" ? $("said").value.replace(/\s+/g, " ").trim() : null;
  if (r.why === "scenario" && !said) { $("status").innerHTML = '<span class="warn">Type what was said first · Escribe primero lo que se dijo</span>'; $("said").focus(); return; }
  await putClip({ id: r.id, n: r.n, session: r.session, lang: r.lang, text: said ?? r.text, prompt: r.text, kind: r.why || "read", speaker: $("speaker").value.trim() || (SET === "asr" ? "anon" : "MX1"), rate: t.rate,
    seconds: t.seconds, peakDb: t.peakDb, snrDb: t.snrDb, flags: t.flags, at: new Date().toISOString(), wav: wav(t.clip, t.rate) });
  kept.add(r.id);
  state.index = Math.min(inSession().length, state.index + 1);
  show();
}
async function play() {
  const r = current();
  let x = state.take?.clip, rate = state.take?.rate;
  if (!x && r && kept.has(r.id)) { const c = await getClip(r.id); rate = c.rate; x = await decode(c.wav); }
  if (!x) return;
  const b = state.ctx.createBuffer(1, x.length, rate); b.copyToChannel(x, 0);
  const s = state.ctx.createBufferSource(); s.buffer = b; s.connect(state.ctx.destination); s.start();
}
async function decode(blob) { const v = new DataView(await blob.arrayBuffer()), n = (v.byteLength - 44) / 2, x = new Float32Array(n); for (let i = 0; i < n; i++) x[i] = v.getInt16(44 + i * 2, true) / 32767; return x; }

// ---------- download ----------
async function sessionZip(session) {
  const clips = (await allClips()).filter((c) => session === "all" || String(c.session) === String(session)).sort((a, b) => a.n - b.n);
  const csv = ["id|lang|text|seconds|peak_db|snr_db|flags|kind|prompt", ...clips.map((c) => [c.id, c.lang, c.text.replace(/\|/g, "/"), c.seconds, c.peakDb, c.snrDb, c.flags.join(" "),
    c.kind || "read", (c.prompt || c.text).replace(/\|/g, "/")].join("|"))].join("\n") + "\n";
  const info = { page: VERSION, set: SET, speakerInfo: (await getMeta("speakerInfo")) || null, speaker: clips[0]?.speaker || $("speaker").value, session, clips: clips.length, consent: (await getMeta("consent")) || null, ...((await getMeta("mic")) || {}), sampleRates: [...new Set(clips.map((c) => c.rate))], roomNoiseDb: state.noiseDb, userAgent: navigator.userAgent, made: new Date().toISOString() };
  return zip([{ name: "info.json", data: JSON.stringify(info, null, 2) }, { name: "metadata.csv", data: csv }, ...clips.map((c) => ({ name: `wavs/${c.id}.wav`, data: c.wav }))]);
}
async function download(session) {
  const blob = await sessionZip(session), a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `${$("speaker").value.trim() || "MX1"}-${session === "all" ? "all" : "session" + session}-${new Date().toISOString().slice(0, 10)}.zip`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 60000);
}
async function renderDownloads() {
  const sessions = [...new Set(list.map((r) => r.session))];
  $("downloads").innerHTML = sessions.map((s) => { const n = list.filter((r) => r.session === s && kept.has(r.id)).length; return `<button data-s="${s}" ${n ? "" : "disabled"}>Session ${s} (${n})</button>`; }).join("") +
    `<button data-s="all" ${kept.size ? "" : "disabled"}>All (${kept.size})</button>`;
  const est = navigator.storage?.estimate ? await navigator.storage.estimate() : null;
  $("saved").textContent = est ? `Saved in this browser: about ${Math.round(est.usage / 1e6)} MB.` : "";
}

// ---------- wiring ----------
$("session").innerHTML = [...new Set(list.map((r) => r.session))].map((s) => `<option value="${s}">${s === "extra" ? "Extra" : s}</option>`).join("");
if (SET === "asr") {
  $("speakerInfo").hidden = false;
  $("consentLink").href = "../asr/CONSENT-ASR.md";
  $("setName").textContent = "Restaurant requests, for the speech recognizer · Peticiones a restaurantes, para el reconocedor de voz";
  $("speaker").value = "";
  $("speaker").placeholder = "e.g. H07 (given by the owner)";
  const packet = new URL(location.href).searchParams.get("packet");
  if (packet) { state.session = packet; $("session").value = packet; }
}
$("consent").onchange = () => { $("start").disabled = !$("consent").checked; };
$("start").onclick = async () => {
  try {
    await startMic();
    $("checks").hidden = false; $("studio").hidden = false; $("done").hidden = false;
    $("start").textContent = "Microphone on · Micrófono encendido";
    await putMeta("speaker", $("speaker").value);
    await putMeta("consent", { ticked: true, at: new Date().toISOString(), form: SET === "asr" ? "CONSENT-ASR.md" : "CONSENT.md" });
    if (SET === "asr") await putMeta("speakerInfo", Object.fromEntries([...document.querySelectorAll("#speakerInfo [name]")].map((x) => [x.name, x.value])));
    const first = inSession().findIndex((r) => !kept.has(r.id)); state.index = first < 0 ? 0 : first;
    show();
  } catch (e) { $("start").insertAdjacentHTML("afterend", `<span class="bad"> ${e.message}</span>`); }
};
$("mic").onchange = () => state.ctx && startMic();
$("roomBtn").onclick = checkRoom;
$("session").onchange = () => { state.session = $("session").value; const f = inSession().findIndex((r) => !kept.has(r.id)); state.index = f < 0 ? 0 : f; show(); };
$("rec").onclick = toggle; $("keep").onclick = keep; $("play").onclick = play;
$("back").onclick = () => { state.index = Math.max(0, state.index - 1); show(); };
$("skip").onclick = () => { state.index = Math.min(inSession().length, state.index + 1); show(); };
$("downloads").onclick = (e) => { const s = e.target.closest("button")?.dataset.s; if (s) download(s === "all" ? "all" : s); };
document.addEventListener("keydown", (e) => {
  if (/^(INPUT|SELECT|TEXTAREA)$/.test(document.activeElement?.tagName) || $("studio").hidden) return;
  const k = { " ": toggle, Enter: keep, p: play, P: play, ArrowLeft: () => $("back").click(), s: () => $("skip").click(), S: () => $("skip").click() }[e.key];
  if (k) { e.preventDefault(); k(); }
});
const savedSpeaker = await getMeta("speaker"); if (savedSpeaker) $("speaker").value = savedSpeaker;
renderDownloads();
window.recorder = { list, state, analyse, sessionZip, allClips, kept: () => kept.size, set: SET };
