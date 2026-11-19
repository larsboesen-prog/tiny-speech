// City packs (plan step B1): San Miguel's pack holds what MapSMA's files hold, builds within its budget, matches the committed
// dist/, and the validator refuses broken sources.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createHash, randomBytes } from "node:crypto";
import { fileURLToPath } from "node:url";
import { build, readSource } from "../tools/build-pack.mjs";
import { validate } from "../core/pack/schema.js";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const src = readSource(ROOT + "packs/src/mx-sma");
const index = JSON.parse(readFileSync(ROOT + "packs/dist/index.json", "utf8"));
const entry = index.cities.find((c) => c.id === "mx-sma");
const DATE = entry.version.slice(0, 10);
const clone = () => JSON.parse(JSON.stringify(src));

test("San Miguel's pack holds every MapSMA place, with its position, kind and facts, and the places added since", () => {
  const data = JSON.parse(readFileSync(ROOT + "test/fixtures/before/mapsma-page5/data.json", "utf8"));
  const ADDED = ["X19", "X20", "X21", "X22"];  // live music venues, 19 Nov 2026 (the owner's decision D8)
  assert.deepEqual(src.places.map((p) => p.id).filter((id) => !data.PLACES.some((p) => p.id === id)), ADDED);
  for (const id of ADDED) assert.ok(src.places.find((p) => p.id === id).info.source, `place ${id} says where it came from`);
  for (const p of data.PLACES) {
    const q = src.places.find((x) => x.id === p.id);
    assert.ok(q, `place ${p.id}`);
    assert.deepEqual([q.name, q.lat, q.lng, q.kind, q.area, !!q.other], [p.name, p.lat, p.lng, p.cat, p.area, !!p.other]);
  }
  assert.deepEqual(src.places.filter((p) => (p.facts?.f || []).includes("live_music")).map((p) => p.id), ["43", "69", "X17", "X19", "X20", "X21"]);
  assert.deepEqual(src.places.find((p) => p.id === "60").names, [{ t: "azotea" }]);
  assert.deepEqual(src.places.find((p) => p.id === "X13").names, [{ t: "quince", exact: true }]);
  assert.equal(src.collections[0].places.length, 8);
});

test("the pack builds within its budget, and dist/ is exactly what the source builds", () => {
  const r = build(src, { date: DATE });
  assert.ok(r.ok, r.errors?.join("\n"));
  assert.ok(r.total <= r.budget, `${r.total} > ${r.budget}`);
  assert.equal(r.version, entry.version, "packs/dist is stale: run node tools/build-pack.mjs mx-sma --date " + DATE);
  for (const [path, text] of Object.entries(r.files)) assert.equal(readFileSync(ROOT + "packs/dist/" + path, "utf8"), text, path);
  const manifest = JSON.parse(r.files[entry.manifest]);
  for (const f of Object.values(manifest.files)) {
    const text = readFileSync(ROOT + "packs/dist/mx-sma/" + DATE + "." + entry.version.slice(11) + "/" + f.path, "utf8");
    assert.equal(createHash("sha256").update(text).digest("hex"), f.sha256, f.path);
  }
});

test("the build report names the data that needs a person", () => {
  const { warnings, notes } = validate(src, DATE);
  assert.equal(notes.hoursToSettle.length, 20);
  assert.deepEqual(notes.missingHours, ["23", "24", "25", "27", "31", "38", "X18", "X19", "X20"]);
  assert.deepEqual(notes.music.empty, ["X22", "X17", "43", "69", "X9"].sort((a, b) => Object.keys(src.music.venues).indexOf(a) - Object.keys(src.music.venues).indexOf(b)));
  assert.ok(warnings.some((w) => /X17's hours have no entry for Saturday/.test(w)));
  assert.deepEqual(notes.needsReading, ["xalisco", "mixiotes"]);
});

test("the validator refuses broken sources", () => {
  const broken = (change, pattern) => {
    const s = clone();
    change(s);
    const { errors } = validate(s, DATE);
    assert.ok(errors.some((e) => pattern.test(e)), `expected ${pattern} in ${JSON.stringify(errors)}`);
  };
  broken((s) => { s.city.tz = "Mexico/Nowhere"; }, /time zone/);
  broken((s) => { s.places.push({ ...s.places[0] }); }, /used twice/);
  broken((s) => { s.places[0].lat = 40.4; }, /outside the city's bbox/);
  broken((s) => { s.places[0].kind = "spaceship"; }, /kind "spaceship"/);
  broken((s) => { s.hours.places["1"].h["0"] = "9am–5pm"; }, /hours do not parse/);
  broken((s) => { delete s.city.text.es.inCentre; }, /text\.es\.inCentre/);
  broken((s) => { s.collections[0].places.push({ id: "nope" }); }, /unknown place nope/);
  broken((s) => { s.areas.push({ ...s.areas[0], id: "second centre" }); }, /exactly one area/);
  broken((s) => { s.city.centre.place = "S99"; }, /centre place/);
});

test("names that sound alike are reported, and a pack over budget is refused", () => {
  const s = clone();
  s.places.push({ ...s.places.find((p) => p.id === "60"), id: "T1", name: "La Asotea", names: [] });
  assert.ok(validate(s, DATE).warnings.some((w) => /sound alike: .*La Azotea.*La Asotea|sound alike: .*La Asotea.*La Azotea/.test(w)));
  const big = clone();
  for (const p of big.places) p.desc = randomBytes(600).toString("base64");  // text gzip cannot shrink
  const r = build(big, { date: DATE });
  assert.ok(!r.ok && /budget/.test(r.errors[0]));
});
