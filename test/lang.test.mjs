// Language packs and the language decision (plan step B6).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import * as en from "../lang/en/index.js";
import * as es from "../lang/es/index.js";
import { decideLanguage, namesOf, maskNames } from "../core/lang-decide.js";
import { LABELLED } from "./lang/labelled.mjs";
import { loadCore } from "./golden/mapsma.mjs";

const { pack } = await loadCore();
const names = namesOf(pack);

test("English clock times are read", () => {
  const cases = {
    "breakfast tomorrow at 9": [540, false], "dinner at 8:30 pm": [1230, true], "at 7 in the morning": [420, true], "half past nine": [570, false],
    "quarter to nine": [525, false], "ten to nine tonight": [1250, true], "at noon": [720, true], "until midnight": [0, true], "at 21:15": [1275, true],
    "I am hungry at 7": [420, false], "a table for 6 people": null, "open now": null,
  };
  for (const [text, want] of Object.entries(cases)) assert.deepEqual(en.readClock(text) && [en.readClock(text).m, en.readClock(text).sure], want, text);
});

test("Spanish clock times are read, in Mexico's way and Spain's", () => {
  const cases = {
    "desayuno mañana a las 9": [540, false], "cuarto para las nueve": [525, false], "diez para las nueve de la noche": [1250, true],
    "las nueve menos cuarto": [525, false], "a las diez de la noche": [1320, true], "al mediodía": [720, true], "a medianoche": [0, true],
    "a la una y media de la tarde": [810, true], "a las 9 y 45": [585, false], "a las ocho en punto de la mañana": [480, true],
    "las 12 y media de la noche": [30, true], "comida para dos": null, "ahorita": null,
  };
  for (const [text, want] of Object.entries(cases)) assert.deepEqual(es.readClock(text) && [es.readClock(text).m, es.readClock(text).sure], want, text);
});

test("every minute said by the voice is read back as the same minute", () => {
  for (let m = 0; m < 1440; m++) {
    assert.equal(en.readClock(en.sayTime(m))?.m, m, en.sayTime(m));
    assert.equal(es.readClock(es.sayTimeEs(m))?.m, m, es.sayTimeEs(m));
  }
});

test("numbers are read in both languages", () => {
  assert.deepEqual(["twenty five", "45", "oh five", "twelve"].map(en.numberOf), [25, 45, 5, 12]);
  assert.deepEqual(["veinticinco", "treinta y dos", "45", "una"].map(es.numberOf), [25, 32, 45, 1]);
});

test("with the city's names masked, the words alone pick the right language for every labelled question", () => {
  const miss = LABELLED.filter(([q, l]) => decideLanguage({ text: q, names }).lang !== l);
  assert.deepEqual(miss, []);
  assert.ok(LABELLED.length > 400, `${LABELLED.length} questions`);
  const unmasked = LABELLED.filter(([q, l]) => decideLanguage({ text: q }).lang !== l).map(([q]) => q);
  assert.ok(unmasked.includes("Panadería El Maple tomorrow"), "without masking, a Spanish name makes an English question look Spanish");
  assert.equal(maskNames("Is La Azotea open tonight?", names), "is open tonight");
});

test("the recognizer's scores weigh more than the words; a manual choice overrides all; no evidence keeps the last language", () => {
  assert.equal(decideLanguage({ text: "is it open", langScores: { en: 0.1, es: 0.9 } }).lang, "es");
  const close = decideLanguage({ text: "is it open now", langScores: { en: 0.42, es: 0.58 } });
  assert.deepEqual([close.lang, close.rerun], ["en", true], "close and disagreeing: transcribe once more");
  assert.equal(decideLanguage({ text: "¿qué hay abierto?", override: "en" }).lang, "en");
  assert.equal(decideLanguage({ text: "La Azotea", names, prior: "es" }).lang, "es");
  assert.equal(decideLanguage({ text: "La Azotea", names, prior: "en" }).lang, "en");
});

test("the Mexican variety table says what differs", () => {
  const mx = JSON.parse(readFileSync(new URL("../lang/es/mx.json", import.meta.url), "utf8"));
  assert.equal(mx.locale, "es-MX");
  for (const w of ["ahorita", "al rato", "mande", "almuerzo", "comida"]) assert.ok(mx.words[w], w);
  assert.match(mx.clock.para, /8:45/);
});
