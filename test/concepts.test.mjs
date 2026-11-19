// Concepts and names added on 19 Nov 2026 from what the language-model test sets showed the reader missing (test/llm/REPORT.md):
// a thing no place has is said so, with the nearest thing offered; a thing the pack's facts have is found; a misheard name is
// found again; and no recorded /page5 answer changes (golden.test.mjs).
import { test } from "node:test";
import assert from "node:assert/strict";
import { loadCore } from "./golden/mapsma.mjs";
import { createAsker, nowAt, requestOf } from "../domains/places/ask.js";

const { pack } = await loadCore();
const en = createAsker({ pack, random: () => 0.5 }), es = createAsker({ pack, random: () => 0.5, lang: "es" });
const SAT_1900 = nowAt(pack.tz, new Date("2026-11-22T01:00:00Z"));
const say = (r) => r.say.map((s) => s.text).join(" ");
const what = (a, q) => requestOf(a.parse(q)).what || [];

test("a thing no place has is said so, and the nearest thing offered", () => {
  assert.match(say(en.answer("Where's a place that does pulque, the real fermented kind?", SAT_1900, null, null)), /^I couldn't find pulque on this site's list\. Here are \w+ places for mezcal and tequila\./);
  assert.match(say(en.answer("I want something spicy, like really spicy", SAT_1900, null, null)), /^I couldn't find very spicy food on this site's list\. Here are four places for Mexican food\./);
  assert.match(say(en.answer("My mom uses a walker, any restaurant that's easy to get into with no steps?", SAT_1900, null, null)), /^I couldn't find places that are easy to get into \(no steps\) on this site's list\./);
  assert.match(say(es.answer("Un lugar para ver el fútbol y micheladas bien frías", SAT_1900, null, null)), /^No encontré lugares para ver el partido en la lista de este sitio\. Aquí tienes un bar para cerveza\./);
  assert.match(say(en.answer("Where can I get something with squash blossoms?", SAT_1900, null, null)), /^I couldn't find squash blossoms on this site's list\./);
});

test("a thing the pack's facts have is found", () => {
  const corrida = es.answer("¿Dónde hay comida corrida baratita por la zona del mercado?", SAT_1900, null, null);
  assert.deepEqual(corrida.ids, ["X7"], "the market lists comida corrida among its dishes");
  assert.deepEqual(what(en, "something that tastes like grandma's kitchen"), ["tradmex"]);
  assert.deepEqual(what(es, "Ando con una cruda machísima, ¿dónde venden un menudo?"), ["hangover", "dish:menudo"]);
  assert.deepEqual(what(es, "¿Dónde puedo comer rico y rápido, que ando de prisa?"), ["quick"]);
  assert.deepEqual(what(es, "Tengo chamacos inquietos, ¿dónde comen rico?"), ["kids"]);
  assert.equal(requestOf(es.parse("Traigo como doscientos pesos, ¿dónde me llenan el estómago?")).price, "low");
  assert.equal(requestOf(en.parse("dinner for 2 with 1200 pesos")).price, "mid", "600 a person");
  assert.equal(requestOf(en.parse("breakfast tomorrow")).what, undefined, "breakfast is not fast food");
});

test("music genres reach the music answer, honestly when no listed night says which", () => {
  const rock = en.answer("Show me somewhere with live rock or blues", SAT_1900, null, null);
  assert.equal(rock.kind, "music");
  assert.match(say(rock), /^I don't have blues or rock nights on the list\. Raindog Cantina has blues or rock on some nights; I don't know which\./);
  assert.equal(en.answer("Where is the place to go for flamenco?", SAT_1900, null, null).kind, "music");
  assert.equal(en.answer("mariachi", SAT_1900, null, null).ids[0], "S2", "nobody lists mariachi: the Jardín, as /page5 answered");
});

test("misheard names are found again", () => {
  for (const [heard, id] of [["Rye Ces", "15"], ["Amor and Cacao", "31"], ["Back All", "38"], ["Vineyard San Miguel", "78"], ["The Restaurante", "80"],
    ["Kam Bei", "X1"], ["Can Bei", "X1"], ["Chureria Saint Augustine", "X10"], ["Terrace La Vista", "X15"], ["Terraza Lavista", "X15"]]) {
    assert.equal(en.matchPlace(en.parse(`Is ${heard} open?`))?.p.id, id, heard);
  }
  assert.notEqual(en.matchPlace(en.parse("where can I get noodle soup?"))?.p.id, "72", "'noodle' stays a dish word, not Nudol");
});
