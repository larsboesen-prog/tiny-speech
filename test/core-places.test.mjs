// The shared core's places domain (plan steps B2–B3): no city in its code, and every city-specific answer comes from the pack.
// (That it answers San Miguel's 434 questions exactly as MapSMA /page5 does is checked in golden.test.mjs.)
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { loadCore, CLOCKS } from "./golden/mapsma.mjs";
import { createAsker, nowAt, requestOf } from "../domains/places/ask.js";
import { fold } from "../core/text/sound.js";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const { pack } = await loadCore();
const clone = () => structuredClone(pack);

// Every JavaScript file under these folders, without its comments (comments may give a city's examples; code may not).
const CODE_DIRS = ["core", "domains", "lang"];
function codeFiles(dir) {
  return readdirSync(dir).flatMap((f) => {
    const p = join(dir, f);
    return statSync(p).isDirectory() ? codeFiles(p) : /\.m?js$/.test(f) ? [p] : [];
  });
}
const withoutComments = (src) => src.replace(/\/\*[\s\S]*?\*\//g, " ").split("\n").map((l) => l.replace(/(^|[\s;,)(}])\/\/.*$/, "$1")).join("\n");

// A city's proper nouns, from every pack's source: place names, other names, sight names, areas (not the centre's ordinary
// words), the city's names and its curated list's names.
function properNouns() {
  const out = new Set();
  for (const city of readdirSync(ROOT + "packs/src")) {
    const get = (f) => JSON.parse(readFileSync(`${ROOT}packs/src/${city}/${f}`, "utf8"));
    const c = get("city.json");
    for (const v of [...Object.values(c.names), ...c.langs.map((l) => c.text[l].city), ...c.langs.map((l) => c.text[l].centre)]) out.add(v);
    for (const p of get("places.json")) {
      out.add(p.name);  // not the other names a place is called by: many are ordinary words ("birria", "azotea", "the market")
      if (p.sentence) Object.values(p.sentence).forEach((v) => out.add(v));
    }
    for (const a of get("areas.json")) if (a.role !== "centre") out.add(a.id);
    for (const k of get("collections.json")) Object.values(k.text).forEach((t) => out.add(t.who));
  }
  return [...out].map((n) => fold(n).replace(/^(the|el|la|los|las) /, "").trim()).filter((n) => n.length > 3 && !ORDINARY_NAMES.has(n));
}
// Names that are also ordinary words the code needs: "The Restaurant", "the Jardín" (a garden), "La Azotea" (a rooftop) and stalls
// named after their dish (San Miguel); "The Garden" (Villa Ejemplo, the test town). Add to this list only a word that is ordinary in
// English or Spanish, with the place it comes from.
const ORDINARY_NAMES = new Set(["restaurant", "jardin", "azotea", "quesadillas", "esquites", "garden"]);

test("no city's proper noun appears in the core's code", () => {
  const nouns = properNouns();
  assert.ok(nouns.length > 100, `${nouns.length} proper nouns`);
  const hits = [];
  for (const dir of CODE_DIRS) {
    for (const file of codeFiles(ROOT + dir)) {
      const code = fold(withoutComments(readFileSync(file, "utf8")));
      for (const n of nouns) {
        const re = new RegExp(`(^|[^a-z0-9])${n.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}($|[^a-z0-9])`);
        if (re.test(code)) hits.push(`${file.slice(ROOT.length)}: "${n}"`);
      }
    }
  }
  assert.deepEqual(hits, []);
});

test("a city in another time zone answers by its own clock", () => {
  // The same pack an hour ahead (Bogotá, UTC−5): 15:10 there at T is 15:10 in San Miguel at T + 1 h.
  const ahead = { ...clone(), tz: "America/Bogota" };
  const there = createAsker({ pack: ahead, random: () => 0.5 });
  const here = createAsker({ pack: clone(), random: () => 0.5 });
  const T = Date.parse(CLOCKS["tue-14:10"]);
  for (const text of ["what is open now", "dinner tonight", "Is La Azotea open?", "breakfast tomorrow", "coffee now"]) {
    const a = there.answer(text, nowAt(ahead.tz, new Date(T)), null, null);
    const b = here.answer(text, nowAt(pack.tz, new Date(T + 3600e3)), null, null);
    assert.deepEqual(a.say, b.say, text);
  }
  const late = Date.parse(CLOCKS["sat-23:40"]);  // 23:40 in San Miguel is 00:40 in Bogotá
  const a = there.answer("what is open now", nowAt(ahead.tz, new Date(late)), null, null);
  const b = here.answer("what is open now", nowAt(pack.tz, new Date(late)), null, null);
  assert.notDeepEqual(a.all, b.all, "an hour's difference late at night changes what is open");
});

test("answers name the city, its centre and its curated list from the pack", () => {
  const p = clone();
  p.text.en = { city: "Testville", centre: "the Plaza", inCentre: " downtown", localClaim: "Every place here is chosen by people from Testville" };
  p.collections[0].text.en = { who: "Ana Pérez", picks: "Ana Pérez's picks", recentPicks: "Ana Pérez's newest picks", wrote: "Ana Pérez wrote about it in {month}" };
  const asker = createAsker({ pack: p, random: () => 0.5 });
  const now = nowAt(p.tz, new Date(CLOCKS["tue-14:10"]));
  const say = (text, here = null) => asker.answer(text, now, null, here).say.map((s) => s.text).join(" ");
  assert.match(say("where do locals eat"), /chosen by people from Testville/);
  assert.match(say("restaurants in Centro"), / downtown/);
  assert.match(say("three of Susan York's recent picks"), /Ana Pérez's (newest )?picks/);
  assert.match(say("Is La Azotea open?"), /Ana Pérez wrote about it in/);
  assert.match(say("how far is La Azotea", { lat: 19.43, lng: -99.13 }), /in Testville right now\. From the Plaza/);
  assert.doesNotMatch(say("where do locals eat") + say("restaurants in Centro"), /San Miguel|Centro|Jardín/);
});

test("areas, the centre's radius and walking speed come from the pack", () => {
  const p = clone();
  const now = nowAt(p.tz, new Date(CLOCKS["tue-14:10"]));
  const count = (pk, text) => createAsker({ pack: pk, random: () => 0.5 }).answer(text, now, null, null).all.length;
  const wide = { ...clone(), centre: { ...p.centre, radiusM: 3000 } };
  assert.ok(count(wide, "restaurants in Centro open now") > count(p, "restaurants in Centro open now"), "a wider centre holds more places");
  const renamed = clone();
  renamed.areas.find((a) => a.id === "guadalupe").words = ["barrio verde"];
  const q = (pk, text) => requestOf(createAsker({ pack: pk, random: () => 0.5 }).parse(text));
  assert.deepEqual(q(renamed, "rooftops in barrio verde").where, { area: "guadalupe" });
  assert.equal(q(renamed, "rooftops in guadalupe").where, undefined, "the old word is no longer an area");
  const slow = { ...clone(), walkMPerMin: 25 };
  const far = (pk) => createAsker({ pack: pk, random: () => 0.5 }).answer("how far is La Azotea", now, null, { lat: 20.9162, lng: -100.744 }).show;
  assert.notEqual(far(slow), far(p), "walking minutes follow the pack's speed");
});
