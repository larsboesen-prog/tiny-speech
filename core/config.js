// A site's config (plan step B9, apps/*.json): cache names, limits, models and the name-hint budget come from the site, not from
// tables in the workers. The page builds each worker's address from its config (workerUrl); a worker reads only its address,
// so it holds no site or host names. With no config, everything gets names of its own (a test copy never touches a site's caches).
export const DEFAULTS = Object.freeze({
  app: "",
  // engines: "" = engine files from their own hosts (jsDelivr, Hugging Face); a folder ("/tiny-speech/engines/") = the site's own
  // copies, listed with SHA-256 in browser/manifest.json and fetched by tools/manifest.mjs --fetch (plan step B13)
  engines: "",
  caches: { libs: "tiny-speech-libs-1", voice: "tiny-speech-tinyvoca-", voiceJs: "tiny-speech-tinyvoca-js-", packs: "tiny-speech" },
  voice: { dizione: "", es: "device" },
  // engine: "whisper" (Whisper tiny, the models below) or "ears" (the tiny ears, plan step B16: one 8.9 MB model for both languages and
  // the city's word list; ears.model = the model file on the site, ears.lexicon = packs/<city>/ears-lexicon.json). Whisper stays a choice.
  asr: { engine: "whisper", models: { en: "onnx-community/whisper-tiny.en" }, hintBudget: 220, ears: { model: "", lexicon: "" } },
  limits: { recMaxMs: 5000, endSilenceMs: 700, minSpeechMs: 250, leadMs: 250, tailMs: 300 },
  domains: [], langs: ["en"],
});
export const HINT_MAX = 220;  // Whisper reads at most 223 prompt tokens; three are its own markers

const merge = (base, over) => {
  const out = { ...base };
  for (const [k, v] of Object.entries(over || {})) out[k] = v && typeof v === "object" && !Array.isArray(v) && base[k] && typeof base[k] === "object" ? merge(base[k], v) : v;
  return out;
};

/** A site's config over the defaults, checked: the names a cache may have, limits that make sense, a budget Whisper can read. */
export function appConfig(raw = {}) {
  const c = merge(DEFAULTS, raw);
  const problems = [];
  for (const [k, v] of Object.entries(c.caches)) if (typeof v !== "string" || !/^[a-z0-9][a-z0-9-]*$/.test(v)) problems.push(`caches.${k} "${v}"`);
  for (const [k, v] of Object.entries(c.limits)) if (!(Number.isFinite(v) && v >= 0 && v <= 60000)) problems.push(`limits.${k} ${v}`);
  if (!(Number.isInteger(c.asr.hintBudget) && c.asr.hintBudget >= 0 && c.asr.hintBudget <= HINT_MAX)) problems.push(`asr.hintBudget ${c.asr.hintBudget} (0–${HINT_MAX})`);
  if (c.engines && !/^\/[^?#]*\/$/.test(c.engines)) problems.push(`engines "${c.engines}" (a folder on the site, like "/tiny-speech/engines/")`);
  if (!["whisper", "ears"].includes(c.asr.engine)) problems.push(`asr.engine "${c.asr.engine}" (whisper or ears)`);
  if (c.asr.engine === "ears" && !c.asr.ears.lexicon) problems.push("asr.ears.lexicon (the tiny ears need the city's word list)");
  if (problems.length) throw new Error(`app config ${c.app || "(none)"}: ${problems.join(", ")}`);
  return c;
}

/** The config for a host name from apps/index.json ({apps: [{app, config, hosts}]}), or null. */
export function appForHost(index, hostname) {
  return (index?.apps || []).find((a) => (a.hosts || []).some((h) => hostname === h || hostname.endsWith("." + h))) || null;
}

/**
 * A worker's address with the site's settings in it: which = "asr" | "voice" (ONNX + Pyodide) | "voiceJs" (plain JS).
 * base: the folder the workers are served from ("" = beside the page); v: the version, for the browser's cache.
 */
export function workerUrl(config, which, { base = "", v = "", dizione = null, model = null, sha256 = null } = {}) {
  const c = appConfig(config);
  const q = new URLSearchParams();
  if (v) q.set("v", v);
  if (which === "asr") {
    q.set("libs", c.caches.libs);
    if (c.engines) q.set("engines", c.engines);
    if (c.asr.ears.model) q.set("ears", c.asr.ears.model);
    if (c.asr.ears.lexicon) q.set("lexicon", c.asr.ears.lexicon);
    return `${base}asr-worker.js?${q}`;
  }
  if (which === "voice") {
    q.set("libs", c.caches.libs);
    q.set("voice", c.caches.voice);
    const zip = dizione ?? c.voice.dizione;
    if (zip) q.set("dizione", zip);
    if (c.engines) q.set("engines", c.engines);
    return `${base}tinyvoca-worker.js?${q}`;
  }
  if (which === "voiceJs") {
    // the plain-JS voice worker: its cache by ?cache=; a model other than the released one (the bilingual voice) with its SHA-256
    q.set("cache", c.caches.voiceJs);
    if (model) q.set("model", model);
    if (model && sha256) q.set("sha256", sha256);
    if (c.engines && !model) q.set("engines", c.engines);
    return `${base}tinyvoca-js-worker.js?${q}`;
  }
  throw new Error(`no worker called ${which}`);
}

/**
 * The speech-to-text model for a question in `lang`: "tiny-ears" when the site uses the tiny ears (both languages), else its Whisper
 * model for that language. engine: the reader's own choice in Settings ("whisper" | "ears"), over the site's.
 */
export function asrModel(config, lang = "en", engine = null) {
  const c = appConfig(config), use = engine || c.asr.engine;
  if (use === "ears" && c.asr.ears.lexicon) return "tiny-ears";
  return c.asr.models[lang] || c.asr.models.en;
}

/** listen.js's limits for this site: {REC_MAX_MS, END_SILENCE_MS, MIN_SPEECH_MS, LEAD_MS, TAIL_MS}. */
export function limitsOf(config) {
  const l = appConfig(config).limits;
  return { REC_MAX_MS: l.recMaxMs, END_SILENCE_MS: l.endSilenceMs, MIN_SPEECH_MS: l.minSpeechMs, LEAD_MS: l.leadMs, TAIL_MS: l.tailMs };
}
