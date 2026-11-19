// MapSMA's reader and asker, run in Node exactly as /page5 builds them (18 Nov 2026): data.js's places (without the map),
// /photos/hours.json laid over data.js's hours, a place shown when it has a photo or is an extra, Susan York's picks and the
// facts. Used to record what the site answers today (the golden snapshot) and to check that the shared core answers the same.
import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { join } from "node:path";
import vm from "node:vm";

// Fixed moments in San Miguel (UTC−6 all year since 2022): a weekday lunch, a Saturday night, a Monday small hour.
export const CLOCKS = {
  "tue-14:10": "2026-11-17T20:10:00Z",
  "sat-23:40": "2026-11-22T05:40:00Z",
  "mon-03:00": "2026-11-16T09:00:00Z",
};
// Where "near me" is asked from: a street about 200 m north of the Jardín.
export const HERE = { lat: 20.9162, lng: -100.7440 };

function seeded(seed) {
  let s = seed >>> 0;
  return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
}

/** Load a MapSMA-shaped implementation from `dir` (ask.js, read.js, data.json, facts.js, susan.js, hours.json, photos.json). */
export async function loadSite(dir) {
  const ask = await import(pathToFileURL(join(dir, "ask.js")).href);
  const data = JSON.parse(readFileSync(join(dir, "data.json"), "utf8"));
  const win = {};
  const ctx = vm.createContext({ window: win });
  for (const f of ["facts.js", "susan.js"]) vm.runInContext(readFileSync(join(dir, f), "utf8"), ctx);
  const hours = JSON.parse(readFileSync(join(dir, "hours.json"), "utf8"));
  const photos = new Set(JSON.parse(readFileSync(join(dir, "photos.json"), "utf8")).ids);
  let rng = seeded(1);
  const makeAsker = (lang) => {
    const HOURS = { ...data.HOURS };
    for (const [id, v] of Object.entries(hours.places)) HOURS[id] = v.hours;
    return ask.createAsker({
      places: data.PLACES.map((p) => ({ ...p })), INFO: data.INFO, HOURS, CATS: data.CATS, ALSO: data.ALSO || {},
      SUSAN: win.SUSAN, FACTS: win.FACTS || {}, shown: (p) => p.other || photos.has(p.id), random: () => rng(), lang,
    });
  };
  const askers = { en: makeAsker("en"), es: makeAsker("es") };
  return runner({ askers, now: (d) => ask.nowMX(d), requestOf: ask.requestOf, reseed: () => { rng = seeded(7); } });
}

/**
 * The shared core (domains/places) with San Miguel's built pack, loaded as a browser would: index.json → manifest → base and live,
 * each checked against the manifest's SHA-256. MapSMA's request and answer have a field "susan" where the core has "collection"
 * (any city's curated list): the core's is renamed back, in place, so the two can be compared word for word.
 */
export async function loadCore(root = new URL("../../", import.meta.url), cityId = "mx-sma") {
  const { createHash } = await import("node:crypto");
  const ask = await import(new URL("domains/places/ask.js", root).href);
  const { assemble, checked } = await import(new URL("core/pack/assemble.js", root).href);
  const dist = new URL("packs/dist/", root);
  const index = JSON.parse(readFileSync(new URL("index.json", dist), "utf8"));
  const entry = index.cities.find((c) => c.id === cityId);
  const manifestUrl = new URL(entry.manifest, dist);
  const manifest = JSON.parse(readFileSync(manifestUrl, "utf8"));
  const sha = (t) => createHash("sha256").update(t).digest("hex");
  const file = (f) => checked(readFileSync(new URL(f.path, manifestUrl), "utf8"), f, sha);
  const pack = assemble(manifest, await file(manifest.files.base), await file(manifest.files.live));
  let rng = seeded(1);
  const makeAsker = (lang) => ask.createAsker({ pack, random: () => rng(), lang });
  const askers = { en: makeAsker("en"), es: makeAsker("es") };
  const asMapsma = (o) => renameKey(o, "collection", "susan", (v) => !!v);
  return {
    pack,
    ...runner({ askers, now: (d) => ask.nowAt(pack.tz, d), reseed: () => { rng = seeded(7); },
      requestOf: (q) => { const r = ask.requestOf(q); return "collection" in r ? renameKey(r, "collection", "susan", () => true) : r; },
      answerOf: (res) => ("collection" in res ? asMapsma(res) : res) }),
  };
}

// A key renamed where it stands (key order is part of the snapshot's text).
function renameKey(o, from, to, value) {
  return Object.fromEntries(Object.entries(o).map(([k, v]) => (k === from ? [to, value(v)] : [k, v])));
}

function runner({ askers, now: nowOf, requestOf, reseed, answerOf = (r) => r }) {
  /** One conversation (a question, or several with "more"), at one clock, answered in `lang`. */
  function run(questions, clock, lang) {
    const asker = askers[lang];
    const now = nowOf(new Date(CLOCKS[clock]));
    let lastList = null;
    const out = [];
    for (const text of questions) {
      reseed();  // "surprise me" draws the same places every run
      const pq = asker.parse(text);
      const here = pq.near || pq.howFar ? HERE : null;
      const res = asker.answer(text, now, lastList, here);
      if (res.kind === "list" && res.ids.length && !(res.ids.length === 1 && !res.all.length)) lastList = res;
      out.push({ request: requestOf(pq), answer: plainAnswer(answerOf(res)) });
    }
    return out;
  }
  return { askers, run };
}

// What an answer says and shows, without the request object (recorded separately) and with places as their ids.
export function plainAnswer(res) {
  const seen = new WeakSet();
  const plain = (v, key) => {
    if (v === null || v === undefined || typeof v === "function") return undefined;
    if (v instanceof Date) return v.toISOString();
    if (Array.isArray(v)) return v.map((x) => plain(x)).filter((x) => x !== undefined);
    if (typeof v === "object") {
      if (seen.has(v)) return "[seen]";
      seen.add(v);
      if (typeof v.id === "string" && typeof v.name === "string" && "lat" in v) return "place:" + v.id;
      const o = {};
      for (const [k, x] of Object.entries(v)) {
        if (key === undefined && k === "q") continue;
        const p = plain(x, k);
        if (p !== undefined) o[k] = p;
      }
      return o;
    }
    return v;
  };
  return plain(res);
}
