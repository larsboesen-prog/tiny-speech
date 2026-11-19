// Builds a city pack from its source files: node tools/build-pack.mjs <city> [--date YYYY-MM-DD] [--out packs/dist]
// packs/src/<city>/*.json  →  validate  →  packs/dist/<city>/<version>/{manifest.json, base.json, report.md},
// packs/dist/<city>/live.<hash>.json (hours, which change often), and packs/dist/index.json (the cities and their versions).
// The version is the build date and the first six hex digits of the content's SHA-256, so a version's files never change.
import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync, rmSync } from "node:fs";
import { createHash } from "node:crypto";
import { gzipSync } from "node:zlib";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { validate, SCHEMA, BYTES_PER_PLACE, BUDGET_FLOOR } from "../core/pack/schema.js";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
export const CORE_RANGE = ">=0.2 <1";

const sha = (s) => createHash("sha256").update(s).digest("hex");
const gz = (s) => gzipSync(Buffer.from(s), { level: 9 }).length;

export function readSource(dir) {
  const get = (f, fallback) => (existsSync(join(dir, f)) ? JSON.parse(readFileSync(join(dir, f), "utf8")) : fallback);
  return { city: get("city.json"), areas: get("areas.json", []), places: get("places.json", []), collections: get("collections.json", []),
    hours: get("hours.json", { places: {} }), lexicon: get("lexicon.json", {}) };
}

/** Build in memory: {ok, errors, warnings, files: {path: text}, manifest, report}. Paths are relative to the dist folder. */
export function build(src, { date }) {
  const { errors, warnings, notes } = validate(src, date);
  if (errors.length) return { ok: false, errors, warnings };
  const { city } = src;
  const base = JSON.stringify({ schema: SCHEMA, id: city.id, places: src.places, areas: src.areas, collections: src.collections, lexicon: src.lexicon });
  // live: hours only (settled ones; an unsettled "alsoSaid" stays in the source, not in what phones load)
  const hours = Object.fromEntries(Object.entries(src.hours.places).map(([id, v]) => [id, v.checked ? { h: v.h, checked: v.checked } : { h: v.h }]));
  const live = JSON.stringify({ schema: SCHEMA, id: city.id, hours });
  const liveName = `live.${sha(live).slice(0, 8)}.json`;
  const version = `${date}.${sha(base + live).slice(0, 6)}`;
  const budget = Math.max(BUDGET_FLOOR, BYTES_PER_PLACE * src.places.length);
  const sizes = { base: { bytes: Buffer.byteLength(base), gzip: gz(base) }, live: { bytes: Buffer.byteLength(live), gzip: gz(live) } };
  const total = sizes.base.gzip + sizes.live.gzip;
  if (total > budget) return { ok: false, errors: [`pack is ${total} gzipped bytes; the budget for ${src.places.length} places is ${budget}`], warnings };
  const manifest = {
    schema: SCHEMA, id: city.id, version, built: date, core: CORE_RANGE,
    names: city.names, say: city.say, tz: city.tz, country: city.country, currency: city.currency, langs: city.langs, variety: city.variety,
    centre: city.centre, bbox: city.bbox, farM: city.farM, walkMPerMin: city.walkMPerMin, meals: city.meals, kinds: city.kinds, text: city.text,
    files: {
      base: { path: "base.json", bytes: sizes.base.bytes, sha256: sha(base) },
      live: { path: `../${liveName}`, bytes: sizes.live.bytes, sha256: sha(live) },
    },
    counts: notes.counts, credits: city.credits || [],
  };
  const report = [
    `# ${city.names.en} (${city.id}) — pack ${version}`, "",
    `Built ${date} by tools/build-pack.mjs. ${notes.counts.places} places (${notes.counts.picks} picks, ${notes.counts.extras} extras, ${notes.counts.sights} sights), ` +
      `${notes.counts.names} names, ${notes.counts.areas} areas, ${notes.counts.collections} collections.`, "",
    `| File | Bytes | Gzipped |`, `|---|---|---|`,
    `| base.json | ${sizes.base.bytes} | ${sizes.base.gzip} |`, `| ${liveName} | ${sizes.live.bytes} | ${sizes.live.gzip} |`,
    `| **total** | ${sizes.base.bytes + sizes.live.bytes} | **${total}** (budget ${budget}: ${BYTES_PER_PLACE} a place) |`, "",
    `## Warnings (${warnings.length})`, "", ...warnings.map((w) => `- ${w}`), "",
  ].join("\n");
  const files = {
    [`${city.id}/${version}/manifest.json`]: JSON.stringify(manifest, null, 1) + "\n",
    [`${city.id}/${version}/base.json`]: base,
    [`${city.id}/${liveName}`]: live,
    [`${city.id}/${version}/report.md`]: report,
  };
  return { ok: true, errors, warnings, notes, files, manifest, report, version, sizes, total, budget };
}

/** The cities' index, with this city's entry replaced. */
export function indexWith(index, manifest) {
  const entry = { id: manifest.id, names: manifest.names, say: manifest.say, centre: { lat: manifest.centre.lat, lng: manifest.centre.lng },
    version: manifest.version, manifest: `${manifest.id}/${manifest.version}/manifest.json` };
  const cities = (index?.cities || []).filter((c) => c.id !== manifest.id).concat(entry).sort((a, b) => a.id.localeCompare(b.id));
  return { schema: SCHEMA, cities };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const cityId = args.find((a) => !a.startsWith("--"));
  const opt = (k, d) => (args.includes(k) ? args[args.indexOf(k) + 1] : d);
  if (!cityId) { console.error("node tools/build-pack.mjs <city> [--date YYYY-MM-DD] [--out packs/dist]"); process.exit(2); }
  const out = join(ROOT, opt("--out", "packs/dist"));
  const date = opt("--date", new Date().toISOString().slice(0, 10));
  const result = build(readSource(join(ROOT, "packs/src", cityId)), { date });
  if (!result.ok) { console.error(result.errors.map((e) => "error: " + e).join("\n")); process.exit(1); }
  for (const [path, text] of Object.entries(result.files)) { mkdirSync(join(out, path, ".."), { recursive: true }); writeFileSync(join(out, path), text); }
  const indexPath = join(out, "index.json");
  const index = existsSync(indexPath) ? JSON.parse(readFileSync(indexPath, "utf8")) : null;
  writeFileSync(indexPath, JSON.stringify(indexWith(index, result.manifest), null, 1) + "\n");
  // This repository keeps only the current build of a city (a site that serves older ones for phones mid-update copies dist/ as is).
  const keep = new Set([result.version, result.manifest.files.live.path.slice(3)]);
  for (const f of readdirSync(join(out, cityId))) if (!keep.has(f)) rmSync(join(out, cityId, f), { recursive: true });
  console.log(`${cityId} ${result.version}: ${result.total} gzipped bytes (budget ${result.budget}), ${result.warnings.length} warnings → ${out.slice(ROOT.length)}`);
}
