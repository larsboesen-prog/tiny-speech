// How well the ears hear restaurant requests, measured the way the app uses them (training/asr/README.md, the gates):
// words heard right, places found from what was heard, and whether the reader understands the heard words as it understands
// what was actually said. Input: JSONL rows {id, lang, text (what was said), heard (what the recognizer wrote)}.
// node tools/asr-eval.mjs transcripts.jsonl [more.jsonl …]  → a table per file and language
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { fold } from "../core/text/sound.js";

/** Lowercase, no accents or punctuation, so "¿Qué onda?" and "que onda" count as the same words. */
export const norm = (t) => fold(String(t)).replace(/[^a-z0-9ñ' ]+/g, " ").replace(/\s+/g, " ").trim();
function edits(a, b) {
  const d = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
  for (let j = 1; j <= b.length; j++) d[0][j] = j;
  for (let i = 1; i <= a.length; i++) for (let j = 1; j <= b.length; j++) d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
  return d[a.length][b.length];
}

/** {sentences, wer, names: {sentences, found}, understood, language} for rows of one language. */
export async function evaluate(rows) {
  const { loadCore } = await import("../test/golden/mapsma.mjs");
  const { createAsker, requestOf } = await import("../domains/places/ask.js");
  const { decideLanguage, namesOf } = await import("../core/lang-decide.js");
  const { pack } = await loadCore();
  const asker = createAsker({ pack, random: () => 0.5 });
  const names = namesOf(pack);
  let errors = 0, total = 0, namedN = 0, found = 0, same = 0, langRight = 0;
  const misses = [];
  for (const r of rows) {
    const ref = norm(r.text).split(" ").filter(Boolean), hyp = norm(r.heard).split(" ").filter(Boolean);
    errors += edits(ref, hyp); total += ref.length;
    const want = pack.places.filter((p) => fold(r.text).includes(fold(p.name)));
    if (want.length === 1) {
      namedN++;
      const hit = asker.matchPlace(asker.parse(r.heard));
      if (hit?.p.id === want[0].id) found++;
      else misses.push(`${want[0].name} ← "${r.heard}"`);
    }
    if (JSON.stringify(requestOf(asker.parse(r.text))) === JSON.stringify(requestOf(asker.parse(r.heard)))) same++;
    if (r.lang === "mixed" || decideLanguage({ text: r.heard, names }).lang === r.lang) langRight++;
  }
  return { sentences: rows.length, wer: total ? errors / total : 0, names: { sentences: namedN, found }, understood: rows.length ? same / rows.length : 0,
    language: rows.length ? langRight / rows.length : 0, misses };
}

export const pct = (x) => `${(100 * x).toFixed(1)}%`;
export function line(label, e) {
  return `| ${label} | ${e.sentences} | ${pct(e.wer)} | ${e.names.sentences ? `${e.names.found}/${e.names.sentences} (${pct(e.names.found / e.names.sentences)})` : "—"} | ${pct(e.understood)} | ${pct(e.language)} |`;
}
export const HEADER = "| Set | Sentences | Word errors | Places found from what was heard | Understood as said | Language right |\n|---|---|---|---|---|---|";

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  console.log(HEADER);
  for (const file of process.argv.slice(2)) {
    const rows = readFileSync(file, "utf8").trim().split("\n").map((l) => JSON.parse(l));
    for (const lang of ["es", "mixed", "en"]) {
      const mine = rows.filter((r) => r.lang === lang);
      if (mine.length) console.log(line(`${file.split("/").pop()} ${lang}`, await evaluate(mine)));
    }
  }
}
