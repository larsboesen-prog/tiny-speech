// The bilingual voice's training script (plan step 5, D4): sentences the one tiny-voca voice must read well in Mexican Spanish and
// in English, for the app's own work (places, music venues, hours, directions, dishes, numbers, news, short replies). A large model
// writes them through OpenRouter (build time only); rules check every sentence before it is kept. Written to training/script/.
//   NODE_USE_ENV_PROXY=1 node tools/make-script.mjs [--calls N]   (N batches of about 50 sentences; default: the plan below)
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { chat, spent, BUDGET } from "./openrouter.mjs";
import { sentencePhones } from "../lang/es/sounds.js";
import { fold } from "../core/text/sound.js";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
mkdirSync(ROOT + "training/script", { recursive: true });
const MODEL = process.env.TS_MODEL || "anthropic/claude-sonnet-5.5";
const places = JSON.parse(readFileSync(ROOT + "packs/src/mx-sma/places.json", "utf8"));
const NAMES = places.map((p) => p.name);

const ES_THEMES = [
  ["answers", "answers a voice assistant gives about places to eat and drink: which are open, until when, what they serve, how far (\"Aquí tienes tres lugares para tacos abiertos ahora. ...\")"],
  ["questions", "questions people in Mexico ask a voice assistant about where to eat or drink, said the way people really talk (ahorita, al rato, ¿qué onda?, ¿me recomiendas…?)"],
  ["music", "live music: which bars and restaurants have jazz, trova, mariachi, son jarocho, rock, cumbia or salsa, on which nights, from what time"],
  ["hours", "opening hours and days said in full: \"abre de martes a domingo de la una de la tarde a las once de la noche\", \"cierra a las nueve y media\", \"cuarto para las ocho\", \"diez para las nueve\""],
  ["directions", "directions and distances in a small colonial town: streets, blocks, \"a unos trescientos metros\", \"como cinco minutos a pie\", landmarks"],
  ["food", "Mexican dishes and drinks described: mole, pozole, chiles en nogada, tlayudas, enchiladas mineras, gorditas, esquites, pan dulce, conchas, mezcal, pulque, aguas frescas"],
  ["numbers", "numbers, prices in pesos, dates, years, phone-style numbers and quantities, written with digits about half of the time"],
  ["news", "short news sentences read aloud (economy, weather, sports, culture, science), neutral, with no real person's name"],
  ["replies", "short replies and confirmations a voice assistant says: \"Claro.\", \"Con gusto.\", \"No encontré nada abierto a esta hora.\", \"¿Me lo repites?\""],
  ["places", "sentences with Mexican place names, including Nahuatl ones: Tlaxcala, Xochimilco, Oaxaca, Querétaro, Guanajuato, Atotonilco, Michoacán, Tepoztlán, Cuauhtémoc"],
  ["mixed", "Spanish sentences that contain English words or names as people in tourist towns say them: rooftop, brunch, happy hour, wifi, la playlist, el check-in"],
  ["names", "questions and answers that name specific restaurants, bars and cafés of the list given"],
];
const EN_THEMES = [
  ["answers", "answers a voice assistant gives in English about places to eat and drink in a Mexican town, using their Spanish names"],
  ["questions", "questions English-speaking visitors and residents ask about where to eat, drink or hear live music"],
  ["music", "live music nights: jazz, trova, mariachi, rock; which nights, from what time"],
  ["hours", "opening hours said in full: \"open Tuesday to Sunday from 1 p.m. to 11 p.m.\", \"closes at half past nine\""],
  ["directions", "directions and distances in a colonial town with Spanish street names"],
  ["news", "short neutral news sentences read aloud, with no real person's name"],
  ["replies", "short replies and confirmations a voice assistant says"],
];
const ANGLES = ["", "said by locals", "said by visitors", "late at night", "on a weekend morning", "with a little humour", "very short", "longer, with two clauses"];

function prompt(lang, theme, about, n, angle, names) {
  const variety = lang === "es"
    ? "Spanish as spoken in central Mexico (San Miguel de Allende, Guanajuato). Natural Mexican words and turns of phrase; never Spain's vosotros or Spain-only words."
    : "American English.";
  return `Write ${n} different sentences for training a small text-to-speech voice. Language: ${variety}
Theme: ${about}.${angle ? ` Style: ${angle}.` : ""}
${names.length ? `Where a place's name fits, use names from this list (spelled exactly): ${names.join("; ")}.` : ""}
Each sentence: 4 to 22 words, punctuated as written text, varied in structure (statements, questions, exclamations, lists). Do not number them.
Avoid real people's names, brands other than the listed places, URLs and emoji.
Return JSON: {"sentences": ["...", "..."]}`;
}

const words = (s) => (s.match(/[\p{L}\p{N}'’-]+/gu) || []).length;
function check(lang, s) {
  if (typeof s !== "string") return "not text";
  const n = words(s);
  if (n < 3 || n > 28) return "length";
  if (/[<>@#{}\[\]|\\/_*]|https?:|\p{Extended_Pictographic}/u.test(s)) return "symbols";
  if (lang === "es") {
    const { bad } = sentencePhones(s, { names: NAMES, english: ["rooftop", "brunch", "happy", "hour", "wifi", "playlist", "check", "in", "the", "and", "coffee", "inside", "cart"] });
    if (bad.length) return "unsayable: " + bad.join(" ");
  }
  return null;
}

const plan = [];
for (const [theme, about] of ES_THEMES) for (let i = 0; i < 6; i++) plan.push(["es", theme, about, ANGLES[i % ANGLES.length]]);
for (const [theme, about] of EN_THEMES) for (let i = 0; i < 4; i++) plan.push(["en", theme, about, ANGLES[(i + 3) % ANGLES.length]]);
const limit = process.argv.includes("--calls") ? Number(process.argv[process.argv.indexOf("--calls") + 1]) : plan.length;

const out = { es: [], en: [] };
const seen = new Set();
for (const lang of ["es", "en"]) {
  const f = `${ROOT}training/script/${lang === "es" ? "es-mx" : "en"}.jsonl`;
  if (existsSync(f)) for (const l of readFileSync(f, "utf8").trim().split("\n").filter(Boolean)) { const r = JSON.parse(l); out[lang].push(r); seen.add(fold(r.text)); }
}
const rejected = {};
let next = 0, calls = 0;
const pick = (k) => [...NAMES].sort(() => Math.random() - 0.5).slice(0, k);
async function worker() {
  while (next < Math.min(plan.length, limit)) {
    const [lang, theme, about, angle] = plan[next++];
    if (spent() >= BUDGET - 1) return;
    const names = ["answers", "names", "questions", "music", "directions"].includes(theme) ? pick(18) : [];
    try {
      const r = await chat({ model: MODEL, user: prompt(lang, theme, about, 50, angle, names), maxTokens: 6000, purpose: `script ${lang} ${theme}` });
      calls++;
      for (const s of r.json?.sentences || []) {
        const why = check(lang, s);
        const key = fold(String(s));
        if (why) { rejected[why.split(":")[0]] = (rejected[why.split(":")[0]] || 0) + 1; continue; }
        if (seen.has(key)) { rejected.duplicate = (rejected.duplicate || 0) + 1; continue; }
        seen.add(key);
        out[lang].push({ id: `${lang}-${theme}-${String(out[lang].length + 1).padStart(5, "0")}`, lang: lang === "es" ? "es-MX" : "en-US", theme, text: s.trim(), source: MODEL });
      }
      process.stdout.write(`\r${calls} calls · es ${out.es.length} · en ${out.en.length} · $${spent().toFixed(3)}   `);
    } catch (e) { console.error(`\n${lang} ${theme}: ${e.message}`); }
  }
}
await Promise.all(Array.from({ length: 6 }, worker));
for (const lang of ["es", "en"]) {
  writeFileSync(`${ROOT}training/script/${lang === "es" ? "es-mx" : "en"}.jsonl`, out[lang].map((r) => JSON.stringify(r)).join("\n") + "\n");
}
console.log(`\ndone: ${calls} calls, es ${out.es.length}, en ${out.en.length}, rejected ${JSON.stringify(rejected)}, spent $${spent().toFixed(3)}`);
