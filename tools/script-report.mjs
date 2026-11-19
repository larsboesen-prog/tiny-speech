// What the bilingual voice's training script covers: sounds and pairs of sounds in Mexican Spanish (lang/es/ipa.js, the sounds the
// trained voice will learn) and in English (tiny-voca's own phonemizer), and about how many hours of speech it makes.
// node tools/script-report.mjs  → training/script/REPORT.md   (English needs the model file: npm run fetch:voice)
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { ipaSentence, INVENTORY } from "../lang/es/ipa.js";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const rows = (f) => readFileSync(ROOT + "training/script/" + f, "utf8").trim().split("\n").filter(Boolean).map((l) => JSON.parse(l));
const WORDS_PER_SECOND = 2.7;  // tiny-voca read a 9-word Spanish sentence in 3.4 s (live test, 19 Nov 2026)
const wordsOf = (t) => (t.match(/[\p{L}\p{N}']+/gu) || []).length;

function count(sequences) {
  const one = new Map(), two = new Map();
  for (const seq of sequences) {
    seq.forEach((p, i) => {
      one.set(p, (one.get(p) || 0) + 1);
      if (i) { const k = seq[i - 1].replace("ˈ", "") + " " + p.replace("ˈ", ""); two.set(k, (two.get(k) || 0) + 1); }
    });
  }
  return { one, two };
}

const es = rows("es-mx.jsonl"), en = rows("en.jsonl");
const esSeq = es.map((r) => ipaSentence(r.text).flat());
const esC = count(esSeq);
const plain = (p) => p.replace("ˈ", "");
const esPhones = new Map();
for (const [p, n] of esC.one) esPhones.set(plain(p), (esPhones.get(plain(p)) || 0) + n);
const missing = INVENTORY.filter((p) => !esPhones.has(p));
const rare = [...esPhones].filter(([, n]) => n < 100).sort((a, b) => a[1] - b[1]);
const stressed = ["a", "e", "i", "o", "u"].map((v) => `ˈ${v} ${esC.one.get("ˈ" + v) || 0}`).join(", ");
const esWords = es.reduce((n, r) => n + wordsOf(r.text), 0);

let enLines = ["English needs the model file (npm run fetch:voice): not counted."];
const GGUF = ROOT + "vendor/tiny-voca/tiny-voca-js.gguf";
let enWords = en.reduce((n, r) => n + wordsOf(r.text), 0);
if (existsSync(GGUF)) {
  const { createVoice } = await import("../engines/tinyvoca-js.js");
  const voice = await createVoice(new Uint8Array(readFileSync(GGUF)).buffer);
  const seqs = en.map((r) => voice.phones(r.text).split(/\s+/).filter((p) => p && !/^(<sp>|\||[.,!?;:"'()—…])$/.test(p)));
  const enC = count(seqs);
  const enPhones = new Map();
  for (const [p, n] of enC.one) enPhones.set(plain(p).replace("ˌ", ""), (enPhones.get(plain(p).replace("ˌ", "")) || 0) + n);
  const enRare = [...enPhones].filter(([, n]) => n < 30).sort((a, b) => a[1] - b[1]);
  enLines = [
    `${en.length} sentences, ${enWords} words, about ${(enWords / WORDS_PER_SECOND / 3600).toFixed(2)} hours of speech.`,
    `${enPhones.size} of tiny-voca's phones used; ${enC.two.size} different pairs of sounds.`,
    `Phones seen under 30 times: ${enRare.map(([p, n]) => `${p} ${n}`).join(", ") || "none"}.`,
  ];
}

const themes = (list) => Object.entries(list.reduce((m, r) => ((m[r.theme] = (m[r.theme] || 0) + 1), m), {})).map(([t, n]) => `${t} ${n}`).join(", ");
const costs = readFileSync(ROOT + "training/costs.jsonl", "utf8").trim().split("\n").map((l) => JSON.parse(l));
const scriptCost = costs.filter((c) => /^script/.test(c.purpose)).reduce((s, c) => s + (c.cost || 0), 0);
const report = `# The bilingual voice's training script: coverage

Written ${new Date().toISOString().slice(0, 10)} by \`tools/script-report.mjs\`. Sentences by Claude Sonnet 5.5 through OpenRouter
(\`tools/make-script.mjs\`, $${scriptCost.toFixed(2)}), each checked by rules before it was kept.

## Mexican Spanish (\`es-mx.jsonl\`)

${es.length} sentences, ${esWords} words, about ${(esWords / WORDS_PER_SECOND / 3600).toFixed(2)} hours of speech. Themes: ${themes(es)}.

- Sounds (lang/es/ipa.js's ${INVENTORY.length}): ${missing.length ? "missing " + missing.join(", ") : "all present"}.
- Stressed vowels: ${stressed}.
- ${esC.two.size} different pairs of sounds.
- Sounds seen under 100 times: ${rare.map(([p, n]) => `${p} ${n}`).join(", ") || "none"}.

| Sound | Count |
|---|---|
${[...esPhones].sort((a, b) => b[1] - a[1]).map(([p, n]) => `| ${p} | ${n} |`).join("\n")}

## English (\`en.jsonl\`)

${enLines.join("\n")}
Themes: ${themes(en)}.

## What this is for, and what it is not

These sentences are what the one bilingual voice must say well: the app's own answers, questions, hours, directions, dishes,
numbers and San Miguel's names, in Mexican Spanish and English. Training also needs general speech (upstream tiny-voca read
17.6 hours, mostly LibriTTS-R and Common Voice sentences); the script adds the app's domain, in Spanish first. See
\`training/RECIPE.md\` for the steps that remain (a teacher voice to read it, then training on a GPU).
`;
writeFileSync(ROOT + "training/script/REPORT.md", report);
console.log(report.split("## English")[0].slice(0, 1400));
console.log(enLines.join("\n"));
