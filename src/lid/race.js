// Spoken language ID by racing two streaming recognizers.
//
// Both the English and the Spanish model hear the first moments of an utterance.
// A model fed the wrong language still outputs words of its own language, but they
// fit badly: they are short fragments, seldom domain words, they do not parse into a
// command, and (once Kaldi finalizes them) they carry low word confidence.
// As soon as one side is clearly ahead the race locks: the winner keeps streaming
// (it already has the audio from the start, so nothing is replayed) and the loser
// stops receiving audio.

import { normalize } from "../text/normalize.js";
import { lexicalFit } from "./text-lid.js";

export const DEFAULT_RACE = {
  minMs: 500,        // never decide before this much speech
  maxMs: 1600,       // decide for the leader after this much speech
  margin: 0.35,      // score lead needed to decide early
  finalWaitMs: 350,  // after one final result, how long to wait for the other
  sticky: 0.15,      // prior for the language of the previous utterance
  weights: { conf: 1.2, lex: 1.0, parse: 0.6, frag: 0.5, length: 0.1 },
};

// Short words that are real words in each language (so they are not "fragments").
const SHORT_OK = {
  en: new Set("a i an am at be by do go he if in is it me my no of oh on or so to up us we".split(" ")),
  es: new Set("a al da de di el en es ha he la le lo me mi no o se si su te ti tu un va y ya yo".split(" ")),
};

/**
 * Features and score of one recognizer's hypothesis.
 * @param {{text: string, words?: {word: string, conf: number}[]}} hyp
 * @param {"en"|"es"} lang
 * @param {{vocab?: Record<string, Set<string>>, parse?: Function, prior?: number, weights?: object}} options
 */
export function scoreHypothesis(hyp, lang, { vocab = {}, parse = null, prior = 0, weights = DEFAULT_RACE.weights } = {}) {
  const text = hyp?.text ?? "";
  const words = normalize(text).split(" ").filter(Boolean);
  if (!words.length) return { score: -Infinity, words: 0 };
  const lex = lexicalFit(text, lang, vocab[lang]);
  const frag = words.filter((w) => w.length <= 2 && !SHORT_OK[lang].has(w)).length / words.length;
  const confs = (hyp.words ?? []).map((w) => w.conf).filter((c) => typeof c === "number");
  const conf = confs.length ? confs.reduce((a, b) => a + b, 0) / confs.length : null;
  let parsed = 0;
  if (parse) {
    const result = parse(text, lang);
    parsed = result && result.intent !== "unknown" ? result.confidence ?? 1 : 0;
  }
  const w = weights;
  const score = (conf === null ? 0 : w.conf * conf) + w.lex * lex + w.parse * parsed - w.frag * frag
    + w.length * Math.min(words.length, 4) / 4 + prior;
  return { score, conf, lex, frag, parsed, words: words.length };
}

/** Decide between two hypotheses. Returns { lang, margin, en, es }. */
export function decide(hyps, options = {}) {
  const prior = (lang) => (options.previous === lang ? options.sticky ?? DEFAULT_RACE.sticky : 0);
  const en = scoreHypothesis(hyps.en, "en", { ...options, prior: prior("en") });
  const es = scoreHypothesis(hyps.es, "es", { ...options, prior: prior("es") });
  if (en.score === -Infinity && es.score === -Infinity) return { lang: null, margin: 0, en, es };
  const lang = es.score > en.score ? "es" : en.score > es.score ? "en" : options.previous ?? "en";
  const margin = Math.abs((es.score === -Infinity ? 0 : es.score) - (en.score === -Infinity ? 0 : en.score));
  return { lang, margin, en, es };
}

/**
 * Stateful race over streaming partial and final results.
 * Feed it every partial/final from both recognizers; it returns a decision once.
 */
export class LanguageRace {
  constructor(options = {}) {
    this.options = { ...DEFAULT_RACE, ...options, weights: { ...DEFAULT_RACE.weights, ...options.weights } };
    this.reset();
  }

  reset(previous = this.options.previous) {
    this.options.previous = previous;
    this.hyps = { en: { text: "" }, es: { text: "" } };
    this.finals = { en: null, es: null };
    this.speechStart = null;
    this.firstFinalAt = null;
    this.decision = null;
    this.last = null;
  }

  /** A partial from one recognizer. `at` is a timestamp in ms. */
  partial(lang, text, at) {
    if (this.decision) return null;
    if (text && this.speechStart === null) this.speechStart = at;
    this.hyps[lang] = { text };
    return this.check(at);
  }

  /** A final result (with word confidences) from one recognizer. */
  final(lang, result, at) {
    if (this.decision) return null;
    if (!result?.text) return this.check(at);
    if (this.speechStart === null) this.speechStart = at;
    this.finals[lang] = result;
    this.hyps[lang] = result;
    this.firstFinalAt ??= at;
    return this.check(at);
  }

  /** Call on a timer too, so a stalled side cannot block the decision. */
  check(at) {
    if (this.decision || this.speechStart === null) return null;
    const elapsed = at - this.speechStart;
    const d = decide(this.hyps, this.options);
    this.last = d;
    if (!d.lang) return null;
    const bothFinal = this.finals.en && this.finals.es;
    const finalTimeout = this.firstFinalAt !== null && at - this.firstFinalAt >= this.options.finalWaitMs;
    const early = elapsed >= this.options.minMs && d.margin >= this.options.margin
      && this.hyps.en.text && this.hyps.es.text;
    if (bothFinal || finalTimeout || early || elapsed >= this.options.maxMs) {
      const reason = bothFinal ? "finals" : finalTimeout ? "final-timeout" : early ? "margin" : "time";
      this.decision = { ...d, reason, elapsed, final: this.finals[d.lang] };
      return this.decision;
    }
    return null;
  }

  /** Force a decision now (e.g. the user tapped stop). */
  force(at) {
    if (this.decision) return this.decision;
    const d = decide(this.hyps, this.options);
    this.decision = { ...d, lang: d.lang ?? this.options.previous ?? "en", reason: "forced",
      elapsed: this.speechStart === null ? 0 : at - this.speechStart, final: this.finals[d.lang] };
    return this.decision;
  }
}
