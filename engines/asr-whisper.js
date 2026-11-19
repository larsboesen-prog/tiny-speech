// AsrEngine (plan step B9; review 2.3): speech to text behind one result shape, so the recognizer can be swapped (Whisper today,
// a smaller bilingual one later) without the page changing:
//   transcribe(audio, {lang, hint, hintNames}) -> {text, lang, langScores, alternatives, ms, waitMs, runMs, engine}
// text: what was heard, the name hint already cut off; lang: the language it was asked to hear ("en" for an English-only model,
// null when it was free to choose); langScores: {en, es} when the engine measures them (Whisper here does not: null, and the
// language decision then goes by the words, core/lang-decide.js); alternatives: other readings, best first ([] here).
// This one drives browser/asr-worker.js (transformers.js Whisper or Moonshine) with the site's config (core/config.js).
import { appConfig, workerUrl } from "../core/config.js";

export function createAsrEngine(config = {}, { base = "", v = "", Worker: W = globalThis.Worker } = {}) {
  const c = appConfig(config);
  let worker = null, req = 0;
  const waiting = new Map(), ready = new Map();  // reqId -> {resolve, reject}; model -> promise of its "ready"
  const listeners = new Set();
  function start() {
    if (worker) return worker;
    worker = new W(workerUrl(c, "asr", { base, v }), { type: "module" });
    worker.onmessage = ({ data }) => {
      for (const fn of listeners) fn(data);
      if (data.type === "text") {
        const w = waiting.get(data.reqId);
        waiting.delete(data.reqId);
        if (w) data.error ? w.reject(new Error(data.error)) : w.resolve(data);
      } else if (data.type === "ready") ready.get(data.id)?.resolve(data);
      else if (data.type === "error") ready.get(data.id)?.reject(new Error(data.message));
    };
    return worker;
  }
  const modelFor = (lang) => (lang && c.asr.models[lang]) || c.asr.models.en;
  const englishOnly = (model) => /\.en$/.test(model) || /moonshine/i.test(model);

  return {
    config: c,
    /** Start loading the model for a language (or a model id); resolves with the worker's "ready" message. */
    load(langOrModel = "en") {
      const model = c.asr.models[langOrModel] || langOrModel;
      if (!ready.has(model)) {
        let resolve, reject;
        const p = new Promise((a, b) => { resolve = a; reject = b; });
        ready.set(model, { promise: p, resolve, reject });
        start().postMessage({ type: "load", model });
      }
      return ready.get(model).promise;
    },
    /** 16 kHz mono Float32Array in (it is transferred: do not use it afterwards); the shape above out. */
    async transcribe(audio, { lang = null, model = null, hint = undefined, hintNames = undefined } = {}) {
      const id = model || modelFor(lang);
      const language = englishOnly(id) ? undefined : lang || undefined;
      const budget = c.asr.hintBudget;
      const names = budget > 0 && Array.isArray(hintNames) ? hintNames.map((x) => (typeof x === "string" ? x : x.name)) : undefined;
      const reqId = ++req, started = performance.now();
      const out = await new Promise((resolve, reject) => {
        waiting.set(reqId, { resolve, reject });
        start().postMessage({ type: "transcribe", reqId, model: id, language, hint: budget > 0 ? hint : undefined, hintNames: names, hintBudget: budget, audio }, [audio.buffer]);
      });
      return {
        text: out.text, lang: englishOnly(id) ? "en" : language || null, langScores: null, alternatives: [],
        ms: Math.round(performance.now() - started), waitMs: out.waitMs, runMs: out.runMs, engine: id,
      };
    },
    /** Every message the worker posts (progress, ready, warm, error, text): for a page's status line. */
    onMessage(fn) { listeners.add(fn); return () => listeners.delete(fn); },
    close() { worker?.terminate(); worker = null; },
  };
}
