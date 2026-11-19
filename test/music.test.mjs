// Live music (plan step B8): music nights in a city pack's live file, read and answered in English and Spanish; a city without
// music data answers every question as before (San Miguel's 1,756 golden answers are checked by golden.test.mjs).
import { test } from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { readFileSync } from "node:fs";
import { readSource, build } from "../tools/build-pack.mjs";
import { assemble } from "../core/pack/assemble.js";
import { validate } from "../core/pack/schema.js";
import { createAsker, nowAt } from "../domains/places/ask.js";
import { readMusic, GENRES } from "../domains/music/index.js";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const MUSIC = {
  venues: {
    T6: { genres: ["jazz"], slots: [{ days: [3, 4, 5], from: "20:00", to: "23:30" }], checked: "2026-11-10", source: "test" },
    T4: { genres: ["dj"], slots: [{ days: [4, 5], from: "22:00", to: "1:00" }], checked: "2026-11-10", source: "test" },
    T3: { genres: ["mariachi", "trova"], slots: [{ days: [6], from: "14:00", to: "17:00", genres: ["mariachi"] }, { days: [2], from: "19:00", to: "21:00", genres: ["trova"] }],
      checked: "2026-11-10", source: "test" },
    T9: { genres: ["acoustic"], slots: [], source: "to check" },  // no nights yet: left out
  },
};
const packOf = (music, date = "2026-11-19") => {
  const src = { ...readSource(ROOT + "packs/src/xx-test"), music };
  const b = build(src, { date });
  assert.ok(b.ok, b.errors?.join("\n"));
  const text = (suffix) => b.files[Object.keys(b.files).find((k) => k.endsWith(suffix))];
  return { b, pack: assemble(b.manifest, JSON.parse(text("base.json")), JSON.parse(Object.entries(b.files).find(([k]) => /live\.[0-9a-f]{8}\.json$/.test(k))[1])) };
};
const { b, pack } = packOf(MUSIC);
const en = createAsker({ pack, random: () => 0.5 });
const es = createAsker({ pack, random: () => 0.5, lang: "es" });
const at = (iso) => nowAt(pack.tz, new Date(iso));        // Villa Ejemplo is UTC−5
const FRI_1900 = at("2026-11-21T00:00:00Z"), SAT_0030 = at("2026-11-21T05:30:00Z"), TUE_1330 = at("2026-11-17T18:30:00Z");
const say = (r) => r.say.map((s) => s.text).join(" ");

test("music nights travel in the live file, only when a city has them", () => {
  const live = JSON.parse(Object.entries(b.files).find(([k]) => /live\./.test(k))[1]);
  assert.deepEqual(Object.keys(live.music).sort(), ["T3", "T4", "T6"], "a venue with no nights yet is left out");
  assert.deepEqual(live.music.T3.slots[0], { days: [6], from: "14:00", to: "17:00", genres: ["mariachi"] });
  assert.equal(live.music.T6.source, undefined, "where it came from stays in the source");
  assert.match(b.report, /Live music: 3 venues/);
  const plain = packOf(null).b;
  assert.ok(!/"music"/.test(Object.entries(plain.files).find(([k]) => /live\./.test(k))[1]), "no music.json: the live file is as before");
});

test("what a question asks about music", () => {
  assert.deepEqual(readMusic("any live jazz tonight?"), { genres: ["jazz"], when: { tonight: true } });
  assert.deepEqual(readMusic("¿Dónde hay mariachi el domingo?"), { genres: ["mariachi"], when: { day: 6 } });
  assert.deepEqual(readMusic("who's playing right now"), { genres: [], when: { now: true } });
  assert.deepEqual(readMusic("música en vivo mañana"), { genres: [], when: { tomorrow: true } });
  assert.equal(readMusic("sushi tonight what's open"), null);
  assert.equal(readMusic("is Café Brújula open?"), null);
  assert.equal(readMusic("chilaquiles with a lot of salsa"), null, "salsa alone is a sauce");
  assert.deepEqual(readMusic("where can we go bailar salsa on Friday").genres, ["salsa"]);
  assert.equal(readMusic("un café tranquilo, sin música fuerte"), null, "a quiet place is not a music question");
  assert.deepEqual(readMusic("noche bohemia con guitarras").genres, ["trova", "acoustic"]);
});

test("live music tonight, in English and Spanish", () => {
  const r = en.answer("live music tonight", FRI_1900, null, null);
  assert.equal(r.kind, "music");
  assert.deepEqual(r.ids, ["T6", "T4"], "in order of starting time");
  assert.equal(say(r), "Live music tonight: La Ribera Jazz, jazz, from 8 p.m. to 11:30 p.m. Terraza Volcán, a DJ, from 10 p.m. to 1 a.m.");
  const s = es.answer("¿Hay música en vivo esta noche?", FRI_1900, null, null);
  assert.equal(say(s), "Música en vivo esta noche: La Ribera Jazz, jazz, de las 8 de la noche a las 11 y media de la noche. " +
    "Terraza Volcán, DJ, de las 10 de la noche a la 1 de la madrugada.");
});

test("a genre, a day, now, and a named place", () => {
  assert.deepEqual(es.answer("¿Dónde hay mariachi el domingo?", TUE_1330, null, null).ids, ["T3"]);
  assert.match(say(es.answer("¿Dónde hay mariachi el domingo?", TUE_1330, null, null)), /Fonda del Puerto, mariachi, de las 2 de la tarde a las 5 de la tarde/);
  assert.equal(say(en.answer("jazz on Tuesday", TUE_1330, null, null)), "I don't have jazz on Tuesday on the list.");
  assert.equal(say(es.answer("¿dónde hay trova el miércoles?", TUE_1330, null, null)),
    "Trova el miércoles: Fonda del Puerto, trova, de las 7 de la noche a las 9 de la noche.");
  assert.match(say(en.answer("live jazz tonight", FRI_1900, null, null)), /^Jazz tonight: La Ribera Jazz, jazz, from 8 p\.m\. to 11:30 p\.m\.$/);
  assert.deepEqual(en.answer("who's playing now", SAT_0030, null, null).ids, ["T4"], "Friday's DJ is still playing at 0:30 on Saturday");
  assert.equal(say(en.answer("Is there music at Terraza Volcán?", TUE_1330, null, null)), "Terraza Volcán has a DJ: Fridays and Saturdays from 10 p.m. to 1 a.m.");
  assert.equal(say(es.answer("¿Hay música en la Fonda del Puerto?", TUE_1330, null, null)),
    "Fonda del Puerto tiene mariachi y trova: mariachi los domingos de las 2 de la tarde a las 5 de la tarde; trova los miércoles de las 7 de la noche a las 9 de la noche.");
  assert.equal(say(en.answer("Is there music at Café Brújula?", TUE_1330, null, null)), "I don't have live music at Café Brújula on the list.");
});

test("questions that are not about music answer exactly as without music data", () => {
  const plain = createAsker({ pack: packOf(null).pack, random: () => 0.5 });
  for (const q of ["Is Terraza Volcán open?", "pizza in Barrio Alto", "tacos tonight", "what is open now", "sushi tonight what's open"]) {
    assert.deepEqual(en.answer(q, FRI_1900, null, null), plain.answer(q, FRI_1900, null, null), q);
  }
});

test("an old music list says so", () => {
  const old = packOf({ venues: { T6: { ...MUSIC.venues.T6, checked: "2026-08-01" } } }, "2026-11-19").pack;
  const r = createAsker({ pack: old, random: () => 0.5 }).answer("jazz tonight", FRI_1900, null, null);
  assert.match(say(r), /The music list was last checked on August 1; worth confirming\./);
});

test("music.json is checked", () => {
  const src = readSource(ROOT + "packs/src/xx-test");
  const bad = { venues: {
    T99: { genres: ["jazz"], slots: [{ days: [1], from: "20:00", to: "22:00" }], checked: "2026-11-01" },
    T6: { genres: ["polka"], slots: [{ days: [7], from: "8pm", to: "22:00" }] },
  } };
  const { errors } = validate({ ...src, music: bad }, "2026-11-19", { genres: Object.keys(GENRES) });
  for (const want of [/unknown place T99/, /genre "polka"/, /days \[7\]/, /from "8pm"/, /T6 needs "checked"/]) assert.ok(errors.some((e) => want.test(e)), `${want}: ${errors.join(" | ")}`);
});

test("San Miguel's venue template checks clean and names the genres the reader knows", () => {
  const t = JSON.parse(readFileSync(ROOT + "packs/src/mx-sma/music.template.json", "utf8"));
  const listed = t._how.find((l) => /^3\./.test(l)).split(": ")[1].split(" ");
  assert.deepEqual(listed, Object.keys(GENRES));
  const { errors, warnings } = validate({ ...readSource(ROOT + "packs/src/mx-sma"), music: t }, "2026-11-19", { genres: Object.keys(GENRES) });
  assert.deepEqual(errors, []);
  assert.ok(warnings.some((w) => /waiting to be added to places\.json: Mama Mía/.test(w)));
});
