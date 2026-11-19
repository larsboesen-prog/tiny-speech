// Which language a question is in (decision D2, review 1.5): a two-way choice between English and Spanish, not 99-way.
// Evidence, in this order of weight:
//   1. the recognizer's own scores for <|en|> and <|es|> (Whisper's first decoder step), when it gives them;
//   2. the words, with the city's names masked out first: "Is La Azotea open?" is English, though "la" is a Spanish word;
//   3. a small prior: the last question's language, then the page's.
// A manual EN/ES choice overrides everything. The reader is language-blind (it reads both at once), so a wrong guess costs the
// answer's language and recognition quality, not understanding; a low-margin disagreement asks for one re-run in the other language.
import { detectTextLanguage } from "./lid/text-lid.js";
import { fold } from "./text/sound.js";

export const WEIGHTS = { asr: 3, text: 1, prior: 0.35 };
export const RERUN_BELOW = 0.6;   // margin under which recognizer and words disagreeing triggers a re-run in the other language

/** Every name a city's question can contain (places, their other names, areas, curated lists), folded, longest first. */
export function namesOf(pack) {
  const out = new Set();
  for (const p of pack?.places || []) {
    out.add(fold(p.name));
    for (const n of p.names || []) out.add(fold(n.t));
    if (p.sentence) for (const v of Object.values(p.sentence)) out.add(fold(v).replace(/^(the|el|la|los|las) /, ""));
  }
  for (const a of pack?.areas || []) if (a.role !== "centre") for (const w of a.words || []) out.add(fold(w));
  for (const c of pack?.collections || []) for (const t of Object.values(c.text || {})) if (t.who) out.add(fold(t.who));
  return [...out].filter((n) => n.length > 2).sort((a, b) => b.length - a.length);
}

/** The question with the city's names taken out. */
export function maskNames(text, names) {
  let s = " " + fold(text).replace(/[^a-z0-9ñ ]+/g, " ").replace(/\s+/g, " ").trim() + " ";
  for (const n of names) if (s.includes(" " + n + " ")) s = s.split(" " + n + " ").join("   ");
  return s.replace(/\s+/g, " ").trim();
}

/**
 * {lang: "en" | "es", margin, why, rerun} from:
 *   langScores {en, es} (probabilities from the recognizer, optional), text (what it wrote), names (namesOf(pack), optional),
 *   prior ("en" | "es", optional: the last question's language, else the page's), override ("en" | "es", optional).
 * margin > 0 is how sure (comparable across calls); rerun says: transcribe once more in the other language before answering.
 */
export function decideLanguage({ langScores = null, text = "", names = [], prior = null, override = null } = {}) {
  if (override === "en" || override === "es") return { lang: override, margin: Infinity, why: "chosen", rerun: false };
  let score = 0;  // > 0: Spanish
  const why = [];
  let asrSays = null;
  if (langScores && Number.isFinite(langScores.en) && Number.isFinite(langScores.es) && langScores.en + langScores.es > 0) {
    const p = langScores.es / (langScores.en + langScores.es);  // the two-way share
    score += WEIGHTS.asr * (p - 0.5) * 2;
    asrSays = p >= 0.5 ? "es" : "en";
    why.push(`recognizer ${asrSays} ${Math.round(Math.max(p, 1 - p) * 100)}%`);
  }
  const masked = maskNames(text, names);
  const t = detectTextLanguage(masked);
  let textSays = null;
  if (t.lang) {
    textSays = t.lang;
    score += WEIGHTS.text * (t.lang === "es" ? 1 : -1) * Math.min(1, t.confidence * 2);
    why.push(`words ${t.lang} (${t.es} es, ${t.en} en${masked !== fold(text).replace(/[^a-z0-9ñ ]+/g, " ").replace(/\s+/g, " ").trim() ? ", names masked" : ""})`);
  }
  if (prior === "es" || prior === "en") { score += WEIGHTS.prior * (prior === "es" ? 1 : -1); why.push(`before: ${prior}`); }
  const lang = score > 0 ? "es" : score < 0 ? "en" : prior || "en";
  const margin = Math.abs(score);
  return { lang, margin, why: why.join("; ") || "no evidence", rerun: !!(asrSays && textSays && asrSays !== textSays && margin < RERUN_BELOW) };
}
