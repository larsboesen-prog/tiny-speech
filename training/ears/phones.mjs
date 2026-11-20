// What was really said, as the teacher's sounds: the Spanish transcripts of the training speech (CIEMPIESS, the Google Latin
// American sets, the Piper requests) read by our Mexican Spanish rules (lang/es/ipa.js), as ids of the teacher's vocabulary.
// train.py adds a CTC loss on these, so the student learns the sounds actually spoken, not only the teacher's guesses (the
// teacher hears "perro" as "pero", "frío" as "fio": training/asr/probe/README.md). README.md here.
// node phones.mjs WORK/manifest.jsonl vocab.json WORK/phones.jsonl   → {id, phones: [ids]} for each Spanish clip it can read
// Skipped (the teacher's labels alone teach those): English and mixed clips, and any clip with a word the rules cannot read.
import { readFileSync, writeFileSync } from "node:fs";
import { ipaWord } from "../../lang/es/ipa.js";
import { numberWordsEs } from "../../lang/es/sounds.js";

const [manifest, vocabPath, out] = process.argv.slice(2);
const vocab = JSON.parse(readFileSync(vocabPath, "utf8"));
const rows = readFileSync(manifest, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l));
let kept = 0, skipped = 0;
const lines = [];
for (const r of rows) {
  if (r.lang !== "es" || !r.text) { skipped++; continue; }
  const words = String(r.text).toLowerCase().replace(/(\d+)[.,](\d+)/g, "$1 punto $2").match(/[\p{L}\p{N}]+/gu) || [];
  const said = words.flatMap((w) => (/^\d+$/.test(w) ? (+w <= 100 ? numberWordsEs(+w).split(" ") : [null]) : [w]));
  const ids = [];
  let ok = said.length > 0;
  for (const w of said) {
    const p = w ? ipaWord(w).map((x) => x.replace("ˈ", "")) : [];
    if (!p.length || p.some((x) => !(x in vocab))) { ok = false; break; }
    ids.push(...p.map((x) => vocab[x]));
  }
  if (!ok) { skipped++; continue; }
  lines.push(JSON.stringify({ id: r.id, phones: ids }));
  kept++;
}
writeFileSync(out, lines.join("\n") + (lines.length ? "\n" : ""));
console.log(JSON.stringify({ clips_with_phones: kept, skipped }));
