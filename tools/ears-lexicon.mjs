// A city's word list for the tiny ears (plan step B16): every word of the training-split restaurant requests and of the city's pack,
// with its sounds (Spanish by our rules, lang/es/ipa.js; English by tiny-voca's dictionary), and the word pairs of the training split
// for the matcher's small model of which word follows which (engines/ears-match.js). Built here, at build time; phones load the file.
// node tools/ears-lexicon.mjs <city> [out.json]     default out: packs/dist/<city>/ears-lexicon.json
// Needs vendor/tiny-voca/tiny-voca-js.gguf (npm run fetch:voice) for English sounds. The same list as the ears probe measured
// (training/asr/probe/lexicon.mjs calls this for San Miguel).
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import { readGGUF } from "../vendor/tiny-voca/js/tiny-voca.js";
import { fromGGUF } from "../vendor/tiny-voca/js/dizione/engine.js";
import { ipaWord } from "../lang/es/ipa.js";
import { numberWordsEs } from "../lang/es/sounds.js";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const split = (t) => { const n = parseInt(createHash("sha256").update("asr-split1" + t.toLowerCase()).digest("hex").slice(0, 8), 16) % 100; return n < 10 ? "test" : n < 15 ? "dev" : "train"; };
const words = (t) => (t.toLowerCase().match(/[\p{L}']+/gu) || []).map((w) => w.replace(/^'+|'+$/g, "")).filter(Boolean);
const read = (p, fallback) => (existsSync(p) ? JSON.parse(readFileSync(p, "utf8")) : fallback);

/** {words, unigrams, bigrams, summary} for a city (packs/src/<city>/), with the requests' training split. */
export async function earsLexicon(city) {
  const phonemizer = await fromGGUF(readGGUF(new Uint8Array(readFileSync(ROOT + "vendor/tiny-voca/tiny-voca-js.gguf")).buffer));
  const rows = readFileSync(ROOT + "training/asr/text/utterances.jsonl", "utf8").trim().split("\n").map((l) => JSON.parse(l));
  const train = rows.filter((r) => (r.split || split(r.text)) === "train");
  const src = ROOT + `packs/src/${city}/`;
  const places = read(src + "places.json", []), areas = read(src + "areas.json", []);
  const english = new Set((read(src + "lexicon.json", {}).english || []).map((w) => w.toLowerCase()));

  const lang = new Map();  // word -> Set("es","en")
  const add = (w, l) => { if (!lang.has(w)) lang.set(w, new Set()); lang.get(w).add(l); };
  for (const r of train) for (const w of words(r.text)) { if (r.lang !== "en") add(w, "es"); if (r.lang !== "es") add(w, "en"); }
  for (const p of places) for (const w of words(p.name + " " + (p.names || []).map((n) => n.t).join(" "))) { add(w, "es"); if (english.has(w)) add(w, "en"); }
  for (const a of areas) for (const w of words(JSON.stringify(a.say || a.words || a.names || ""))) add(w, "es");
  for (let n = 0; n <= 100; n++) for (const w of words(numberWordsEs(n))) add(w, "es");

  const out = {};
  for (const [w, ls] of lang) {
    const prons = [];
    if (ls.has("es")) { const p = ipaWord(w).map((x) => x.replace("ˈ", "")); if (p.length) prons.push({ lang: "es", phones: p }); }
    if (ls.has("en")) {
      try {
        const r = phonemizer.phonemize(w);
        const p = r.symbols.filter((s) => !/^<|^[.,;:!?…—"'()]$/.test(s));
        if (p.length) prons.push({ lang: "en", phones: p });
      } catch { /* nothing to say */ }
    }
    if (prons.length) out[w] = prons;
  }
  // word pairs of the training split (with <s> and </s>)
  const pairs = {}, counts = {};
  for (const r of train) {
    const ws = ["<s>", ...words(r.text).filter((w) => out[w]), "</s>"];
    ws.forEach((w, i) => { counts[w] = (counts[w] || 0) + 1; if (i) { const k = ws[i - 1] + " " + w; pairs[k] = (pairs[k] || 0) + 1; } });
  }
  const summary = `${Object.keys(out).length} words (${Object.values(out).filter((p) => p.some((x) => x.lang === "es")).length} with Spanish sounds, ${Object.values(out).filter((p) => p.some((x) => x.lang === "en")).length} with English), ${Object.keys(pairs).length} word pairs from ${train.length} training sentences`;
  return { words: out, unigrams: counts, bigrams: pairs, summary };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const city = process.argv[2];
  if (!city) { console.error("usage: node tools/ears-lexicon.mjs <city> [out.json]"); process.exit(2); }
  const { words: w, unigrams, bigrams, summary } = await earsLexicon(city);
  const text = JSON.stringify({ words: w, unigrams, bigrams });
  const out = process.argv[3] || ROOT + `packs/dist/${city}/ears-lexicon.json`;
  writeFileSync(out, text);
  console.log(`${out}: ${summary}; ${text.length} bytes, sha256 ${createHash("sha256").update(text).digest("hex").slice(0, 12)}`);
}
