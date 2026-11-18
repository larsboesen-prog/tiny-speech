// Text helpers shared by language ID, the command interpreter and the TTS front end.
// Pure functions, no dependencies: they run in the browser, in a worker and in Node.

const MARKS = /[̀-ͯ]/g;

/** Lower-case and strip accents, but keep ñ distinct from n ("año" is not "ano"). */
export function fold(text) {
  return String(text ?? "")
    .toLowerCase()
    .replace(/ñ/g, "\u0001")
    .normalize("NFD")
    .replace(MARKS, "")
    .replace(/\u0001/g, "ñ");
}

const CONTRACTIONS = [
  [/\b(what|where|that|it|there|who|how|here|when)['’]s\b/g, "$1 is"],
  [/\bcan['’]t\b/g, "can not"],
  [/\bwon['’]t\b/g, "will not"],
  [/\b(\w+)n['’]t\b/g, "$1 not"],
  [/\b(\w+)['’]re\b/g, "$1 are"],
  [/\b(\w+)['’]ll\b/g, "$1 will"],
  [/\b(\w+)['’]ve\b/g, "$1 have"],
  [/\bi['’]m\b/g, "i am"],
  [/\bi['’]d\b/g, "i would"],
  [/\bo['’]clock\b/g, "oclock"],
  [/['’]s\b/g, ""],
];

/** Fold, expand English contractions, unify a.m./p.m., drop ¿¡ and most punctuation. */
export function normalize(text) {
  let s = fold(text);
  for (const [pattern, replacement] of CONTRACTIONS) s = s.replace(pattern, replacement);
  s = s
    .replace(/\b([ap])\.\s?m\.?/g, "$1m")
    .replace(/(\d)\s?([ap])m\b/g, "$1 $2m")
    .replace(/[¿¡"“”«»()[\]{}]/g, " ")
    .replace(/(\d)[.,](\d{3})\b/g, "$1$2")
    .replace(/[-–—_/]/g, " ")
    .replace(/[?!.,;]+(\s|$)/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return s;
}

/** Tokens: words, numbers, clock times such as 9:30, and runs of $ for price. */
export function tokenize(text) {
  return normalize(text).match(/\d{1,2}:\d{2}|\$+|[\p{L}\p{N}]+/gu) ?? [];
}

// ---------------------------------------------------------------------------
// Number words, parsed in place from a token list (used for clock times).

const EN_UNITS = {
  zero: 0, oh: 0, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9,
  ten: 10, eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16,
  seventeen: 17, eighteen: 18, nineteen: 19,
};
const EN_TENS = { twenty: 20, thirty: 30, forty: 40, fifty: 50 };

const ES_UNITS = {
  cero: 0, un: 1, uno: 1, una: 1, dos: 2, tres: 3, cuatro: 4, cinco: 5, seis: 6, siete: 7, ocho: 8,
  nueve: 9, diez: 10, once: 11, doce: 12, trece: 13, catorce: 14, quince: 15, dieciseis: 16,
  diecisiete: 17, dieciocho: 18, diecinueve: 19, veinte: 20, veintiun: 21, veintiuno: 21, veintiuna: 21,
  veintidos: 22, veintitres: 23, veinticuatro: 24, veinticinco: 25, veintiseis: 26, veintisiete: 27,
  veintiocho: 28, veintinueve: 29,
};
const ES_TENS = { treinta: 30, cuarenta: 40, cincuenta: 50 };

/**
 * Read a number (digits or words) starting at tokens[i].
 * Returns { value, length } or null. Handles "twenty five", "treinta y dos", "veintitrés".
 */
export function readNumber(tokens, i, lang) {
  const t = tokens[i];
  if (t === undefined) return null;
  if (/^\d+$/.test(t)) return { value: Number(t), length: 1 };
  if (lang !== "es") {
    if (t in EN_UNITS && t !== "oh") return { value: EN_UNITS[t], length: 1 };
    if (t in EN_TENS) {
      const next = tokens[i + 1];
      if (next in EN_UNITS && EN_UNITS[next] > 0 && EN_UNITS[next] < 10) return { value: EN_TENS[t] + EN_UNITS[next], length: 2 };
      return { value: EN_TENS[t], length: 1 };
    }
  }
  if (lang !== "en") {
    if (t in ES_UNITS) return { value: ES_UNITS[t], length: 1 };
    if (t in ES_TENS) {
      const next = tokens[i + 2];
      if (tokens[i + 1] === "y" && next in ES_UNITS && ES_UNITS[next] > 0 && ES_UNITS[next] < 10) {
        return { value: ES_TENS[t] + ES_UNITS[next], length: 3 };
      }
      return { value: ES_TENS[t], length: 1 };
    }
  }
  return null;
}

/** Find a phrase (array of folded tokens) in tokens; returns start index or -1. */
export function findPhrase(tokens, phrase, from = 0) {
  outer: for (let i = from; i <= tokens.length - phrase.length; i++) {
    for (let k = 0; k < phrase.length; k++) if (tokens[i + k] !== phrase[k]) continue outer;
    return i;
  }
  return -1;
}

/** Build a longest-match phrase table: Map(firstToken -> [{tokens, value}] sorted longest first). */
export function phraseTable(entries) {
  const table = new Map();
  for (const { phrase, value } of entries) {
    const tokens = tokenize(phrase);
    if (!tokens.length) continue;
    const list = table.get(tokens[0]) ?? [];
    list.push({ tokens, value });
    table.set(tokens[0], list);
  }
  for (const list of table.values()) list.sort((a, b) => b.tokens.length - a.tokens.length);
  return table;
}

/** Match all phrases of a table in tokens, longest first, without overlaps. */
export function matchPhrases(tokens, table, used = new Set()) {
  const found = [];
  for (let i = 0; i < tokens.length; i++) {
    if (used.has(i)) continue;
    const candidates = table.get(tokens[i]);
    if (!candidates) continue;
    for (const { tokens: phrase, value } of candidates) {
      let ok = true;
      for (let k = 0; k < phrase.length; k++) {
        if (tokens[i + k] !== phrase[k] || used.has(i + k)) { ok = false; break; }
      }
      if (ok) {
        found.push({ start: i, end: i + phrase.length, value });
        for (let k = 0; k < phrase.length; k++) used.add(i + k);
        i += phrase.length - 1;
        break;
      }
    }
  }
  return found;
}
