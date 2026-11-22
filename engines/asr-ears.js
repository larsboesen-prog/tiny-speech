// The tiny ears (plan step B16): speech to text in 8.9 MB. A small sound recognizer (training/ears/: a 7.5M-parameter Conformer taught by
// wav2vec2 espeak and by transcripts) says which of 392 sounds it hears every 20 ms; the matcher (ears-match.js) finds the words of the
// city's word list (packs/dist/<city>/ears-lexicon.json) that fit them best. English and Spanish in one model, no hint needed: the
// city's names are in the word list. Measured (20 Nov 2026, synthetic Mexican requests): 80.6% understood as said on held-out clips,
// 85.4% on voices it never heard; Whisper tiny 29% and 52%. Whisper tiny stays the other choice (asr-whisper.js).
//
// Runs where onnxruntime runs (a worker with onnxruntime-web, or Node with onnxruntime-node): the caller passes `ort` in.
import { buildLexicon, decode } from "./ears-match.js";
import { buildNameSpotter } from "./ears-spot.js?v=20261122l";  // versioned: a phone that kept update 5's file gets this one

export const EARS_ID = "tiny-ears";
export const isEars = (id) => String(id || "").startsWith(EARS_ID);
const RATE = 16000, MIN_SAMPLES = 1600;  // a tenth of a second: less is no question
export const framesOf = (samples) => Math.floor((samples - 400) / 320) + 1;  // the teacher's frames (20 ms, 25 ms window)

/**
 * ort: an onnxruntime module ({InferenceSession, Tensor}); model: the ONNX file's bytes (ears-int8.onnx); vocab: {sound: id}
 * (engines/ears/vocab.json); lexicon: the city's word list (parsed JSON). settings: the matcher's (ears-match.js decode).
 * names: the city's places ({names: [{id, name, alts}]}, packs/dist/<city>/ears-names.json), to look for by sound (ears-spot.js):
 * hear() then also returns `spot`, the five names that fit the sounds best, for when the words missed the name (owner, 22 Nov 2026).
 */
export async function createEars({ ort, model, vocab, lexicon, names = null, settings = {}, sessionOptions = {} }) {
  const session = await ort.InferenceSession.create(model, { executionProviders: ["wasm"], ...sessionOptions });
  const lex = buildLexicon(lexicon, vocab);
  const blank = vocab["<pad>"], V = Object.keys(vocab).length;
  const input = session.inputNames[0], output = session.outputNames[0];
  const spotter = names && (names.names || names).length ? buildNameSpotter(names.names || names, lexicon, vocab) : null;
  const recent = new Map();  // the last few questions' sounds, to learn a name from when the visitor picks it (learnFrom)
  let heardSeq = 0;
  return {
    id: EARS_ID,
    words: lex.words,
    /** audio: 16 kHz mono Float32Array → {text, frames, runMs (the model), matchMs (the word list), spot?: [{id, name, perSound}]} */
    async hear(audio) {
      if (!audio || audio.length < MIN_SAMPLES) return { text: "", frames: 0, runMs: 0, matchMs: 0, ...(spotter ? { spot: [] } : {}) };
      let peak = 0;
      for (let i = 0; i < audio.length; i++) { const a = Math.abs(audio[i]); if (a > peak) peak = a; }
      const wave = new Float32Array(audio.length), g = 0.9 / (peak || 1);  // as the probe and the training checks hear it
      for (let i = 0; i < audio.length; i++) wave[i] = Math.fround(audio[i] * g);
      const t0 = performance.now();
      const out = await session.run({ [input]: new ort.Tensor("float32", wave, [1, wave.length]) });
      const lp = out[output], frames = lp.dims[1], width = lp.dims[2];
      if (width !== V) throw new Error(`the model gives ${width} sounds, the vocabulary has ${V}`);
      const t1 = performance.now();
      const text = decode(lp.data, frames, V, lex, blank, settings);
      const t2 = performance.now();
      const spot = spotter ? spotter.spot(lp.data, frames, V, blank, 5).map((x) => ({ id: x.id, name: x.name, perSound: Math.round(x.perSound * 1000) / 1000 })) : null;
      let heardId = 0;
      if (spotter) { heardId = ++heardSeq; recent.set(heardId, { lp: lp.data, frames }); if (recent.size > 8) recent.delete(recent.keys().next().value); }
      return { text, frames, runMs: Math.round(t1 - t0), matchMs: Math.round(t2 - t1), ...(spot ? { spot, spotMs: Math.round(performance.now() - t2), heardId } : {}) };
    },
    /** The visitor picked place `id` for question `heardId` (hear()'s, or "last"): remember how that name sounded (ears-spot.js learn). Returns
     * the sounds learned, to keep on the device and give back with addReadings next visit, or null. */
    learnFrom(heardId, id) {
      const h = heardId === "last" ? [...recent.values()].pop() : recent.get(heardId);
      if (!h || !spotter || !spotter.heardAs) return null;
      const phones = spotter.heardAs(h.lp, h.frames, V, blank, id);
      return spotter.learn(id, phones) ? phones : null;
    },
    /** Readings learned before ([{id, phones}]); returns how many were usable. */
    addReadings: (list) => (spotter ? (list || []).filter((r) => r && spotter.learn(r.id, r.phones)).length : 0),
    forget: () => { spotter?.forget(); recent.clear(); },
    dispose: async () => { try { await session.release(); } catch { /* already gone */ } },
  };
}
