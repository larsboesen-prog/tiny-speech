// Test sets written by a large model through OpenRouter (build time only), then run through the shared core:
//  1. mis-heard names: how speech to text might write each San Miguel place's name → does sound matching still find the place?
//  2. unexpected questions: natural questions about food, drink and live music, in English, Mexican Spanish and mixed → how many
//     does the reader understand, and which does it miss (a list to grow the concept tables from, review section 9)?
// NODE_USE_ENV_PROXY=1 node tools/make-tests.mjs [--run-only]   → test/llm/*.jsonl and test/llm/REPORT.md
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { chat, spent } from "./openrouter.mjs";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const OUT = ROOT + "test/llm/";
mkdirSync(OUT, { recursive: true });
const MODEL = process.env.TS_MODEL || "anthropic/claude-sonnet-5.5";
const places = JSON.parse(readFileSync(ROOT + "packs/src/mx-sma/places.json", "utf8"));
const runOnly = process.argv.includes("--run-only");

// ---------- 1. mis-heard names ----------
if (!runOnly || !existsSync(OUT + "misheard.jsonl")) {
  const rows = [];
  for (let i = 0; i < places.length; i += 24) {
    const batch = places.slice(i, i + 24).map((p) => p.name);
    const r = await chat({
      model: MODEL, purpose: "tests misheard names", maxTokens: 6000, temperature: 0.7,
      user: `These are names of restaurants, bars and sights in San Miguel de Allende, Mexico. For each name, write 4 ways a speech-to-text
model (like Whisper) might write it when someone says it aloud: 2 as an English speaker's question would be transcribed, 2 as a
Mexican Spanish speaker's. Make them realistic mistakes (split or joined words, sound-alike letters, dropped accents, English
words for Spanish sounds), not random. Names:
${batch.map((n, k) => `${k + 1}. ${n}`).join("\n")}
Return JSON: {"names": [{"name": "<as given>", "heard": ["...", "...", "...", "..."]}]}`,
    });
    for (const x of r.json?.names || []) {
      const p = places.find((q) => q.name === x.name);
      if (p) for (const h of x.heard || []) if (typeof h === "string" && h.trim()) rows.push({ id: p.id, name: p.name, heard: h.trim() });
    }
  }
  writeFileSync(OUT + "misheard.jsonl", rows.map((r) => JSON.stringify(r)).join("\n") + "\n");
}

// ---------- 2. unexpected questions ----------
if (!runOnly || !existsSync(OUT + "questions.jsonl")) {
  const rows = [];
  const kinds = [
    ["en", "English, as visitors and English-speaking residents talk", 120],
    ["es", "Mexican Spanish, as locals talk (ahorita, ¿qué onda?, chela, botana, antojitos, padre, chido)", 120],
    ["mixed", "Spanish and English mixed in one question, as bilingual people in a tourist town talk", 60],
  ];
  for (const [lang, how, n] of kinds) {
    for (let k = 0; k < n; k += 60) {
      const r = await chat({
        model: MODEL, purpose: `tests questions ${lang}`, maxTokens: 8000, temperature: 0.95,
        user: `Write 60 different questions people might ask a voice assistant about places to eat, drink or hear live music in
San Miguel de Allende, Mexico, that a simple app might NOT expect: unusual wording, slang, vague wishes, moods, dishes, drinks,
music genres, budgets, times ("after the concert", "before 9"), groups, kids, dogs, views, quiet or lively places. Language:
${how}. One question each; do not use any restaurant names. For each, list what it asks for in a few plain English words.
Return JSON: {"questions": [{"q": "...", "wants": ["tacos", "late at night", "cheap"]}]}`,
      });
      for (const x of r.json?.questions || []) if (typeof x.q === "string") rows.push({ lang, q: x.q.trim(), wants: x.wants || [] });
    }
  }
  writeFileSync(OUT + "questions.jsonl", rows.map((r) => JSON.stringify(r)).join("\n") + "\n");
}

// ---------- run them through the shared core ----------
const { loadCore, CLOCKS } = await import("../test/golden/mapsma.mjs");
const { createAsker, nowAt, requestOf } = await import("../domains/places/ask.js");
const { decideLanguage, namesOf } = await import("../core/lang-decide.js");
const { pack } = await loadCore();
const asker = createAsker({ pack, random: () => 0.5 });
const now = nowAt(pack.tz, new Date(CLOCKS["sat-23:40"].replace("05:40", "01:00")));
const read = (f) => readFileSync(OUT + f, "utf8").trim().split("\n").map((l) => JSON.parse(l));

const mis = read("misheard.jsonl");
let found = 0, offered = 0;
const lost = [];
for (const m of mis) {
  const q = /[áéíóúñ¿]|^(el|la|los|las)\b/i.test(m.heard) ? `¿Está abierto ${m.heard}?` : `Is ${m.heard} open?`;
  const pq = asker.parse(q), hit = asker.matchPlace(pq);
  if (hit && hit.p.id === m.id) found++;
  else if ((pq.nearNames || []).includes(m.id) || asker.answer(q, now, null, null).near?.includes(m.id)) offered++;
  else lost.push(`${m.name} ← "${m.heard}"${hit ? ` (took it for ${hit.p.name})` : ""}`);
}

const qs = read("questions.jsonl");
const names = namesOf(pack);
const stats = { en: [0, 0, 0, 0], es: [0, 0, 0, 0], mixed: [0, 0, 0, 0] };  // total, understood, answered, language right
const missed = [];
for (const x of qs) {
  const r = requestOf(asker.parse(x.q));
  const understood = Object.keys(r).some((k) => ["what", "kinds", "where", "when", "price", "unique", "local", "best", "place", "surprise", "exists"].includes(k));
  const a = asker.answer(x.q, now, null, null);
  const answered = !/^(I'm not sure|No estoy seguro)/.test(a.say?.[0]?.text || "");
  const lang = decideLanguage({ text: x.q, names }).lang;
  const s = stats[x.lang] || (stats[x.lang] = [0, 0, 0, 0]);
  s[0]++; if (understood) s[1]++; if (answered) s[2]++;
  if (x.lang === "mixed" || lang === x.lang) s[3]++;
  if (!understood) missed.push(`[${x.lang}] ${x.q} — wants: ${x.wants.join(", ")}`);
}
const pct = (a, b) => `${Math.round((100 * a) / Math.max(1, b))}%`;
const report = `# LLM-written test sets, run through the shared core

Written ${new Date().toISOString().slice(0, 10)} by \`tools/make-tests.mjs\` (questions and mis-hearings by ${MODEL} through OpenRouter;
OpenRouter spending so far, this repository: $${spent().toFixed(2)}). Answers at Saturday 19:00 in San Miguel.

## Mis-heard names (${mis.length}, for ${new Set(mis.map((m) => m.id)).size} places)

- Found the right place: **${found} (${pct(found, mis.length)})**
- Not found, but offered in "Did you mean …?": ${offered} (${pct(offered, mis.length)})
- Lost: ${lost.length} (${pct(lost.length, mis.length)})

Lost, as a list to learn from (aliases to add to the pack, or matching to improve):

${lost.map((l) => `- ${l}`).join("\n")}

## Unexpected questions (${qs.length})

| Language | Questions | Understood something (a topic, time, place, price…) | Answered (not "I'm not sure") | Language decided right |
|---|---|---|---|---|
${Object.entries(stats).map(([l, [t, u, a, g]]) => `| ${l} | ${t} | ${pct(u, t)} | ${pct(a, t)} | ${l === "mixed" ? "—" : pct(g, t)} |`).join("\n")}

Not understood at all, with what each asked for: the list to grow the concept tables from (review section 9, step 1).

${missed.map((m) => `- ${m}`).join("\n")}
`;
writeFileSync(OUT + "REPORT.md", report);
console.log(report.split("Lost, as a list")[0]);
console.log(report.split("## Unexpected questions")[1].split("Not understood at all")[0]);
console.log(`missed examples:\n${missed.slice(0, 12).join("\n")}`);
