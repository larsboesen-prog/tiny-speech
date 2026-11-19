// Which sentences the speaker records, in which order (training/RECIPE.md step 4, a real voice): from the training script, the
// sentences that add the most new sounds and pairs of sounds, and San Miguel's place names, first, so a session that stops
// early has still recorded the most useful ones. About two Spanish to one English; short sentences preferred over long ones.
// node tools/pick-recording.mjs [--count 500] [--session 125]   → training/record/sentences.json and sentences.md
// English sounds need the model file (npm run fetch:voice).
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { ipaSentence } from "../lang/es/ipa.js";
import { fold } from "../core/text/sound.js";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? +process.argv[i + 1] : d; };
const COUNT = arg("--count", 500), SESSION = arg("--session", 125), RESERVE = 150;
const rows = (f) => readFileSync(ROOT + "training/script/" + f, "utf8").trim().split("\n").map((l) => JSON.parse(l));
const words = (t) => (t.match(/[\p{L}\p{N}']+/gu) || []).length;
const WPS = 2.7;  // words a second at a calm reading pace

const { createVoice } = await import("../engines/tinyvoca-js.js");
const voice = await createVoice(new Uint8Array(readFileSync(ROOT + "vendor/tiny-voca/tiny-voca-js.gguf")).buffer);
const enPhones = (t) => voice.phones(t).split(/\s+/).filter((p) => p && !/^(<sp>|\||[.,!?;:"'()—…¿¡])$/.test(p)).map((p) => p.replace("ˌ", ""));
const esPhones = (t) => ipaSentence(t).flat();

// San Miguel's names, word by word (a real voice saying them is worth more than a cloned one guessing)
const places = JSON.parse(readFileSync(ROOT + "packs/src/mx-sma/places.json", "utf8"));
const SMALL = new Set("la el los las de del y the and san cafe casa bar".split(" "));
const nameWords = new Set(places.flatMap((p) => fold(p.name).split(/[^a-z0-9ñ]+/)).filter((w) => w.length > 2 && !SMALL.has(w)));

const units = (lang, text) => {
  const ph = lang === "es" ? esPhones(text) : enPhones(text);
  const u = new Set(ph.map((p) => `${lang}:${p}`));
  ph.forEach((p, i) => i && u.add(`${lang}:${ph[i - 1].replace("ˈ", "")}+${p.replace("ˈ", "")}`));
  for (const w of fold(text).split(/[^a-z0-9ñ]+/)) if (nameWords.has(w)) u.add(`name:${w}`);
  return u;
};
const pool = [
  ...rows("es-mx.jsonl").map((r) => ({ ...r, l: "es" })),
  ...rows("en.jsonl").map((r) => ({ ...r, l: "en" })),
].filter((r) => { const n = words(r.text); return n >= 5 && n <= 16; }).map((r) => ({ ...r, units: units(r.l, r.text), n: words(r.text) }));
const weight = (u) => (u.startsWith("name:") ? 2 : u.includes("+") ? 1 : 4);  // a new sound counts most, then a name, then a pair

const seen = new Set(), used = new Set(), out = [];
const take = (r, why) => { used.add(r.id); r.units.forEach((u) => seen.add(u)); out.push({ id: r.id, lang: r.l, theme: r.theme, text: r.text, why, seconds: +(r.n / WPS + 1).toFixed(1) }); };
const best = (l, filter = () => true) => {
  let top = null, topScore = -1;
  for (const r of pool) {
    if (r.l !== l || used.has(r.id) || !filter(r)) continue;
    let gain = 0;
    for (const u of r.units) if (!seen.has(u)) gain += weight(u);
    const score = gain / (r.n + 4);  // new material per second, roughly
    if (score > topScore) { top = r; topScore = score; }
  }
  return top;
};

// 1. reference clips for copying the voice: calm, complete sentences, 10–16 words, six Spanish and four English
for (const [l, k] of [["es", 6], ["en", 4]]) for (let i = 0; i < k; i++) take(best(l, (r) => r.n >= 10 && ["answers", "replies", "news", "hours"].includes(r.theme)), "reference");
// 2. the rest by what each adds, two Spanish then one English
for (let i = 0; out.length < COUNT + RESERVE; i++) { const r = best(i % 3 === 2 ? "en" : "es"); if (!r) break; take(r, i % 3 === 2 ? "en" : "es"); }

const list = out.map((r, i) => ({ n: i + 1, session: i < COUNT ? Math.floor(i / SESSION) + 1 : "extra", ...r }));
mkdirSync(ROOT + "training/record", { recursive: true });
writeFileSync(ROOT + "training/record/sentences.json", JSON.stringify(list, null, 0).replace(/},{/g, "},\n{") + "\n");

const main = list.filter((r) => r.session !== "extra");
const covered = (rs, prefix) => new Set(rs.flatMap((r) => [...units(r.lang, r.text)].filter((u) => u.startsWith(prefix)))).size;
const allCov = (prefix) => new Set(pool.flatMap((r) => [...r.units].filter((u) => u.startsWith(prefix)))).size;
const mins = (rs) => Math.round(rs.reduce((s, r) => s + r.seconds, 0) / 60);
const sessions = [...new Set(main.map((r) => r.session))];
const md = [`# Sentences to record`, "",
  `Made by \`tools/pick-recording.mjs\` from the training script. ${main.length} sentences in ${sessions.length} sessions (about ${mins(main)} minutes of speech; with`,
  `retakes and breaks, about ${Math.round(mins(main) * 2.5 / 60 * 10) / 10} hours), then ${list.length - main.length} extra if the speaker has energy left. The recording page`,
  "(`index.html`) shows them one at a time; this list is the paper copy.", "",
  `Coverage of the whole script: Spanish sounds ${covered(main, "es:").toString()} of ${allCov("es:")} sounds and pairs, English ${covered(main, "en:")} of ${allCov("en:")},`,
  `San Miguel name words ${covered(main, "name:")} of ${allCov("name:")}. Spanish ${main.filter((r) => r.lang === "es").length}, English ${main.filter((r) => r.lang === "en").length}.`, "",
  ...sessions.flatMap((s) => [`## Session ${s} (about ${mins(main.filter((r) => r.session === s))} minutes of speech)`, "",
    ...main.filter((r) => r.session === s).map((r) => `${r.n}. ${r.lang === "es" ? "🇲🇽" : "🇺🇸"} ${r.text}${r.why === "reference" ? "  *(reference: read it calmly and naturally)*" : ""}`), ""]),
  "## Extra", "", ...list.filter((r) => r.session === "extra").map((r) => `${r.n}. ${r.lang === "es" ? "🇲🇽" : "🇺🇸"} ${r.text}`), ""];
writeFileSync(ROOT + "training/record/sentences.md", md.join("\n"));
console.log(md.slice(0, 8).join("\n"));
