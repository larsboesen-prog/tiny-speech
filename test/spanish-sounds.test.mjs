// Spanish sentences in tiny-voca's sounds (plan step B7).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { PHONES, lexiconFor, sentencePhones, numberWordsEs } from "../lang/es/sounds.js";
import { spanishLexicon } from "./fixtures/before/mapsma-page5/spanish.js";
import { loadCore } from "./golden/mapsma.mjs";

const { pack } = await loadCore();
const opts = { english: pack.lexicon.english, readings: pack.lexicon.readings, names: pack.places.map((p) => p.name) };
const validPhones = (ph) => ph.split(" ").every((u) => PHONES.has(u.replace(/^[ˈˌ]/, "")));

test("place names sound exactly as MapSMA taught them", () => {
  const names = [...pack.places.map((p) => p.name), "Centro", "Jardín", "San Miguel de Allende"];
  assert.deepEqual(lexiconFor(names, opts), spanishLexicon(names));
});

test("every Spanish answer in the golden snapshot can be said in the voice's sounds", () => {
  const cases = readFileSync(new URL("./golden/mapsma.snapshot.jsonl", import.meta.url), "utf8").trim().split("\n").map((l) => JSON.parse(l));
  const sentences = new Set(cases.filter((c) => c.key.lang === "es").flatMap((c) => c.turns.flatMap((t) => (t.answer.say || []).map((x) => x.text))));
  assert.ok(sentences.size > 300, `${sentences.size} sentences`);
  let words = 0, english = 0;
  for (const s of sentences) {
    const { pieces, bad } = sentencePhones(s, opts);
    assert.deepEqual(bad, [], s);
    for (const p of pieces) {
      if (p.mark) continue;
      words++;
      if (p.lang === "en") { english++; continue; }
      assert.ok(validPhones(p.phones), `${s}: ${p.word} /${p.phones}/`);
    }
  }
  // English words inside names ("Andy's Taco Cart", "Inside Café", "Sushi Gami"): 100 of 5,862 on 19 Nov 2026
  assert.ok(english < words * 0.03, `${english} of ${words} words left to English`);
});

test("English stays English only inside a place's name", () => {
  const pieces = sentencePhones("Don Taco Tequila, tacos veganos; Tostévere, tacos de mariscos con tequila", opts).pieces.filter((p) => p.word);
  assert.deepEqual(pieces.filter((p) => p.lang === "en").map((p) => p.word), ["Taco", "Tequila"]);
});

test("numbers are said as Spanish words", () => {
  const cases = { 0: "cero", 1: "uno", 21: "veintiuno", 45: "cuarenta y cinco", 100: "cien", 101: "ciento uno", 350: "trescientos cincuenta",
    1000: "mil", 2026: "dos mil veintiséis", 21000: "veintiún mil" };
  for (const [n, w] of Object.entries(cases)) assert.equal(numberWordsEs(+n), w, n);
  assert.equal(numberWordsEs(21, { fem: true }), "veintiuna");
  const said = sentencePhones("abre a la 1 de la tarde, a unos 350 metros").pieces.filter((p) => p.word).map((p) => p.word).join(" ");
  assert.equal(said, "abre a la una de la tarde a unos trescientos cincuenta metros");
});

test("small words are unstressed in a sentence; accented ones keep their stress", () => {
  const ph = Object.fromEntries(sentencePhones("a la una con Susan, ¿cómo llego a dónde?", opts).pieces.filter((p) => p.word).map((p) => [p.word, p.phones]));
  assert.ok(!ph.a.includes("ˈ") && !ph.con.includes("ˈ"));
  assert.ok(ph["cómo"].includes("ˈ") && ph["dónde"].includes("ˈ"));
});
