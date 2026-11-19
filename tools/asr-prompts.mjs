// The human part of the speech-recognition set (training/asr/README.md): what each native speaker records, as packets the
// recording page shows (training/record/?set=asr&packet=N). A packet is one speaker's session, about 12–15 minutes:
// 60 training sentences (each read by one speaker only, so the set grows with every speaker), 12 test sentences (the test
// split: never synthesized for training, the measure of the fine-tuned model) and 6 cards to say in their own words (with a
// typed transcript). Spanish and mixed only: the speakers are native Mexican Spanish speakers.
// node tools/asr-prompts.mjs   → training/asr/prompts.json
import { readFileSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const sha = (s) => createHash("sha256").update(s).digest("hex");
const words = (t) => (t.match(/[\p{L}\p{N}']+/gu) || []).length;
const order = (rows) => [...rows].sort((a, b) => sha("p1" + a.id).localeCompare(sha("p1" + b.id)));

// In their own words: what to ask for, not how to say it; {name} is a place of the city's pack.
export const CARDS = [
  "Pide algo para cenar esta noche cerca del centro, para cuatro personas, que no sea caro.",
  "Primero pide tacos; luego cámbialo y pide mariscos.",
  "Pregunta si {name} está abierto ahorita.",
  "Pregunta a qué hora cierra {name} hoy.",
  "Pide un lugar con terraza o con vista para ver el atardecer.",
  "Pide algo barato y rápido para comer, porque tienes prisa.",
  "Pide un lugar donde puedas ir con niños y con tu perro.",
  "Pregunta dónde hay música en vivo esta noche.",
  "Pide unas chelas y botana con tus amigos, como lo dirías tú.",
  "Pide desayuno para mañana temprano cerca de donde estás.",
  "Cambia la hora: primero di para las ocho, luego corrígete a las nueve y media.",
  "Pregunta cuál de las opciones está más cerca.",
  "Pide otras cuatro opciones.",
  "Pide comida vegetariana o vegana.",
  "Pide un buen mezcal y algo para cenar.",
  "Pregunta si {name} acepta tarjeta o reservaciones.",
  "Pide un café tranquilo para trabajar, con internet.",
  "Pide algo típico de Guanajuato para probar.",
  "Pide un lugar romántico para una cita, sin gastar mucho.",
  "Pregunta qué sigue abierto después de la medianoche.",
  "Pide pozole o enchiladas para la comida.",
  "Pide un lugar donde den comida corrida.",
  "Pregunta cómo llegar caminando a {name}.",
  "Di que no entendiste y pide que lo repita.",
];

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  // the split by sentence, as tools/asr-text.mjs gives it (also for a file still being written)
  const split = (t) => { const n = parseInt(sha("asr-split1" + t.toLowerCase()).slice(0, 8), 16) % 100; return n < 10 ? "test" : n < 15 ? "dev" : "train"; };
  const rows = readFileSync(ROOT + "training/asr/text/utterances.jsonl", "utf8").trim().split("\n").map((l) => JSON.parse(l))
    .map((r) => ({ ...r, split: r.split || split(r.text) })).filter((r) => r.lang !== "en");
  const places = JSON.parse(readFileSync(ROOT + "packs/src/mx-sma/places.json", "utf8")).filter((p) => p.kind !== "sights" && !p.other);
  const train = order(rows.filter((r) => r.split === "train")), test = order(rows.filter((r) => r.split === "test"));
  const packets = Math.ceil(train.length / 60);
  const out = [];
  for (let p = 0; p < packets; p++) {
    const mine = [
      ...train.slice(p * 60, p * 60 + 60).map((r) => ({ ...r, why: "read" })),
      ...Array.from({ length: 12 }, (_, k) => ({ ...test[(p * 12 + k) % test.length], why: "test" })),
    ];
    const cards = Array.from({ length: 6 }, (_, k) => {
      const c = CARDS[(p * 6 + k) % CARDS.length], place = places[(p * 7 + k * 3) % places.length].name;
      return { id: `asr-card-${(p * 6 + k) % CARDS.length}-p${p + 1}`, lang: "es", text: c.replace("{name}", place), why: "scenario" };
    });
    // the cards spread through the session (a change of task keeps the voice natural), the rest in their shuffled order
    const seq = [];
    mine.forEach((r, i) => { seq.push(r); if (i % 12 === 11 && cards.length) seq.push(cards.shift()); });
    seq.push(...cards);
    seq.forEach((r, i) => out.push({ n: out.length + 1, session: String(p + 1), id: r.why === "scenario" ? r.id : `${r.id}`, lang: r.lang, text: r.text, why: r.why,
      seconds: r.why === "scenario" ? null : +(words(r.text) / 2.5 + 1).toFixed(1), category: r.category || "card" }));
  }
  writeFileSync(ROOT + "training/asr/prompts.json", JSON.stringify(out, null, 0).replace(/},{/g, "},\n{") + "\n");
  const minutes = (p) => Math.round(out.filter((r) => r.session === p).reduce((s, r) => s + (r.seconds || 6), 0) / 60);
  console.log(`${packets} packets of ${out.length / packets} prompts (about ${minutes("1")} minutes of speech each): ${train.length} training sentences, each read once; ` +
    `${test.length} test sentences, each read by about ${Math.round((packets * 12) / test.length)} speakers; ${CARDS.length} cards.`);
}
