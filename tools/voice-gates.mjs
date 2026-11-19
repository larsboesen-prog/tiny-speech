// The names gate (training/RECIPE.md section 7, gate 2), run here on what the GPU's gates.py wrote: for every held-out
// sentence that names exactly one San Miguel place, does the reader still find that place in what Whisper heard the trained
// voice say? As for the English voice today, a name said so that the app cannot find it again is a failure.
// node tools/voice-gates.mjs training/result/gates/heard.jsonl   → prints the counts and the misses
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { fold } from "../core/text/sound.js";

export async function namesGate(heardRows) {
  const { loadCore } = await import("../test/golden/mapsma.mjs");
  const { createAsker } = await import("../domains/places/ask.js");
  const { pack } = await loadCore();
  const asker = createAsker({ pack, random: () => 0.5 });
  const named = (text) => pack.places.filter((p) => fold(text).includes(fold(p.name)));
  const rows = heardRows.map((r) => ({ ...r, places: named(r.text) })).filter((r) => r.places.length === 1);
  const misses = [];
  let found = 0;
  for (const r of rows) {
    const hit = asker.matchPlace(asker.parse(r.heard));
    if (hit?.p.id === r.places[0].id) found++;
    else misses.push(`${r.places[0].name} ← "${r.heard}"${hit ? ` (took it for ${hit.p.name})` : ""}`);
  }
  return { sentences: rows.length, found, share: rows.length ? found / rows.length : null, misses };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const file = process.argv[2];
  if (!file) { console.error("usage: node tools/voice-gates.mjs <gates/heard.jsonl>"); process.exit(1); }
  const rows = readFileSync(file, "utf8").trim().split("\n").map((l) => JSON.parse(l));
  for (const lang of ["es", "en"]) {
    const g = await namesGate(rows.filter((r) => r.lang === lang));
    console.log(`${lang}: the place found from what was heard in ${g.found} of ${g.sentences} sentences that name one place` +
      (g.share != null ? ` (${Math.round(100 * g.share)}%)` : ""));
    for (const m of g.misses.slice(0, 15)) console.log("  " + m);
  }
}
