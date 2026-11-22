// Streets (owner, 22 Nov 2026: "show me restaurants on Umarán" failed; "Seems restaurants and street names fail"): a place's street comes
// from its address, a question names one after "on", "calle", "en la calle", and the answer lists the places on it. "Quality" means
// the good ones. And the ears' word list has the streets, the hotels and the list phrasing.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { streetOf, streetIndex, findStreet } from "../domains/places/streets.js";
import { loadCore } from "./golden/mapsma.mjs";
import { createAsker, nowAt } from "../domains/places/ask.js";
import { compiled } from "../domains/places/read.js";

const ROOT = fileURLToPath(new URL("..", import.meta.url));

test("a street from an address", () => {
  assert.deepEqual(streetOf("Umarán 8, Zona Centro"), { key: "umaran", name: "Umarán" });
  assert.deepEqual(streetOf("Hernández Macías 119, Centro"), { key: "hernandez macias", name: "Hernández Macías" });
  assert.deepEqual(streetOf("Mesones 11-B"), { key: "mesones", name: "Mesones" });
  assert.deepEqual(streetOf("Calz. de la Estación"), { key: "calzada de la estacion", name: "Calzada de la Estación" });
  assert.deepEqual(streetOf("Calle La Carreta 4"), { key: "la carreta", name: "La Carreta" });
  assert.deepEqual(streetOf("Hospicio 35 (Belmond Casa de Sierra Nevada)"), { key: "hospicio", name: "Hospicio" });
  assert.equal(streetOf("In the campo north of town (no street address)"), null);
  assert.equal(streetOf(""), null);
});

test("a street in a question, and only after the words that say it is one", () => {
  const ix = streetIndex([{ id: "8", address: "Umarán 8" }, { id: "9", address: "Hernández Macías 1" }, { id: "10", address: "Mesones 2" }]);
  assert.equal(findStreet("show me restaurants on umaran", ix).key, "umaran");
  assert.equal(findStreet("restaurantes en la calle umaran", ix).key, "umaran");
  assert.equal(findStreet("whats on hernandez macias street", ix).key, "hernandez macias");
  assert.equal(findStreet("bars on calle mesones", ix).key, "mesones");
  assert.equal(findStreet("mesones street", ix).key, "mesones");
  assert.equal(findStreet("is cafe umaran open", ix), null, "a name, not a street");
  assert.equal(findStreet("restaurants on umaran", ix).masked, "restaurants on §");
});

test("San Miguel: the places on a street; a name is still a name; quality means the good ones", async () => {
  const { pack } = await loadCore();
  const asker = createAsker({ pack, random: () => 0.5 });
  const now = nowAt(pack.tz, new Date("2026-11-21T20:00:00-06:00"));
  const streets = compiled(pack).streets;
  assert.ok(streets.streets.length >= 30, `${streets.streets.length} streets`);
  for (const [t, key, name] of [["show me restaurants on umaran", "umaran", "Umarán"], ["restaurants on mesones", "mesones", "Mesones"], ["what restaurants are on calle hidalgo", "hidalgo", "Hidalgo"]]) {
    const a = asker.answer(t, now);
    assert.equal(a.q.street.key, key, t);
    assert.match(a.show, new RegExp(` on ${name}\\.`), t);
    assert.ok(a.ids.length && a.ids.every((id) => streets.byId.get(id) === key), `${t}: ${a.ids}`);
  }
  const cafe = asker.answer("is cafe umaran open", now);
  assert.equal(cafe.kind, "one");
  assert.equal(cafe.q.street, undefined);
  assert.equal(asker.read("show me some quality restaurants", now).best, true);
});

test("the ears' English word list: streets and hotels both ways, English words also as spelled, list phrasing in the word pairs", () => {
  const en = JSON.parse(readFileSync(ROOT + "packs/dist/mx-sma/ears-lexicon-en.json", "utf8"));
  const es = JSON.parse(readFileSync(ROOT + "packs/dist/mx-sma/ears-lexicon-es.json", "utf8"));
  const langs = (L, w) => (L.words[w] || []).map((p) => p.lang + (p.cost ? `+${p.cost}` : "")).sort().join(",");
  assert.equal(langs(en, "mesones"), "en,es", "a street, either way at no cost on the English page");
  assert.equal(langs(es, "mesones"), "en+1,es", "the Spanish page: the English way costs");
  assert.ok(en.words.aqua && en.words.rosewood && en.words.quality, "hotels and 'quality'");
  assert.ok(en.words.restaurants.some((p) => p.cost === 1 && p.phones.join("") === "restawɾants"), "restaurants as spelled");
  assert.ok(!es.words.restaurants.some((p) => p.cost === 1 && p.phones.join("") === "restawɾants"), "the Spanish page: no spelled readings");
  assert.ok(en.bigrams["on mesones"] > 0 && en.bigrams["quality restaurants"] > 0, "restaurants on Mesones, quality restaurants");
});
