// The tiny ears (plan step B16): speech to text in 8.9 MB. A small sound recognizer (training/ears/: a 7.5M-parameter Conformer taught by
// wav2vec2 espeak and by transcripts) says which of 392 sounds it hears every 20 ms; the matcher (ears-match.js) finds the words of the
// city's word list (packs/dist/<city>/ears-lexicon.json) that fit them best. English and Spanish in one model, no hint needed: the
// city's names are in the word list. Measured (20 Nov 2026, synthetic Mexican requests): 80.6% understood as said on held-out clips,
// 85.4% on voices it never heard; Whisper tiny 29% and 52%. Whisper tiny stays the other choice (asr-whisper.js).
//
// Runs where onnxruntime runs (a worker with onnxruntime-web, or Node with onnxruntime-node): the caller passes `ort` in.
import { buildLexicon, decode } from "./ears-match.js";

export const EARS_ID = "tiny-ears";
export const isEars = (id) => String(id || "").startsWith(EARS_ID);
const RATE = 16000, MIN_SAMPLES = 1600;  // a tenth of a second: less is no question
export const framesOf = (samples) => Math.floor((samples - 400) / 320) + 1;  // the teacher's frames (20 ms, 25 ms window)

/**
 * ort: an onnxruntime module ({InferenceSession, Tensor}); model: the ONNX file's bytes (ears-int8.onnx); vocab: {sound: id}
 * (engines/ears/vocab.json); lexicon: the city's word list (parsed JSON). settings: the matcher's (ears-match.js decode).
 */
export async function createEars({ ort, model, vocab, lexicon, settings = {}, sessionOptions = {} }) {
  const session = await ort.InferenceSession.create(model, { executionProviders: ["wasm"], ...sessionOptions });
  const lex = buildLexicon(lexicon, vocab);
  const blank = vocab["<pad>"], V = Object.keys(vocab).length;
  const input = session.inputNames[0], output = session.outputNames[0];
  return {
    id: EARS_ID,
    words: lex.words,
    /** audio: 16 kHz mono Float32Array → {text, frames, runMs (the model), matchMs (the word list)} */
    async hear(audio) {
      if (!audio || audio.length < MIN_SAMPLES) return { text: "", frames: 0, runMs: 0, matchMs: 0 };
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
      return { text, frames, runMs: Math.round(t1 - t0), matchMs: Math.round(performance.now() - t1) };
    },
    dispose: async () => { try { await session.release(); } catch { /* already gone */ } },
  };
}
