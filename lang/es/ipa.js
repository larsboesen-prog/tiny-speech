// Mexican Spanish in its own sounds (IPA), for training the bilingual voice (plan step 5), not for today's English-only model
// (that is sounds.js). Rules for central Mexico (mx.json): seseo (c, z → s), yeísmo (ll, y → ʝ), j and g before e/i → x, the
// trill r at a word's start and after l, n, s, the tap ɾ elsewhere; b, d, g soften to β, ð, ɣ after a vowel or a continuant;
// n before k, g, x → ŋ; unstressed i and u next to a vowel are glides (j, w). A word whose sound rules cannot know (Nahuatl x as
// s or ʃ) takes its reading from the city pack.
import { numberWordsEs } from "./sounds.js";

export const VOWELS = ["a", "e", "i", "o", "u"];
export const CONSONANTS = ["p", "b", "β", "t", "d", "ð", "k", "ɡ", "ɣ", "f", "s", "x", "ʃ", "tʃ", "ʝ", "m", "n", "ɲ", "ŋ", "l", "ɾ", "r", "j", "w"];
export const INVENTORY = [...VOWELS, ...CONSONANTS];

const fold = (s) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
const isV = (c) => /[aeiouáéíóúü]/.test(c);
const STRONG = /[aeoáéíóú]/;
const UNSTRESSED = new Set("a al con de del el en la las lo los me mi mis nos o para por que se su sus te tu tus un una unos unas y e u ni sin".split(" "));
const MEXICO_X = /^(mexic|mexiq|oaxac|xalap|texas|xavier|ximena|xalisco)/;
// Well-known Mexican words whose x (or tz, tl) rules cannot read; a city's own names come from its pack's readings.
const KNOWN = {
  xochimilco: "s o tʃ i m ˈi l k o", xochitl: "s ˈo tʃ i t l", mixiote: "m i ʃ ˈo t e", mixiotes: "m i ʃ ˈo t e s",
  xola: "ʃ ˈo l a", xcaret: "ʃ k a ɾ ˈe t", xoconostle: "s o k o n ˈo s t l e", ixtapa: "i s t ˈa p a",
  cuauhtemoc: "k w a w t ˈe m o k", tepoztlan: "t e p o s t l ˈa n", xocolatl: "ʃ o k ˈo l a t l",
};

/** One Spanish word → IPA phones (array), the stressed vowel marked "ˈ". `readings`: {word: "phones"} from the pack. */
export function ipaWord(word, { readings = {} } = {}) {
  const w = String(word).toLowerCase().replace(/[^a-záéíóúüñ]/g, "");
  if (!w) return [];
  if (readings[fold(w)]?.ipa) return readings[fold(w)].ipa.split(" ");
  if (KNOWN[fold(w)]) return KNOWN[fold(w)].split(" ");
  const u = [];  // {c} consonant sound, or {v, acc}
  for (let i = 0; i < w.length; i++) {
    const c = w[i], n = w[i + 1] || "", n2 = w[i + 2] || "";
    if (c === "c" && n === "h") { u.push({ c: "tʃ" }); i++; continue; }
    if (c === "l" && n === "l") { u.push({ c: "ʝ" }); i++; continue; }
    if (c === "r" && n === "r") { u.push({ c: "r" }); i++; continue; }
    if (c === "q" && n === "u") { u.push({ c: "k" }); i++; continue; }
    if (c === "g" && n === "u" && /[eéií]/.test(n2)) { u.push({ c: "ɡ" }); i++; continue; }
    if (c === "g" && n === "ü") { u.push({ c: "ɡ" }, { c: "w" }); i++; continue; }
    if (c === "h") { if (n === "i" && isV(n2)) { u.push({ c: "ʝ" }); i++; } else if (n === "u" && isV(n2)) { u.push({ c: "w" }); i++; } continue; }
    if (isV(c)) { u.push({ v: fold(c), acc: /[áéíóú]/.test(c) }); continue; }
    if (c === "y") { u.push(isV(n) ? { c: "ʝ" } : { v: "i", y: true }); continue; }
    if (c === "ñ") { u.push({ c: "ɲ" }); continue; }
    if (c === "c") { u.push({ c: /[eéiíy]/.test(n) ? "s" : "k" }); continue; }
    if (c === "g") { u.push({ c: /[eéiíy]/.test(n) ? "x" : "ɡ" }); continue; }
    if (c === "j") { u.push({ c: "x" }); continue; }
    // x: as j in México's family and at a word's start; before a consonant (Tlaxcala, Texcoco, Ixmiquilpan) as s; else ks
    if (c === "x") { u.push(...(MEXICO_X.test(fold(w)) || i === 0 ? [{ c: "x" }] : n && !isV(n) ? [{ c: "s" }] : [{ c: "k" }, { c: "s" }])); continue; }
    if (c === "z" || c === "s") { u.push({ c: "s" }); continue; }
    if (c === "v" || c === "b") { u.push({ c: "b" }); continue; }
    if (c === "r") { const prev = u[u.length - 1]; u.push({ c: !prev || /^[lns]$/.test(prev.c || "") ? "r" : "ɾ" }); continue; }
    if ("dfklmnptw".includes(c)) { u.push({ c }); continue; }
  }
  // vowels → nuclei; an unaccented i/u beside another vowel is a glide
  const out = [];
  for (let k = 0; k < u.length;) {
    if (u[k].c) { out.push(u[k]); k++; continue; }
    const run = [];
    while (k < u.length && u[k].v) run.push(u[k++]);
    const weak = (x) => x && !STRONG.test(x.acc ? "á" : x.v);
    for (let j = 0; j < run.length;) {
      const a = run[j], b = run[j + 1];
      if (b && weak(a) && !weak(b)) { out.push({ c: a.v === "u" ? "w" : "j" }, { v: b.v, acc: b.acc, nucleus: true }); j += 2; }
      else if (b && !weak(a) && weak(b)) { out.push({ v: a.v, acc: a.acc, nucleus: true }, { c: b.v === "u" ? "w" : "j" }); j += 2; }
      else if (b && weak(a) && weak(b)) { out.push({ c: a.v === "u" ? "w" : "j" }, { v: b.v, acc: b.acc, nucleus: true }); j += 2; }
      else { out.push({ v: a.v, acc: a.acc, nucleus: true }); j++; }
    }
  }
  const nuclei = out.map((x, k) => (x.nucleus ? k : -1)).filter((k) => k >= 0);
  let stressed = nuclei.find((k) => out[k].acc);
  if (stressed == null && nuclei.length) stressed = /[aeiouns]$/.test(fold(w)) && !/y$/.test(w) && nuclei.length > 1 ? nuclei[nuclei.length - 2] : nuclei[nuclei.length - 1];
  if (UNSTRESSED.has(fold(w))) stressed = -1;
  const phones = [];
  out.forEach((x, k) => {
    if (x.nucleus) { phones.push((k === stressed && nuclei.length > 0 ? "ˈ" : "") + x.v); return; }
    const prev = out[k - 1], next = out[k + 1];
    let p = x.c;
    const afterVowelish = prev && (prev.nucleus || /^[jwɾrsfx]$/.test(prev.c || "") || (p !== "d" && prev.c === "l"));
    if (p === "b" && afterVowelish) p = "β";
    if (p === "d" && afterVowelish) p = "ð";
    if (p === "ɡ" && afterVowelish) p = "ɣ";
    if (p === "n" && next && /^[kɡx]$/.test(next.c || "")) p = "ŋ";
    phones.push(p);
  });
  return phones.filter((p, k) => !(p === phones[k - 1] && !VOWELS.includes(p.replace("ˈ", ""))));  // a doubled consonant once
}

/** A sentence → [[phones of each word]], numbers said as words. */
export function ipaSentence(text, options = {}) {
  const words = String(text).replace(/(\d+)[.,](\d+)/g, "$1 punto $2").match(/[\p{L}\p{N}]+/gu) || [];
  return words.flatMap((w) => (/^\d+$/.test(w) ? numberWordsEs(+w).split(" ") : [w])).map((w) => ipaWord(w, options)).filter((p) => p.length);
}
