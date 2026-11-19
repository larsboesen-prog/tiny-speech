// The recognizer's name hint, built from a city pack within a token budget (plan step B9; review 1.3). Whisper reads at most 223
// prompt tokens, so the hint is a ranked budget, not "the names": the city's own hard words first (pack hint.lead: the centre's
// names, a collection's), then the places people pick, then the others, then sights; a place whose name Whisper hears right
// alone (hint.skip) is left out, and a long name goes in by its unusual part (hint.as). Names that do not fit are reported, and
// are still found afterwards by sound matching (domains/places/read.js).
//
// The page sends hintNames (this order) and the budget; the speech worker packs them with the model's own tokenizer (exact).
// fitHint does the same packing here, for the build report (tools/hint-report.mjs, with engines/whisper-tokens.js) and tests.

/** The names to offer the recognizer, in order of need: [{name, id?, tier}]. lang: "en" | "es" (a lead may differ by language). */
export function hintNames(pack, lang = "en") {
  const lead = pack.hint?.lead;
  const leadWords = Array.isArray(lead) ? lead : lead?.[lang] || lead?.en || [];
  const out = leadWords.map((name) => ({ name, tier: "lead" }));
  const places = (pack.places || []).filter((p) => !p.hint?.skip);
  const say = (p) => p.hint?.as || p.name;
  const tiers = [
    ["picks", (p) => p.kind !== "sights" && !p.other && p.photo],
    ["places", (p) => p.kind !== "sights" && !(!p.other && p.photo)],
    ["sights", (p) => p.kind === "sights"],
  ];
  for (const [tier, take] of tiers) for (const p of places.filter(take)) out.push({ name: say(p), id: p.id, tier });
  const seen = new Set();
  return out.filter((x) => { const k = x.name.toLowerCase(); if (seen.has(k)) return false; seen.add(k); return true; });
}

/**
 * Pack names into the budget, in order; one that does not fit is left out and a shorter one after it may still go in.
 * count(text) is the tokenizer's count of " " + text (the worker encodes the hint with a space before it, no special tokens).
 */
export function fitHint(names, budget, count = estimateTokens) {
  const list = names.map((x) => (typeof x === "string" ? { name: x } : x));
  const text = (used) => (used.length ? used.map((x) => x.name).join(", ") + "." : "");
  const used = [], left = [];
  for (const x of list) {
    if (budget > 0 && count(" " + text([...used, x])) <= budget) used.push(x);
    else left.push(x);
  }
  const t = text(used);
  return { text: t, tokens: t ? count(" " + t) : 0, used, left };
}

/**
 * A count that is never below Whisper's, for when its tokenizer is not at hand (a page can only guess; the worker counts
 * exactly). Calibrated on San Miguel's names (test/hint.test.mjs): about a token for every three letters of a word, more for
 * accented letters and marks, which byte-level BPE splits.
 */
export function estimateTokens(text) {
  let n = 0;
  for (const piece of String(text).match(/ ?\p{L}+| ?\p{N}+| ?[^\s\p{L}\p{N}]+|\s+/gu) || []) {
    const letters = piece.trim();
    const odd = (letters.match(/[^\x00-\x7f]/g) || []).length;  // é, ñ, ' …: two bytes, often a token of their own
    n += /^\s+$/.test(piece) ? 1 : Math.max(1, Math.ceil(letters.length / 3)) + odd;
  }
  return n;
}
