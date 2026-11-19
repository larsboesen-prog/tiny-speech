// tiny-voca in plain JavaScript (plan step B10, D4): one 8 MB file, no onnxruntime, no Pyodide. Runs in a worker or in Node.
// English goes through tiny-voca's own phonemizer (dizione), with the city's Spanish names taught as overrides, as MapSMA does.
// Spanish goes through lang/es/sounds.js straight to the model's phones: whole sentences, not only names. Until the voice is
// trained on Spanish (step 5) it speaks Spanish with an American accent; which language it speaks is the page's choice (review 1.4).
// A bilingual file (tools/voice-gguf.mjs; its vocabulary in engines/bilingual.js) reads Spanish in Mexican Spanish's own sounds
// after an <es> token instead, and its own speaker MX1 is the default voice.
import { readGGUF, TinyVoca } from "../vendor/tiny-voca/js/tiny-voca.js";
import { fromGGUF } from "../vendor/tiny-voca/js/dizione/engine.js";
import { tokenize } from "../vendor/tiny-voca/js/dizione/symbols.js";
import { fromText } from "../vendor/tiny-voca/js/dizione/convert.js";
import { utterancesOf } from "../vendor/tiny-voca/js/text.js";
import { sentencePhones } from "../lang/es/sounds.js";
import { isBilingual, spanishTokens, englishTokens, VOWELS as BI_VOWELS, PAUSES as BI_PAUSES, SPEAKER } from "./bilingual.js";

export const MODEL = {
  revision: "1e73262226dbf4ef02e9df277e81aaa1db5ce16c",
  path: "gguf/tiny-voca-js.gguf",
  bytes: 7988384,
  sha256: "8436ad1c9b57c3533c925588a1b3563f906079a89c081ac0bec9f31ad6e28653",
};
export const MODEL_URL = `https://huggingface.co/n4ze3m/tiny-voca/resolve/${MODEL.revision}/${MODEL.path}`;

// Clean sound (MapSMA, 17 Nov 2026: "some statics or cracks in playback"): the level centred on zero, the peak at 0.7 so a phone
// resampling 24 kHz cannot clip between samples, and 8 ms raised-cosine fades so a sentence does not click as it starts and stops.
const PEAK = 0.7, EDGE_MS = 8;
export function limitPeak(samples, rate = 24000) {
  const n = samples.length;
  if (!n) return samples;
  let sum = 0;
  for (let i = 0; i < n; i++) sum += samples[i];
  const offset = sum / n;
  let loudest = 0;
  for (let i = 0; i < n; i++) { samples[i] -= offset; loudest = Math.max(loudest, Math.abs(samples[i])); }
  if (loudest > PEAK) for (let i = 0; i < n; i++) samples[i] *= PEAK / loudest;
  const edge = Math.min(Math.floor(n / 2), Math.round((rate * EDGE_MS) / 1000));
  for (let i = 0; i < edge; i++) { const g = 0.5 - 0.5 * Math.cos((Math.PI * i) / edge); samples[i] *= g; samples[n - 1 - i] *= g; }
  return samples;
}

// A Spanish text cut into sentences, each ending with a mark (so the last word is not cut off).
function spanishSentences(text) {
  const parts = String(text).replace(/\s+/g, " ").trim().split(/(?<=[.!?…])\s+/).filter((p) => /[\p{L}\p{N}]/u.test(p));
  return parts.map((p) => (/[.!?…,;:]["'”’)\]»]*$/.test(p) ? p : p + "."));
}

/**
 * The voice, from the GGUF file's bytes. {voices, sampleRate, teach, phones, utterances, synthesize, speak}.
 * `spanish`: {english, readings, names} from the city pack (which words inside names stay English; hand-written readings).
 */
export async function createVoice(buffer, { spanish = {} } = {}) {
  const file = readGGUF(buffer);
  const voca = new TinyVoca(file);
  const phonemizer = await fromGGUF(file);
  // The bilingual voice (training/RECIPE.md): Mexican Spanish in its own sounds and the <es> token; the runtime's vowel and pause
  // lists know only English's, so they are set here from the vocabulary (no change to the vendored file).
  const vocab = JSON.parse(new TextDecoder().decode(file.files["config.json"])).vocab;
  const bilingual = isBilingual(vocab);
  if (bilingual) {
    voca.isVowel = voca.symbols.map((s) => BI_VOWELS.has(s));
    voca.isPause = voca.symbols.map((s) => BI_PAUSES.has(s));
  }
  const limit = voca.config.max_tokens - 12;
  let city = { english: [], readings: {}, names: [], ...spanish };

  /** MapSMA's Spanish names, as {word: "phones"}: each becomes an override of the English phonemizer. Returns how many took. */
  function teach(words) {
    let taught = 0;
    for (const [word, phones] of Object.entries(words || {})) {
      try { phonemizer.addOverrides({ [word]: phones }); taught++; } catch { /* a word it refuses is skipped, as on MapSMA */ }
    }
    return taught;
  }

  /** How a text will be said, as phones (for testing and the check page). */
  function phones(text, lang = "en") {
    return utterances(text, lang).map((u) => u.phonemes).join(" | ");
  }

  // An English word inside a Spanish sentence (a place's name), in the English phonemizer's phones.
  const englishWord = (word) => { const t = englishTokens(phonemizer, word); return t.symbols.map((s, i) => [s, t.stress[i]]).filter(([s]) => !/^<|^[.,;:!?…—"'()]$/.test(s)); };

  // One Spanish sentence → {ids, stress, phonemes}, or several if it is longer than the model takes.
  function spanishUtterance(sentence) {
    if (bilingual) {
      const r = spanishTokens(sentence, { english: englishWord, city });
      if (r.ids.length <= limit) return [{ ids: r.ids, stress: r.stress, phonemes: r.symbols.map((s, i) => (r.stress[i] ? "ˈ" : "") + s).slice(1, -1).join(" ") }];
      const halves = sentence.split(/(?<=[,;:—])\s+/);
      if (halves.length > 1) return halves.flatMap((h) => spanishUtterance(/[.!?…,;:]$/.test(h) ? h : h + ","));
      const w = sentence.split(" "), k = Math.ceil(w.length / 2);
      return w.length < 2 ? [] : [...spanishUtterance(w.slice(0, k).join(" ") + ","), ...spanishUtterance(w.slice(k).join(" "))];
    }
    const { pieces } = sentencePhones(sentence, city);
    const out = [];  // dizione's pieces: [true, mark] or [false, [word phones, ...]]
    let words = [];
    const flush = () => { if (words.length) out.push([false, words]); words = []; };
    for (const p of pieces) {
      if (p.mark) { flush(); out.push([true, p.mark === "…" ? "…" : p.mark]); continue; }
      if (p.lang === "en") {  // an English word inside a name: the English phonemizer's phones for it
        for (const [mark, value] of phonemizer.pieces(p.word)) if (!mark) for (const group of value) words.push(...(Array.isArray(group[0]?.[0]) ? group : [group]));
        continue;
      }
      if (p.phones) words.push(fromText(p.phones));
    }
    flush();
    const result = tokenize(out);
    if (result.ids.length <= limit) {
      const phonemes = result.symbols.map((s, i) => ["", "ˈ", "ˌ"][result.stress[i]] + s).slice(1, -1).join(" ");
      return [{ ids: result.ids, stress: result.stress, phonemes }];
    }
    const halves = sentence.split(/(?<=[,;:—])\s+/);
    if (halves.length > 1) return halves.flatMap((h) => spanishUtterance(/[.!?…,;:]$/.test(h) ? h : h + ","));
    const w = sentence.split(" "), k = Math.ceil(w.length / 2);
    return w.length < 2 ? [] : [...spanishUtterance(w.slice(0, k).join(" ") + ","), ...spanishUtterance(w.slice(k).join(" "))];
  }

  /** A text → the pieces the model reads, one per sentence (or part of one). */
  function utterances(text, lang = "en") {
    if (lang === "es") return spanishSentences(text).flatMap(spanishUtterance);
    return utterancesOf(text, phonemizer, limit);
  }

  /** One utterance → its audio (Float32Array at sampleRate), clean for playing. pitch: -0.6 … 0.3 (M2: -0.3 ≈ 140 Hz). */
  function synthesize(u, { voice = bilingual ? SPEAKER : "M2", speed = 1, pitch = 0, seed = 0 } = {}) {
    const { audio } = voca.synthesize(u.ids, u.stress, { voice, speed, pitchShift: Math.max(-0.6, Math.min(0.3, Number(pitch) || 0)), seed });
    return limitPeak(Float32Array.from(audio), voca.config.sample_rate);
  }

  return {
    voices: voca.voices, sampleRate: voca.config.sample_rate, limit, bilingual,
    setCity: (s) => { city = { english: [], readings: {}, names: [], ...s }; },
    teach, phones, utterances, synthesize,
    /** A whole text → [{audio, phonemes}], one per utterance. */
    speak: (text, options = {}) => utterances(text, options.lang).map((u, seed) => ({ audio: synthesize(u, { ...options, seed }), phonemes: u.phonemes })),
  };
}
