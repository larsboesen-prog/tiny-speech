// What was really said, as the teacher's sounds: the Spanish transcripts of the training speech (CIEMPIESS, the Google Latin
// American sets, the Piper requests) read by our Mexican Spanish rules (lang/es/ipa.js), as ids of the teacher's vocabulary.
// train.py adds a CTC loss on these, so the student learns the sounds actually spoken, not only the teacher's guesses (the
// teacher hears "perro" as "pero", "frío" as "fio": training/asr/probe/README.md). README.md here.
// English too (21 Nov 2026: the ears understood 67% of English requests against 87.5% of Spanish): English clips (LibriSpeech, the
// English Piper requests) and mixed sentences read by English voices (read_as "en") get their words' English sounds from tiny-voca's
// phonemizer, the same readings as the city's word list (tools/ears-lexicon.mjs), from the committed MX1 voice file (same tables).
// node phones.mjs WORK/manifest.jsonl vocab.json WORK/phones.jsonl   → {id, phones: [ids]} for each clip it can read
// Skipped (the teacher's labels alone teach those): mixed clips read by Spanish voices, and any clip with a word that cannot be read.
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { ipaWord } from "../../lang/es/ipa.js";
import { numberWordsEs } from "../../lang/es/sounds.js";
import { readGGUF } from "../../vendor/tiny-voca/js/tiny-voca.js";
import { fromGGUF } from "../../vendor/tiny-voca/js/dizione/engine.js";

const GGUF = fileURLToPath(new URL("../../vendor/tiny-voca/tiny-voca-mx1-2026-11-21.gguf", import.meta.url));
const english = await fromGGUF(readGGUF(new Uint8Array(readFileSync(GGUF)).buffer));
const enCache = new Map();
function enWord(w) {
  if (!enCache.has(w)) {
    let p = [];
    try { p = english.phonemize(w).symbols.filter((s) => !/^<|^[.,;:!?…—"'()]$/.test(s)); } catch { p = []; }
    enCache.set(w, p);
  }
  return enCache.get(w);
}

const [manifest, vocabPath, out] = process.argv.slice(2);
const vocab = JSON.parse(readFileSync(vocabPath, "utf8"));
const rows = readFileSync(manifest, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l));
let kept = 0, skipped = 0, keptEn = 0;
const lines = [];
for (const r of rows) {
  if (r.text && (r.lang === "en" || r.read_as === "en")) {  // English sounds
    const words = String(r.text).toLowerCase().match(/[\p{L}\p{N}']+/gu) || [];
    const ids = [];
    let ok = words.length > 0;
    for (const w of words.map((x) => x.replace(/^'+|'+$/g, "")).filter(Boolean)) {
      const p = /\d/.test(w) ? [] : enWord(w);
      if (!p.length || p.some((x) => !(x in vocab))) { ok = false; break; }
      ids.push(...p.map((x) => vocab[x]));
    }
    if (!ok) { skipped++; continue; }
    lines.push(JSON.stringify({ id: r.id, phones: ids }));
    kept++; keptEn++;
    continue;
  }
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
console.log(JSON.stringify({ clips_with_phones: kept, english: keptEn, skipped }));
