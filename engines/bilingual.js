// The bilingual tiny-voca voice's vocabulary (training/RECIPE.md section 2): the released model's 76 symbols unchanged, then
// Mexican Spanish's own sounds and a language token, appended so every English id stays where it was. One table for the page
// (engines/tinyvoca-js.js), the training data (tools/voice-data.mjs), the GGUF tools (tools/voice-gguf.mjs) and the GPU
// pipeline (training/gpu/, which reads training/data/symbols.json written from this file).
import { SYMBOLS as ENGLISH_SYMBOLS, PAD, BOS, EOS, SP, UNK } from "../vendor/tiny-voca/js/dizione/symbols.js";
import { ipaWord } from "../lang/es/ipa.js";
import { numberWordsEs } from "../lang/es/sounds.js";

export const SPANISH_VOWELS = ["a", "e", "o", "u"];
export const SPANISH_CONSONANTS = ["β", "ɣ", "x", "ʝ", "ɲ", "r"];
export const LANG_ES = "<es>";
export const SYMBOLS = [...ENGLISH_SYMBOLS, ...SPANISH_VOWELS, ...SPANISH_CONSONANTS, LANG_ES];  // 87
export const ID = new Map(SYMBOLS.map((s, i) => [s, i]));
export const SPEAKER = "MX1";

// Each new row of the token table starts as the mean of these released rows (the nearest English sounds), so training begins
// from a voice that already says something close; <es> starts as <bos>, which it follows.
export const INIT = {
  a: ["ɑː"], e: ["eɪ", "ɛ"], o: ["oʊ", "ɔ"], u: ["uː"],
  "β": ["b", "v"], "ɣ": ["ɡ"], x: ["h"], "ʝ": ["j"], "ɲ": ["n", "j"], r: ["ɾ"],
  [LANG_ES]: [BOS],
};

// All phones (things the model must sound), vowels (voiced; carry stress) and pauses (may take no time), for the runtime.
const ENGLISH_PHONES = ENGLISH_SYMBOLS.slice(17);
export const PHONES = new Set([...ENGLISH_PHONES, ...SPANISH_VOWELS, ...SPANISH_CONSONANTS]);
export const VOWELS = new Set([...ENGLISH_SYMBOLS.slice(43), ...SPANISH_VOWELS]);
export const PAUSES = new Set([PAD, BOS, EOS, SP, ",", ".", "?", "!", ";", ":", '"', "'", "(", ")", "—", "…", LANG_ES]);

const MARK = /^[.,;:!?…—]$/;
/**
 * A Spanish sentence → the model's tokens: <bos> <es> words (each in Mexican Spanish sounds, lang/es/ipa.js), <sp> between
 * words, punctuation as tokens, <eos>; the stressed vowel gets stress 1. `english(word)` gives an English word's phones as
 * [[phone, stress]] (for the English words inside a place's name); `city`: {english, readings, names} from the pack.
 * Same rules as tiny-voca's tokenize (dizione/symbols.js): a repeated mark once, <sp> only after a phone.
 */
export function spanishTokens(sentence, { english = null, city = {} } = {}) {
  const ENGLISH = new Set((city.english || []).map((w) => w.toLowerCase()));
  const inName = namesIn(sentence, city.names || []);
  const words = String(sentence).replace(/[¿¡"“”«»()]/g, " ").replace(/&/g, " y ").replace(/(\d+)[.,](\d+)/g, "$1 punto $2")
    .match(/[\p{L}\p{N}']+|[.,;:!?…—]/gu) || [];
  const symbols = [BOS, LANG_ES], stress = [0, 0], unknown = [];
  const push = (s, l) => { symbols.push(s); stress.push(l); };
  let w = 0;
  words.forEach((token, i) => {
    if (MARK.test(token)) { if (symbols.at(-1) !== token) push(token, 0); return; }
    const said = /^\d+$/.test(token) ? numberWordsEs(+token, { fem: /^las?$/i.test(words[i - 1] || "") }).split(" ") : [token];
    for (const word of said) {
      const phones = inName.has(w) && ENGLISH.has(word.toLowerCase().replace(/'/g, "")) && english ? english(word)
        : ipaWord(word, { readings: city.readings || {} }).map((p) => [p.replace("ˈ", ""), p.startsWith("ˈ") ? 1 : 0]);
      if (!phones.length) continue;
      if (PHONES.has(symbols.at(-1)) || symbols.at(-1) === UNK) push(SP, 0);
      for (const [p, l] of phones) { if (ID.has(p)) push(p, l); else { unknown.push(p); push(UNK, 0); } }
    }
    w++;
  });
  push(EOS, 0);
  if (!symbols.some((s) => PHONES.has(s))) throw new Error("the text has nothing to pronounce");
  return { symbols, ids: symbols.map((s) => ID.get(s)), stress, unknown };
}

// Which word positions (counting words, not marks) belong to a place's name in this sentence.
function namesIn(sentence, names) {
  const key = (s) => s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/'/g, "");
  const seq = (String(sentence).match(/[\p{L}\p{N}']+/gu) || []).map(key);
  const out = new Set();
  for (const name of names) {
    const nw = (String(name).match(/[\p{L}\p{N}']+/gu) || []).map(key);
    if (!nw.length) continue;
    for (let i = 0; i + nw.length <= seq.length; i++) if (nw.every((x, k) => seq[i + k] === x)) for (let k = 0; k < nw.length; k++) out.add(i + k);
  }
  return out;
}

/** An English text's tokens from tiny-voca's own phonemizer (dizione): the released model's ids, which the bilingual one keeps. */
export function englishTokens(phonemizer, text) {
  const r = phonemizer.phonemize(text);
  return { symbols: r.symbols, ids: r.symbols.map((s) => ID.get(s)), stress: r.stress, unknown: r.unknown || [] };
}

/** True when a model's vocabulary is this one (a GGUF's config.json vocab). */
export const isBilingual = (vocab) => vocab && vocab[LANG_ES] === ID.get(LANG_ES) && Object.keys(vocab).length === SYMBOLS.length;
