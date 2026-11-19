// What people say to a restaurant-search voice app in Mexico, written down: the text side of the speech-recognition dataset
// (training/asr/README.md). Mostly Mexican Spanish, some English and some mixed; natural requests, corrections, follow-ups,
// place names, local expressions, numbers and times, disfluent speech. Each line: what was said (as spoken: numbers in words,
// no abbreviations) and what it asks for (a few plain English words, to test understanding too).
// NODE_USE_ENV_PROXY=1 node tools/asr-text.mjs [--run-only]   → training/asr/text/utterances.jsonl and REPORT.md
// Written by a large model through OpenRouter (build time only); checked by rules; split by sentence into train / dev / test.
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { chat, spent } from "./openrouter.mjs";
import { ipaWord } from "../lang/es/ipa.js";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const OUT = ROOT + "training/asr/text/";
mkdirSync(OUT, { recursive: true });
const MODEL = process.env.TS_MODEL || "anthropic/claude-sonnet-5.5";
const sha = (s) => createHash("sha256").update(s).digest("hex");
const words = (t) => (t.match(/[\p{L}\p{N}']+/gu) || []).length;
const places = JSON.parse(readFileSync(ROOT + "packs/src/mx-sma/places.json", "utf8"));
const NAMES = places.map((p) => p.name);

// Mexican Spanish first (the recognizer's weak side), then English and mixed. [lang, category, what to write, how many]
export const PLAN = [
  ["es", "requests", "requests to find a place to eat or drink: a dish, a cuisine, a mood, open now or later, near or in an area, a budget, a group, kids, a dog, a view", 800],
  ["es", "corrections", "corrections and repairs mid-request: 'no, no, mejor de mariscos', 'perdón, quise decir para mañana', 'ese no, el otro', changing the dish, the time, the place or the number of people", 400],
  ["es", "followups", "short follow-ups after an answer: '¿y mañana?', '¿cuál está más cerca?', '¿a qué hora cierra?', 'dame otros cuatro', 'repítelo', '¿tiene terraza?', '¿aceptan tarjeta?'", 350],
  ["es", "names", "questions and requests that name a specific restaurant, bar or café from the list given, as people really say them (sometimes only part of the name, sometimes with 'el' or 'la')", 400],
  ["es", "local", "requests full of Mexican expressions: ahorita, al rato, chela, chelas, botana, antojitos, garnachas, fondita, comida corrida, pulque, mezcalito, ¿qué onda?, chido, padre, neta, me late, bien servido, de a pie, unos taquitos", 400],
  ["es", "numbers", "requests with numbers, times and prices said in words: 'para seis personas', 'menos de doscientos pesos', 'a las ocho y media', 'cuarto para las nueve', 'en veinte minutos', 'a dos cuadras'", 300],
  ["es", "disfluent", "requests as people say them while thinking: 'eh', 'este', 'o sea', 'pues', a restart, a repeated word, trailing off, starting over", 200],
  ["es", "music_drinks", "requests about live music, a band tonight, mezcal, cocktails, wine, pulque, coffee, desserts", 200],
  ["en", "requests", "requests to find a place to eat or drink, as visitors and English-speaking residents of a Mexican town say them, using Spanish dish and place names", 300],
  ["en", "corrections", "corrections and follow-ups: 'no, I meant tomorrow', 'something cheaper', 'the other one', 'how late is it open', 'four more'", 150],
  ["en", "names", "questions that name a specific restaurant, bar or café from the list given, as English speakers say Spanish names", 100],
  ["mixed", "mixed", "Spanish and English mixed in one request, as bilingual people in a tourist town talk", 250],
];

const STYLE = {
  es: "Mexican Spanish as spoken in central Mexico (never Spain's: no vosotros, ordenador, zumo, coger, vale, guay)",
  en: "English as spoken by visitors and residents (American and Canadian mostly), with Spanish names as they appear",
  mixed: "a natural mix of Mexican Spanish and English in one sentence",
};
function prompt(lang, about, n, names, variety) {
  return `Write ${n} different things a person says out loud to a voice assistant that finds restaurants, bars and cafés in a town
in Mexico. Kind: ${about}. Language: ${STYLE[lang]}. ${variety}
Write each exactly as it would be SAID: numbers, times and prices in words (never digits), no abbreviations, no emoji, no
symbols except ¿ ? ¡ ! , . and apostrophes. Between 2 and 25 words each. Vary the length, the wording, the politeness and
the person (young, old, local, visitor, in a hurry, chatty).
${names.length ? `Use names from this list where a name fits, spelled exactly: ${names.join("; ")}.` : "Do not use real restaurant names."}
For each, list what it asks for in a few plain English words.
Return JSON: {"utterances": [{"text": "...", "wants": ["tacos", "open now"]}]}`;
}
const VARIETY = ["Mostly short.", "Mostly questions.", "Mostly commands and wishes.", "Some long and rambling.", "Casual, among friends.",
  "Polite, older speakers.", "People in a hurry.", "Tourists from Mexico City visiting.", "Families with children.", "Late at night."];

const ES_OK = /^[\p{L} ,.¿?¡!'’-]+$/u;
const SPAIN = /\b(vosotros|vosotras|habéis|sois|estáis|tenéis|podéis|queréis|ordenador|zumo|coger|vale|guay|chaval)\b/i;
function check(lang, text) {
  const t = text.normalize("NFC").replace(/\s+/g, " ").trim();
  const n = words(t);
  if (n < 2 || n > 25 || /\d/.test(t) || !ES_OK.test(t)) return null;
  if (lang !== "en" && SPAIN.test(t)) return null;
  if (lang === "es" && !(t.match(/[\p{L}']+/gu) || []).every((w) => ipaWord(w).length || /^[a-z']+$/i.test(w))) return null;
  return t;
}

const FILE = OUT + "utterances.jsonl";
if (!process.argv.includes("--run-only") || !existsSync(FILE)) {
  const rows = existsSync(FILE) ? readFileSync(FILE, "utf8").trim().split("\n").filter(Boolean).map((l) => JSON.parse(l)) : [];
  const seen = new Set(rows.map((r) => r.text.toLowerCase()));
  let rejected = 0;
  for (const [lang, category, about, want] of PLAN) {
    let have = rows.filter((r) => r.lang === lang && r.category === category).length, k = 0;
    while (have < want && k < Math.ceil(want / 50) + 3) {
      const names = /names|requests|followups|mixed/.test(category) ? [...NAMES].sort(() => Math.random() - 0.5).slice(0, 20) : [];
      const r = await chat({ model: MODEL, purpose: `asr text ${lang} ${category}`, maxTokens: 7000, temperature: 0.95,
        user: prompt(lang, about, Math.min(60, want - have + 5), names, VARIETY[k % VARIETY.length]) });
      k++;
      for (const u of r.json?.utterances || []) {
        const t = typeof u.text === "string" && check(lang, u.text);
        if (!t || seen.has(t.toLowerCase())) { rejected++; continue; }
        seen.add(t.toLowerCase());
        rows.push({ id: `asr-${lang}-${category}-${sha(t).slice(0, 10)}`, lang, category, text: t, wants: (u.wants || []).slice(0, 6),
          names: NAMES.filter((n) => t.toLowerCase().includes(n.toLowerCase())), source: MODEL });
        have++;
      }
      writeFileSync(FILE, rows.map((x) => JSON.stringify(x)).join("\n") + "\n");
      process.stdout.write(`\r${lang} ${category}: ${have}/${want}  ($${spent().toFixed(2)})   `);
    }
    console.log();
  }
  console.log(`rejected ${rejected}`);
}

// ---------- splits, by sentence: 85% train (synthetic voices and speakers), 5% dev, 10% test (never synthesized for training) ----------
const rows = readFileSync(FILE, "utf8").trim().split("\n").map((l) => JSON.parse(l));
const split = (t) => { const n = parseInt(sha("asr-split1" + t.toLowerCase()).slice(0, 8), 16) % 100; return n < 10 ? "test" : n < 15 ? "dev" : "train"; };
for (const r of rows) r.split = split(r.text);
writeFileSync(FILE, rows.map((x) => JSON.stringify(x)).join("\n") + "\n");
const by = (f) => rows.reduce((m, r) => ((m[r[f]] = (m[r[f]] || 0) + 1), m), {});
const table = (f) => Object.entries(by(f)).map(([k, n]) => `${k} ${n}`).join(", ");
const named = rows.filter((r) => r.names.length);
writeFileSync(OUT + "REPORT.md", `# Restaurant requests, written down

${rows.length} utterances by \`tools/asr-text.mjs\` (${MODEL} through OpenRouter, each checked by rules; OpenRouter spending so far,
this repository: $${spent().toFixed(2)}). About ${(rows.reduce((s, r) => s + words(r.text), 0) / 2.5 / 3600).toFixed(1)} hours if each is said once.

- Languages: ${table("lang")}.
- Kinds: ${table("category")}.
- Splits (by sentence): ${table("split")}. Test sentences are never synthesized for training; people record them for the test.
- ${named.length} name a San Miguel place (${new Set(named.flatMap((r) => r.names)).size} different places).

Examples:

${["requests", "corrections", "followups", "names", "local", "numbers", "disfluent", "mixed"].map((c) => {
  const r = rows.find((x) => x.category === c && x.lang !== "en") || rows.find((x) => x.category === c);
  return r ? `- *${c}* (${r.lang}): ${r.text} — wants: ${r.wants.join(", ")}` : "";
}).filter(Boolean).join("\n")}
`);
console.log(readFileSync(OUT + "REPORT.md", "utf8"));
