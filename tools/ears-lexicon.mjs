// A city's word list for the tiny ears (plan step B16): every word of the training-split restaurant requests and of the city's pack,
// with its sounds (Spanish by our rules, lang/es/ipa.js; English by tiny-voca's dictionary), and the word pairs of the training split
// for the matcher's small model of which word follows which (engines/ears-match.js). Built here, at build time; phones load the file.
// node tools/ears-lexicon.mjs <city> [out.json]     default out: packs/dist/<city>/ears-lexicon.json
// English sounds from tiny-voca's phonemizer in the committed MX1 voice file (the same tables as tiny-voca-js.gguf: identical on all
// 2,193 words checked, 21 Nov 2026).
// Since 22 Nov 2026 (the owner asked "what music venues are open now": "venues" could not be written, so it became "view"), the list
// also has every word the reader understands (its rules: domains/places/read.js, domains/music/index.js, lang/*) and everyday question
// words (tools/ears-words.txt): 614 more words. The small model of which word follows which also learns, at a small weight, template
// questions about every place ("when is La Azotea open", "a qué hora abre Estoril") and every new word ("is there a tapas open now"),
// so the new words can win when they were said, without stealing from words people use (measured: training/ears/README.md).
// earsLexicon(city, {extended: false}) gives the list as before (the ears probe's measurements were made with it).
// Leaning lists (22 Nov 2026, the owner: "In the UI select EN so text is in English: why can't the ear model give more preference to
// English words, and the same for Spanish when ES is selected?"): ears-lexicon-en.json and -es.json, for a page whose reader chose a
// language: that language's sentences count LEAN.preferWeight times, and the other language's readings of a word cost LEAN.otherCost
// (the city's names are said either way). Measured, matched page and speaker: words wrong English 18.0% → 15.1%, Spanish 14.5% → 12.9%
// on questions with the new words; held-out understood English 65.7% → 67.2%, Spanish 86.8% → 87.5%. On the wrong page an English
// speaker loses (68.9% → 60.0%): the page's EN|ES switch matters (training/ears/README.md).
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import { readGGUF } from "../vendor/tiny-voca/js/tiny-voca.js";  // the phonemizer's tables travel in the voice file
import { fromGGUF } from "../vendor/tiny-voca/js/dizione/engine.js";
import { ipaWord } from "../lang/es/ipa.js";
import { numberWordsEs } from "../lang/es/sounds.js";
import { streetIndex } from "../domains/places/streets.js";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const split = (t) => { const n = parseInt(createHash("sha256").update("asr-split1" + t.toLowerCase()).digest("hex").slice(0, 8), 16) % 100; return n < 10 ? "test" : n < 15 ? "dev" : "train"; };
const words = (t) => (t.toLowerCase().match(/[\p{L}']+/gu) || []).map((w) => w.replace(/^'+|'+$/g, "")).filter(Boolean);
const read = (p, fallback) => (existsSync(p) ? JSON.parse(readFileSync(p, "utf8")) : fallback);

const VOICE = ROOT + "vendor/tiny-voca/tiny-voca-mx1-2026-11-21.gguf";
// Template weights: a template question counts this much of a real request in the word-pair model (chosen on 22 Nov 2026: heavier
// templates let new short words steal, "eats" for "pizza"; lighter ones left the new words unheard).
const WORD_TEMPLATE_WEIGHT = 0.1, PLACE_TEMPLATE_WEIGHT = 0.25;
const T_PLACE = { en: ["when is {p} open", "is {p} open now", "what time does {p} close", "where is {p}", "how far is {p}", "{p} when is it open"],
  es: ["a qué hora abre {p}", "está abierto {p}", "a qué hora cierra {p}", "dónde está {p}", "qué tan lejos está {p}", "{p} a qué hora abre"] };
const T_WORD = { en: ["is there a {w} open now", "{w} near me", "where can i find {w}", "any {w} in centro", "what {w} are open now"],
  es: ["hay {w} abierto ahora", "dónde hay {w}", "{w} cerca de aquí", "busco {w} en el centro"] };
// Lists, streets and landmarks (owner, 22 Nov 2026: "show me some high end restaurants", "restaurants on Umarán", "restaurants in Live
// Aqua" failed: "Seems restaurants and street names fail")
const T_LIST = { en: ["show me some {a} restaurants", "any {a} restaurants open now", "find me a {a} restaurant", "{a} restaurants near me"],
  es: ["muéstrame restaurantes {a}", "hay restaurantes {a} abiertos", "busco un restaurante {a}"] };
const LIST_WORDS = { en: ["good", "nice", "quality", "high end", "upscale", "fancy", "cheap", "expensive", "best", "rooftop", "italian", "mexican", "seafood", "vegan", "romantic", "quiet", "local"],
  es: ["buenos", "baratos", "caros", "elegantes", "italianos", "mexicanos", "de mariscos", "veganos", "con terraza", "románticos"] };
const T_STREET = { en: ["restaurants on {s}", "show me restaurants on {s}", "is there a restaurant on {s}", "what is on {s} street", "bars on calle {s}"],
  es: ["restaurantes en la calle {s}", "qué hay en la calle {s}", "hay restaurantes en {s}"] };
const T_LANDMARK = { en: ["restaurants in {h}", "show me restaurants near {h}", "what is near {h}"], es: ["restaurantes en {h}", "qué hay cerca de {h}"] };
const NAME_SMALL = new Set("the del las los una para sobre entre".split(" "));
const T_EXTRA = ["what music venues are open now", "where is there live music tonight", "find four restaurants in centro that are open now",
  "what vegan restaurant is open", "what is open right now", "where can i eat now"];
const JUNK = new Set("pastele coctele mediterrane peruan corean originale pastr feat whos bfast modmex tradmex mex th os fi wi hr hrs min mins mxn am mid set pm".split(" "));
export const LEAN = { preferWeight: 6, otherCost: 1 };
const READER = ["domains/places/read.js", "domains/music/index.js", "lang/en/index.js", "lang/es/index.js"];

/** The plain words in a rule's alternatives ("cafes?|bars?|happy hour" → cafe, cafes, bar, bars, happy, hour); patterns with other regex
 * syntax are skipped. */
function ruleWords(src) {
  const out = new Set();
  const expand = (alt) => {
    alt = alt.replace(/\\b|\\s\+|\\s\*|\\s/g, " ").trim();
    if (/[\[\]{}*+\\^$]/.test(alt.replace(/\?/g, ""))) return [];
    const forms = [""];
    for (const tok of alt.split(/(\w\?|\(\w+\)\?)/)) {
      if (!tok) continue;
      const opt = tok.match(/^(\w)\?$|^\((\w+)\)\?$/);
      if (opt) { const t = opt[1] || opt[2]; const n = forms.length; for (let i = 0; i < n; i++) forms.push(forms[i] + t); }
      else for (let i = 0; i < forms.length; i++) forms[i] += tok;
    }
    return forms.flatMap((f) => f.split(/[\s']+/)).map((f) => f.toLowerCase()).filter((f) => /^[a-zñáéíóúü]+$/.test(f) && f.length > 2 && !JUNK.has(f));
  };
  for (const m of src.matchAll(/\/\\b\(([^/]*?)\)\\b\//g)) for (const alt of m[1].split("|")) for (const w of expand(alt)) out.add(w);
  return out;
}

/** {words, unigrams, bigrams, summary} for a city (packs/src/<city>/), with the requests' training split. */
export async function earsLexicon(city, { extended = true, prefer = null, preferWeight = 1, otherCost = 0 } = {}) {
  // prefer "en" | "es": the page's language. Its sentences count preferWeight times, the other language's 1/preferWeight; a reading
  // in the other language costs otherCost log points (not for the city's names, said either way).
  const weightOf = (lang) => (!prefer ? 1 : lang === prefer ? preferWeight : lang === "mixed" ? 1 : 1 / preferWeight);
  const phonemizer = await fromGGUF(readGGUF(new Uint8Array(readFileSync(VOICE)).buffer));
  const rows = readFileSync(ROOT + "training/asr/text/utterances.jsonl", "utf8").trim().split("\n").map((l) => JSON.parse(l));
  const train = rows.filter((r) => (r.split || split(r.text)) === "train");
  const src = ROOT + `packs/src/${city}/`;
  const places = read(src + "places.json", []), areas = read(src + "areas.json", []);
  const streets = streetIndex(places.map((p) => ({ id: p.id, address: (p.info || {}).address }))).streets;  // "Umarán 8" → Umarán
  const landmarks = read(src + "landmarks.json", { landmarks: [] }).landmarks;  // hotels and the like, not on the list
  const english = new Set((read(src + "lexicon.json", {}).english || []).map((w) => w.toLowerCase()));

  const lang = new Map();  // word -> Set("es","en")
  const add = (w, l) => { if (!lang.has(w)) lang.set(w, new Set()); lang.get(w).add(l); };
  for (const r of train) for (const w of words(r.text)) { if (r.lang !== "en") add(w, "es"); if (r.lang !== "es") add(w, "en"); }
  // place names the Spanish way (and the English way when the pack says so, or English requests named them). Giving every name an
  // English reading too was tried on 22 Nov 2026 (the owner's recordings): no gain for them, 3 fewer names on the 201 English requests.
  for (const p of places) for (const w of words(p.name + " " + (p.names || []).map((n) => n.t).join(" "))) { add(w, "es"); if (english.has(w)) add(w, "en"); }
  for (const a of areas) for (const w of words(JSON.stringify(a.say || a.words || a.names || ""))) add(w, "es");
  // streets and landmarks: said the Spanish way and the English way ("Mesones", "Hernández Macías" from an English speaker); their small
  // words ("de la", "the") keep the readings they have (given both ways at no cost, "the" crept into Spanish questions: "de the")
  const nameWords = (t) => words(t).filter((w) => w.length > 3 && !NAME_SMALL.has(w));
  for (const st of streets) for (const w of nameWords(st.name)) { add(w, "es"); add(w, "en"); }
  for (const l of landmarks) for (const w of nameWords(l.say.join(" "))) { if (!phonemizer.isWord(w) || lang.has(w)) add(w, "es"); add(w, "en"); }
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
    const k1 = weightOf(r.lang);
    ws.forEach((w, i) => { counts[w] = (counts[w] || 0) + k1; if (i) { const k = ws[i - 1] + " " + w; pairs[k] = (pairs[k] || 0) + k1; } });
  }
  let added = 0, templates = 0;
  if (extended) {
    // the reader's words, the days, "venue(s)" and everyday question words, each with one reading: English when tiny-voca's dictionary
    // knows the word (and it has no Spanish accent), else Spanish
    const fold = (w) => w.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
    const have = new Set(Object.keys(out).flatMap((w) => [w, fold(w)]));
    const extra = new Set(["venue", "venues", ..."monday tuesday wednesday thursday friday saturday sunday weekend weekends miércoles sábado".split(" ")]);
    for (const f of READER) for (const w of ruleWords(readFileSync(ROOT + f, "utf8"))) extra.add(w);
    for (const line of readFileSync(ROOT + "tools/ears-words.txt", "utf8").split("\n")) if (!line.startsWith("#")) for (const w of line.split(/\s+/)) if (w) extra.add(w.toLowerCase());
    for (const w of extra) {
      if (have.has(w) || have.has(fold(w))) continue;
      const isEnglish = !/[ñáéíóúü]/.test(w) && phonemizer.isWord(w);
      let p = [];
      if (isEnglish) { try { p = phonemizer.phonemize(w).symbols.filter((x) => !/^<|^[.,;:!?…—"'()]$/.test(x)); } catch { p = []; } }
      else p = ipaWord(w).map((x) => x.replace("ˈ", ""));
      if (!p.length) continue;
      out[w] = [{ lang: isEnglish ? "en" : "es", phones: p }];
      have.add(w);
      added++;
    }
    // template questions, at a small weight: about every place and sight, and about every new word
    const learn = (sentence, weight) => {
      const ws = ["<s>", ...words(sentence).filter((w) => out[w]), "</s>"];
      ws.forEach((w, i) => { counts[w] = (counts[w] || 0) + weight; if (i) { const k = ws[i - 1] + " " + w; pairs[k] = (pairs[k] || 0) + weight; } });
      templates++;
    };
    for (const p of places) {
      const name = p.name.toLowerCase().replace(/[^\p{L}' ]+/gu, " ").replace(/\s+/g, " ").trim();
      for (const t of T_PLACE.en) learn(t.replace("{p}", name), PLACE_TEMPLATE_WEIGHT * weightOf("en"));
      for (const t of T_PLACE.es) learn(t.replace("{p}", name), PLACE_TEMPLATE_WEIGHT * weightOf("es"));
    }
    for (const t of T_EXTRA) learn(t, PLACE_TEMPLATE_WEIGHT * weightOf("en"));
    for (const l of ["en", "es"]) {
      for (const t of T_LIST[l]) for (const a of LIST_WORDS[l]) learn(t.replace("{a}", a), PLACE_TEMPLATE_WEIGHT * weightOf(l));
      for (const st of streets) { const s = st.name.toLowerCase(); for (const t of T_STREET[l]) learn(t.replace("{s}", s), PLACE_TEMPLATE_WEIGHT * weightOf(l)); }
      for (const lm of landmarks) for (const say of lm.say) for (const t of T_LANDMARK[l]) learn(t.replace("{h}", say), PLACE_TEMPLATE_WEIGHT * weightOf(l));
    }
    for (const w of Object.keys(out).slice(-added)) for (const t of T_WORD[out[w][0].lang]) learn(t.replace("{w}", w), WORD_TEMPLATE_WEIGHT * weightOf(out[w][0].lang));
    const round = (o) => { for (const k in o) o[k] = Math.round(o[k] * 1e4) / 1e4; };
    round(counts); round(pairs);
  }
  if (prefer && otherCost) {
    const names = new Set();
    for (const p of places) for (const w of words(p.name + " " + (p.names || []).map((n) => n.t).join(" "))) names.add(w);
    for (const a of areas) for (const w of words(JSON.stringify(a.say || a.words || a.names || ""))) names.add(w);
    if (prefer === "en") for (const st of streets) for (const w of words(st.name).filter((w) => w.length > 3 && !NAME_SMALL.has(w))) names.add(w);  // English speakers say them the Spanish way too; Spanish speakers not the English way
    for (const l of landmarks) for (const w of words(l.say.join(" ")).filter((w) => w.length > 3 && !NAME_SMALL.has(w))) names.add(w);
    for (const [w, prons] of Object.entries(out)) if (!names.has(w)) for (const p of prons) if (p.lang !== prefer) p.cost = otherCost;
  }
  // The English page: English words also as their spelling is read by Spanish rules, at a cost of 1 (many non-native speakers say
  // "restaurants" closer to its letters; 22 Nov 2026, accented stand-in voices: right requests 42.9% → 47.6%, English and Spanish
  // controls unchanged)
  let spelled = 0;
  if (prefer === "en") for (const [w, prons] of Object.entries(out)) {
    if (!/^[a-z]+$/.test(w) || !prons.some((p) => p.lang === "en") || prons.some((p) => p.lang === "es" && !p.cost)) continue;
    const ph = ipaWord(w).map((x) => x.replace("ˈ", ""));
    if (ph.length && !prons.some((p) => p.phones.join(" ") === ph.join(" "))) { prons.push({ lang: "en", phones: ph, cost: 1 }); spelled++; }
  }
  const summary = `${spelled ? `${spelled} English words also as spelled; ` : ""}${Object.keys(out).length} words (${Object.values(out).filter((p) => p.some((x) => x.lang === "es")).length} with Spanish sounds, ${Object.values(out).filter((p) => p.some((x) => x.lang === "en")).length} with English), ${Object.keys(pairs).length} word pairs from ${train.length} training sentences${extended ? ` and ${templates} template questions; ${added} words from the reader and everyday lists` : ""}`;
  return { words: out, unigrams: counts, bigrams: pairs, summary };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const city = process.argv[2];
  if (!city) { console.error("usage: node tools/ears-lexicon.mjs <city> [out.json]"); process.exit(2); }
  // the list for any page, and one leaning to each language (a page that knows its reader's language loads that one)
  for (const prefer of [null, "en", "es"]) {
    const { words: w, unigrams, bigrams, summary } = await earsLexicon(city, prefer ? { prefer, ...LEAN } : {});
    const text = JSON.stringify({ words: w, unigrams, bigrams });
    const out = prefer ? (process.argv[3] ? process.argv[3].replace(/\.json$/, `-${prefer}.json`) : ROOT + `packs/dist/${city}/ears-lexicon-${prefer}.json`)
      : process.argv[3] || ROOT + `packs/dist/${city}/ears-lexicon.json`;
    writeFileSync(out, text);
    console.log(`${out}: ${summary}; ${text.length} bytes, sha256 ${createHash("sha256").update(text).digest("hex").slice(0, 12)}`);
  }
  // the place names the ears look for by sound (engines/ears-spot.js): each place's name and its other spoken forms ("La Cabra" for La
  // Cabra Iluminada), as the city's pack has them
  const names = read(ROOT + `packs/src/${city}/places.json`, []).map((p) => ({ id: p.id, name: p.name, ...((p.names || []).length ? { alts: p.names.map((n) => n.t) } : {}) }));
  const out = process.argv[3] ? process.argv[3].replace(/ears-lexicon[^/]*\.json$|\.json$/, "ears-names.json") : ROOT + `packs/dist/${city}/ears-names.json`;
  const text = JSON.stringify({ names });
  writeFileSync(out, text);
  console.log(`${out}: ${names.length} places; ${text.length} bytes`);
}
