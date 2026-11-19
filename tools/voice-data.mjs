// What the bilingual voice is trained on and tested with (training/RECIPE.md steps 3–7), as files the GPU pipeline reads
// (training/gpu/), with every sentence already in the model's sounds, so training uses exactly the tokens the page will use:
//   training/data/symbols.json    the 87-symbol vocabulary and how new rows start (engines/bilingual.js)
//   training/data/teacher.jsonl   what the teacher voice reads in the speaker's voice: the app's script (training/script/), and
//                                 general sentences: Common Voice Spanish and English (CC0)
//   training/data/originals.jsonl tiny-voca's own F2/M2 English clips mixed in so English does not drift (dataset batch 2)
//   training/data/holdout.jsonl   200 Spanish and 200 English app sentences kept out of training, for the gates
//   training/data/phonemes.jsonl  every text above → {lang, symbols, stress} (the GPU pipeline's "table" front end)
//   training/data/REPORT.md       counts, hours, sources and licences
// node tools/voice-data.mjs   (needs the network once: Common Voice from GitHub, tiny-voca's dataset from Hugging Face)
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { readGGUF } from "../vendor/tiny-voca/js/tiny-voca.js";
import { fromGGUF } from "../vendor/tiny-voca/js/dizione/engine.js";
import { SYMBOLS, SPANISH_VOWELS, SPANISH_CONSONANTS, LANG_ES, SPEAKER, INIT, spanishTokens, englishTokens } from "../engines/bilingual.js";
import { ipaWord } from "../lang/es/ipa.js";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const OUT = ROOT + "training/data/", CACHE = OUT + ".cache/";
mkdirSync(CACHE, { recursive: true });
const sha = (b) => createHash("sha256").update(b).digest("hex");
const jsonl = (rows) => rows.map((r) => JSON.stringify(r)).join("\n") + "\n";
const read = (f) => readFileSync(f, "utf8").trim().split("\n").filter(Boolean).map((l) => JSON.parse(l));
const words = (t) => (t.match(/[\p{L}\p{N}']+/gu) || []).length;
const WPS = 2.7;
// a stable shuffle: by a hash of the id
const order = (rows, key = (r) => r.id) => [...rows].sort((a, b) => sha("ts1" + key(a)).localeCompare(sha("ts1" + key(b))));

export const SOURCES = {
  commonVoiceEs: { url: "https://raw.githubusercontent.com/common-voice/common-voice/main/server/data/es/sentence-collector.txt", licence: "CC0-1.0" },
  commonVoiceEn: { url: "https://raw.githubusercontent.com/common-voice/common-voice/main/server/data/en/sentence-collector.txt", licence: "CC0-1.0" },
  tinyVocaScripts: { url: "https://huggingface.co/datasets/n4ze3m/tiny-voca/resolve/main/generation/batch2/scripts.jsonl", licence: "per row (source_license)" },
  tinyVocaAnnotations: { url: "https://huggingface.co/datasets/n4ze3m/tiny-voca/resolve/main/annotations/v4/train.jsonl", licence: "CC-BY-4.0 (dataset)" },
};
async function fetchCached(name) {
  const file = CACHE + name.replace(/\W+/g, "_");
  if (!existsSync(file)) {
    const r = await fetch(SOURCES[name].url);
    if (!r.ok) throw new Error(`${SOURCES[name].url}: ${r.status}`);
    writeFileSync(file, Buffer.from(await r.arrayBuffer()));
  }
  const bytes = readFileSync(file);
  return { text: bytes.toString("utf8"), sha256: sha(bytes) };
}

const key = (t) => t.normalize("NFKC").replace(/\s+/g, " ").trim();
const ES_OK = /^[\p{L}\p{N} ,.;:¿?¡!'"«»()—-]+$/u;
const SPAIN = /\b(vosotros|vosotras|os|habéis|sois|estáis|tenéis|podéis|queréis|vais|hacéis|decís|sabéis|ordenador|móvil|zumo|coger|vale|tío|tía|guay|chaval|piso)\b/i;

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const base = readGGUF(new Uint8Array(readFileSync(ROOT + "vendor/tiny-voca/tiny-voca-js.gguf")).buffer);
  const phonemizer = await fromGGUF(base);
  const pack = (f) => JSON.parse(readFileSync(ROOT + "packs/src/mx-sma/" + f, "utf8"));
  const places = pack("places.json"), lexicon = pack("lexicon.json");
  const city = { names: places.map((p) => p.name), english: lexicon.english || [], readings: lexicon.readings || {} };
  const englishWord = (w) => { const t = englishTokens(phonemizer, w); return t.symbols.map((s, i) => [s, t.stress[i]]).filter(([s]) => !/^<|^[.,;:!?…—"'()]$/.test(s)); };

  // ---------- the app's script, the recordings, the held-out sentences ----------
  const script = [...read(ROOT + "training/script/es-mx.jsonl").map((r) => ({ ...r, lang: "es" })), ...read(ROOT + "training/script/en.jsonl").map((r) => ({ ...r, lang: "en" }))];
  const recorded = new Set(JSON.parse(readFileSync(ROOT + "training/record/sentences.json", "utf8")).map((r) => r.id));
  const holdout = ["es", "en"].flatMap((l) => order(script.filter((r) => r.lang === l && !recorded.has(r.id) && words(r.text) >= 5)).slice(0, 200));
  const held = new Set(holdout.map((r) => r.id));
  const teacherScript = script.filter((r) => !held.has(r.id));

  // ---------- general Spanish: Common Voice (CC0), sayable, no Spain-only words ----------
  const cv = await fetchCached("commonVoiceEs");
  const cvRows = [...new Set(cv.text.split("\n").map(key))].filter((t) => { const n = words(t); return n >= 5 && n <= 18 && ES_OK.test(t) && !SPAIN.test(t) && !/\d/.test(t); })
    .filter((t) => (t.match(/[\p{L}']+/gu) || []).every((w) => ipaWord(w).length))
    .map((t) => ({ id: "cv-es-" + sha(t).slice(0, 12), lang: "es", theme: "general", text: t, source: "Common Voice es sentence-collector (CC0-1.0)" }));
  const generalEs = order(cvRows).slice(0, 2000);

  // ---------- general English, and tiny-voca's own English clips (batch 2: CC0 texts) ----------
  const scripts = await fetchCached("tinyVocaScripts");
  const b2 = scripts.text.trim().split("\n").map((l) => JSON.parse(l)).filter((r) => r.source_license === "cc0-1.0" && r.category === "reading" && words(r.text) >= 5 && words(r.text) <= 20);
  const ann = await fetchCached("tinyVocaAnnotations");
  const annRows = ann.text.trim().split("\n").map((l) => JSON.parse(l)).filter((r) => r.path.startsWith("b2/"));
  const b2ids = new Set(b2.map((r) => r.id));
  const clipsOf = new Map();
  for (const r of annRows) { const sid = r.id.replace(/_(F2|M2)$/, ""); if (b2ids.has(sid)) clipsOf.set(sid, [...(clipsOf.get(sid) || []), r]); }
  const withClips = order(b2.filter((r) => clipsOf.has(r.id)));
  const originals = withClips.flatMap((r) => clipsOf.get(r.id).map((c) => ({ id: c.id, speaker: c.speaker, lang: "en", text: c.text, frames: c.frames, path: c.path, upstream_symbols: c.symbols })));
  const cvEn = await fetchCached("commonVoiceEn");
  const used = new Set([...b2.map((r) => key(r.text))]);
  const generalEn = order([...new Set(cvEn.text.split("\n").map(key))].filter((t) => { const n = words(t); return n >= 5 && n <= 18 && /^[A-Za-z ,.;:?!'"()—-]+$/.test(t) && !used.has(t); })
    .map((t) => ({ id: "cv-en-" + sha(t).slice(0, 12), lang: "en", theme: "general", text: t, source: "Common Voice en sentence-collector (CC0-1.0)" }))).slice(0, 1000);

  const teacher = [...teacherScript.map((r) => ({ id: r.id, lang: r.lang, theme: r.theme, text: r.text, source: "training/script" })), ...generalEs, ...generalEn]
    .map((r) => ({ ...r, voice: SPEAKER }));

  // ---------- every text → tokens ----------
  const table = new Map(), conflicts = [], unknown = new Map();
  const add = (text, lang) => {
    const k = key(text);
    const t = lang === "es" ? spanishTokens(k, { english: englishWord, city }) : englishTokens(phonemizer, k);
    for (const u of t.unknown) unknown.set(u, (unknown.get(u) || 0) + 1);
    const row = { text: k, lang, symbols: t.symbols.join(" "), stress: t.stress };
    const was = table.get(k);
    if (was && was.symbols !== row.symbols) conflicts.push(k);
    else table.set(k, row);
  };
  for (const r of [...teacher, ...holdout]) add(r.text, r.lang);
  let same = 0;
  for (const r of originals) { add(r.text, "en"); if (table.get(key(r.text)).symbols === r.upstream_symbols) same++; }
  for (const k of conflicts) table.delete(k);

  // ---------- files ----------
  writeFileSync(OUT + "symbols.json", JSON.stringify({ symbols: SYMBOLS, spanish_vowels: SPANISH_VOWELS, spanish_consonants: SPANISH_CONSONANTS,
    language_token: LANG_ES, speaker: SPEAKER, init: INIT, released: { vocab_size: 76, speakers: ["F2", "M2"] } }, null, 1) + "\n");
  writeFileSync(OUT + "teacher.jsonl", jsonl(teacher));
  writeFileSync(OUT + "originals.jsonl", jsonl(originals.map(({ upstream_symbols, ...r }) => r)));
  writeFileSync(OUT + "holdout.jsonl", jsonl(holdout.map((r) => ({ id: r.id, lang: r.lang, theme: r.theme, text: r.text }))));
  writeFileSync(OUT + "phonemes.jsonl", jsonl([...table.values()]));
  const hours = (rows) => (rows.reduce((s, r) => s + words(r.text), 0) / WPS / 3600).toFixed(2);
  const origHours = (originals.reduce((s, r) => s + r.frames, 0) * 256 / 24000 / 3600).toFixed(2);
  const count = (rows, l) => rows.filter((r) => r.lang === l).length;
  const report = `# Training data for the bilingual voice

Written by \`tools/voice-data.mjs\`. The GPU pipeline (\`training/gpu/\`) reads these files as they are.

| What | Spanish | English | About (hours) |
|---|---|---|---|
| The speaker's recordings (\`training/record/\`, made on the day) | ${JSON.parse(readFileSync(ROOT + "training/record/sentences.json", "utf8")).filter((r) => r.lang === "es").length} | ${JSON.parse(readFileSync(ROOT + "training/record/sentences.json", "utf8")).filter((r) => r.lang === "en").length} | up to 0.75 |
| The teacher reads, in the speaker's voice: the app's script | ${count(teacherScript, "es")} | ${count(teacherScript, "en")} | ${hours(teacherScript)} |
| … and general sentences (Common Voice, Spanish and English) | ${generalEs.length} | ${generalEn.length} | ${hours([...generalEs, ...generalEn])} |
| tiny-voca's own F2 and M2 English clips, so English does not drift | — | ${originals.length} | ${origHours} |
| Held out for the gates (never trained on) | ${count(holdout, "es")} | ${count(holdout, "en")} | — |

- Phoneme table: ${table.size} texts → tokens in the ${SYMBOLS.length}-symbol vocabulary; ${conflicts.length} texts dropped because they read
  differently in the two languages; unknown sounds: ${[...unknown].map(([u, n]) => `${u} ${n}`).join(", ") || "none"}.
- English tokens come from tiny-voca's own phonemizer in JavaScript (as the page uses it); for the F2/M2 clips they match the
  dataset's own annotation (made by the Python phonemizer) for ${same} of ${originals.length} clips.
- Sources: Common Voice sentence-collector.txt, CC0-1.0: Spanish sha256 \`${cv.sha256}\`, English sha256 \`${cvEn.sha256}\`;
  tiny-voca dataset batch-2 scripts (which clips have CC0 texts), sha256 \`${scripts.sha256}\`; its annotations v4 (which batch-2 clips exist),
  sha256 \`${ann.sha256}\`. The dataset is CC BY 4.0 (credit: n4ze3m/tiny-voca); the app's script was written for this project.
- Common Voice filter: 5–18 words, Spanish letters only, no numbers, every word sayable by the rules, no Spain-only words
  (vosotros forms, ordenador, zumo…).
`;
  writeFileSync(OUT + "REPORT.md", report);
  console.log(report);
}
