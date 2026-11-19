// The word list for the ears probe (README.md here): every word of the training-split restaurant requests and of San Miguel's
// pack, with its sounds: Spanish by our rules (lang/es/ipa.js), English by tiny-voca's dictionary (dizione), both for words
// that appear in both. Also the word pairs of the training split, for a small model of which word follows which.
// node training/asr/probe/lexicon.mjs <out.json>
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import { readGGUF } from "../../../vendor/tiny-voca/js/tiny-voca.js";
import { fromGGUF } from "../../../vendor/tiny-voca/js/dizione/engine.js";
import { ipaWord } from "../../../lang/es/ipa.js";
import { numberWordsEs } from "../../../lang/es/sounds.js";

const ROOT = fileURLToPath(new URL("../../../", import.meta.url));
const phonemizer = await fromGGUF(readGGUF(new Uint8Array(readFileSync(ROOT + "vendor/tiny-voca/tiny-voca-js.gguf")).buffer));
const split = (t) => { const n = parseInt(createHash("sha256").update("asr-split1" + t.toLowerCase()).digest("hex").slice(0, 8), 16) % 100; return n < 10 ? "test" : n < 15 ? "dev" : "train"; };
const words = (t) => (t.toLowerCase().match(/[\p{L}']+/gu) || []).map((w) => w.replace(/^'+|'+$/g, "")).filter(Boolean);
const rows = readFileSync(ROOT + "training/asr/text/utterances.jsonl", "utf8").trim().split("\n").map((l) => JSON.parse(l));
const train = rows.filter((r) => (r.split || split(r.text)) === "train");
const places = JSON.parse(readFileSync(ROOT + "packs/src/mx-sma/places.json", "utf8"));
const areas = JSON.parse(readFileSync(ROOT + "packs/src/mx-sma/areas.json", "utf8"));
const english = new Set((JSON.parse(readFileSync(ROOT + "packs/src/mx-sma/lexicon.json", "utf8")).english || []).map((w) => w.toLowerCase()));

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
writeFileSync(process.argv[2], JSON.stringify({ words: out, unigrams: counts, bigrams: pairs }));
console.log(`${Object.keys(out).length} words (${Object.values(out).filter((p) => p.some((x) => x.lang === "es")).length} with Spanish sounds, ${Object.values(out).filter((p) => p.some((x) => x.lang === "en")).length} with English), ${Object.keys(pairs).length} word pairs from ${train.length} training sentences`);
