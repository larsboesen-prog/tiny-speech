// City packs (D6): the shape of a city's source files and the checks a pack must pass before it is built.
// No city is named here; every rule applies to every city. Errors stop the build; warnings go into its report.
import { fold, sound, alike } from "../text/sound.js";

export const SCHEMA = 1;
export const BYTES_PER_PLACE = 300;   // budget: gzipped bytes a place (review, section 3.3)
export const BUDGET_FLOOR = 20000;    // a very small city still gets this much
export const STALE_DAYS = 120;        // hours checked longer ago than this: a warning
export const MUSIC_STALE_DAYS = 60;   // music nights change sooner than hours

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const RANGE = /^(\d{1,2}):(\d{2})–(\d{1,2}):(\d{2})$/;

// Ordinary words: a name made only of these is no hint on its own ("The Restaurant", "Inside") and must be matched exactly.
const ORDINARY = new Set(("the a an and of de del la el los las y restaurant restaurante cafe coffee bar bars market mercado inside rooftop terraza " +
  "kitchen cocina house casa garden jardin view vista place lugar food comida bakery panaderia street calle quince").split(" "));

// Spellings rules cannot read with certainty: x (Xochimilco /s/, Oaxaca /h/, Xola /ʃ/), tl, tz, initial hu + vowel.
const NEEDS_READING = /x|tl|tz|\bhu[aeio]/;

export function hoursOk(h) {
  if (!h || typeof h !== "object") return false;
  for (let d = 0; d < 7; d++) {
    const v = h[String(d)];
    if (v === null || v === undefined) continue;  // closed; a missing day is read as closed too (and reported)
    if (typeof v !== "string") return false;
    for (const r of v.split(", ")) {
      const m = RANGE.exec(r);
      if (!m || +m[1] > 24 || +m[2] > 59 || +m[3] > 24 || +m[4] > 59) return false;
    }
  }
  return true;
}

function tzOk(tz) {
  try { new Intl.DateTimeFormat("en-US", { timeZone: tz }); return true; } catch { return false; }
}

const daysAgo = (date, today) => Math.round((Date.parse(today) - Date.parse(date)) / 864e5);

/**
 * Check a city's source files. `src` = {city, areas, places, collections, hours, lexicon, music?}; `today` = "YYYY-MM-DD";
 * `genres`: the music genres the reader knows (domains/music GENRES), to check music.json's against.
 * Returns {errors: [], warnings: [], notes: {...}} (notes: counts and lists for the report).
 */
export function validate(src, today, { genres = null } = {}) {
  const errors = [], warnings = [], notes = {};
  const { city, areas = [], places = [], collections = [], hours = { places: {} }, lexicon = {}, music = null } = src;
  const err = (m) => errors.push(m), warn = (m) => warnings.push(m);

  // the city
  if (!city || city.schema !== SCHEMA) err(`city.json: schema must be ${SCHEMA}`);
  if (!/^[a-z]{2}-[a-z0-9-]+$/.test(city?.id || "")) err(`city.json: id "${city?.id}" must look like "mx-sma" (country, then a short name)`);
  if (!tzOk(city?.tz)) err(`city.json: time zone "${city?.tz}" is not one the browser knows`);
  if (!Array.isArray(city?.langs) || !city.langs.length) err("city.json: langs is empty");
  if (!city?.names || !city.langs?.every((l) => city.names[l])) err("city.json: a name in every language is needed");
  const [s, w, n, e] = city?.bbox || [];
  if (![s, w, n, e].every(Number.isFinite) || s >= n || w >= e) err("city.json: bbox must be [south, west, north, east]");
  for (const k of ["farM", "walkMPerMin"]) if (!(city?.[k] > 0)) err(`city.json: ${k} must be a positive number`);
  for (const [k, m] of Object.entries(city?.meals || {})) {
    if (!(Array.isArray(m.win) && m.win.length === 2 && m.win[0] < m.win[1] && m.min > 0)) err(`city.json: meal "${k}" needs win [from, to] in minutes and min`);
  }
  for (const l of city?.langs || []) for (const k of ["city", "centre", "inCentre", "localClaim"]) if (!city?.text?.[l]?.[k]) err(`city.json: text.${l}.${k} is missing`);

  // places
  const ids = new Set();
  const inBox = (p) => p.lat >= s && p.lat <= n && p.lng >= w && p.lng <= e;
  for (const p of places) {
    if (!p.id || ids.has(p.id)) err(`places.json: id "${p.id}" is missing or used twice`);
    ids.add(p.id);
    if (!p.name) err(`places.json: place ${p.id} has no name`);
    if (!Number.isFinite(p.lat) || !Number.isFinite(p.lng)) err(`places.json: place ${p.id} has no position`);
    else if (!inBox(p)) err(`places.json: place ${p.id} (${p.name}) is outside the city's bbox`);
    if (city?.kinds && !city.kinds[p.kind]) err(`places.json: place ${p.id} has kind "${p.kind}", not one of city.json's kinds`);
    for (const k of p.alsoKinds || []) if (city?.kinds && !city.kinds[k]) err(`places.json: place ${p.id} also has unknown kind "${k}"`);
  }
  if (city?.centre?.place && !ids.has(city.centre.place)) err(`city.json: the centre place "${city.centre.place}" is not in places.json`);

  // hours: one source, parseable, dated
  const missingHours = [], stale = [], settle = [];
  for (const [id, v] of Object.entries(hours.places || {})) {
    if (!ids.has(id)) err(`hours.json: hours for unknown place ${id}`);
    if (!hoursOk(v.h)) err(`hours.json: place ${id}'s hours do not parse (days "0"–"6", Monday = 0; "9:00–17:00, 18:00–23:00"; null = closed)`);
    if (v.checked && !DATE.test(v.checked)) err(`hours.json: place ${id} checked "${v.checked}" is not a date`);
    if (v.checked && daysAgo(v.checked, today) > STALE_DAYS) stale.push(id);
    if (v.alsoSaid) settle.push(id);
    const missing = [0, 1, 2, 3, 4, 5, 6].filter((d) => !(String(d) in (v.h || {})));
    if (missing.length) warn(`place ${id}'s hours have no entry for ${missing.map((d) => ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"][d]).join(", ")}: read as closed; write null if it is`);
  }
  for (const p of places) if (p.kind !== "sights" && !hours.places?.[p.id]) missingHours.push(p.id);
  notes.missingHours = missingHours;
  notes.staleHours = stale;
  notes.hoursToSettle = settle;
  if (missingHours.length) warn(`${missingHours.length} places have no hours: ${missingHours.join(", ")}`);
  if (settle.length) warn(`${settle.length} places have two versions of their hours to settle (alsoSaid): ${settle.join(", ")}`);
  if (stale.length) warn(`${stale.length} places' hours were checked more than ${STALE_DAYS} days ago: ${stale.join(", ")}`);
  // music (optional): which places have live music, which genres, which nights; it changes often, so it is dated and goes stale sooner
  notes.music = { venues: 0, empty: [] };
  const TIME = /^([01]?\d|2[0-3]):[0-5]\d$/;
  for (const [id, v] of Object.entries(music?.venues || {})) {
    if (!ids.has(id)) { err(`music.json: music for unknown place ${id}`); continue; }
    if (!(v.slots || []).length) { notes.music.empty.push(id); continue; }
    notes.music.venues++;
    if (!Array.isArray(v.genres) || !v.genres.length) err(`music.json: place ${id} needs at least one genre`);
    for (const g of [...(v.genres || []), ...v.slots.flatMap((sl) => sl.genres || [])]) if (genres && !genres.includes(g)) err(`music.json: place ${id} has genre "${g}", not one the reader knows (${genres.join(", ")})`);
    for (const sl of v.slots) {
      if (!Array.isArray(sl.days) || !sl.days.length || !sl.days.every((d) => Number.isInteger(d) && d >= 0 && d <= 6)) err(`music.json: place ${id} has a night with days ${JSON.stringify(sl.days)} (0–6, Monday = 0)`);
      if (!TIME.test(sl.from || "") || (sl.to != null && !TIME.test(sl.to))) err(`music.json: place ${id} has a night from "${sl.from}" to "${sl.to}" (write "20:00"; leave "to" out when only the start is known)`);
    }
    if (!v.checked || !DATE.test(v.checked)) err(`music.json: place ${id} needs "checked": the date someone last confirmed its nights`);
    else if (daysAgo(v.checked, today) > MUSIC_STALE_DAYS) warn(`music.json: place ${id}'s nights were checked more than ${MUSIC_STALE_DAYS} days ago`);
  }
  notes.music.toAdd = (music?.toAdd || []).map((v) => v.name);
  if (notes.music.toAdd.length) warn(`music.json: ${notes.music.toAdd.length} venues are waiting to be added to places.json: ${notes.music.toAdd.join(", ")}`);
  if (notes.music.empty.length) warn(`music.json: ${notes.music.empty.length} places have no nights yet and are left out: ${notes.music.empty.join(", ")}`);

  notes.noFacts = places.filter((p) => p.kind !== "sights" && !p.facts).map((p) => p.id);
  if (notes.noFacts.length) warn(`${notes.noFacts.length} places have no facts (cuisine, dishes, features): ${notes.noFacts.join(", ")}`);

  // areas
  const areaIds = new Set();
  for (const a of areas) {
    if (!a.id || areaIds.has(a.id)) err(`areas.json: area id "${a.id}" missing or used twice`);
    areaIds.add(a.id);
    if (!Array.isArray(a.words) || !a.words.length) err(`areas.json: area "${a.id}" has no words`);
    if (a.role !== "centre" && !(a.match && a.match.length)) err(`areas.json: area "${a.id}" needs "match" (what a place's area or address says)`);
    for (const k of ["notWhen", "maskInNames"]) if (a[k]) try { new RegExp(a[k]); } catch { err(`areas.json: area "${a.id}" ${k} is not a valid pattern`); }
  }
  if (areas.filter((a) => a.role === "centre").length !== 1) err("areas.json: exactly one area needs role \"centre\"");

  // collections
  for (const c of collections) {
    if (!c.id || !Array.isArray(c.words) || !c.words.length) err(`collections.json: collection "${c.id}" needs an id and words`);
    for (const x of c.places || []) if (!ids.has(x.id)) err(`collections.json: "${c.id}" lists unknown place ${x.id}`);
    for (const l of city?.langs || []) for (const k of ["who", "picks", "recentPicks", "wrote"]) if (!c.text?.[l]?.[k]) err(`collections.json: "${c.id}" text.${l}.${k} is missing`);
    if (city?.langs?.includes("es") && !(c.text?.es?.more && c.text?.es?.gender)) err(`collections.json: "${c.id}" text.es needs "more" and "gender"`);
  }

  // names: every key a question can say, its collisions, names that are ordinary words, names that need a reading
  const keys = [];
  for (const p of places) {
    keys.push({ id: p.id, t: p.name, exact: !!p.exactName });
    for (const x of p.names || []) keys.push({ id: p.id, t: x.t, exact: !!x.exact });
  }
  const collisions = [];
  for (let i = 0; i < keys.length; i++) {
    for (let j = i + 1; j < keys.length; j++) {
      const a = keys[i], b = keys[j];
      if (a.id === b.id || a.exact || b.exact) continue;
      if (Math.abs(sound(a.t).length - sound(b.t).length) > 3) continue;
      const sim = alike(a.t, b.t);
      if (sim >= 0.86) collisions.push([a.id, b.id, a.t, b.t, Math.round(sim * 100) / 100]);
    }
  }
  notes.collisions = collisions;
  for (const [x, y, a, b, sim] of collisions) warn(`names that sound alike: ${x} "${a}" and ${y} "${b}" (${sim})`);
  notes.ordinary = keys.filter((k) => !k.exact && fold(k.t).split(/[^a-z0-9]+/).filter(Boolean).every((wd) => ORDINARY.has(wd))).map((k) => `${k.id} "${k.t}"`);
  for (const o of notes.ordinary) warn(`a name made only of ordinary words is not marked exact: ${o}`);
  // Area words that sound like a place's name ("the river" ~ Café de la Ribera): a question about the area would name the place,
  // unless the area masks its words in name matching (maskInNames). Names are compared without their small words, as the reader does.
  const SMALL = new Set(["la", "el", "los", "las", "the", "de", "del", "y", "and", "cafe", "coffee", "tacos", "panaderia", "casa"]);
  const bare = (t) => fold(t).split(/[^a-z0-9]+/).filter((wd) => wd && !SMALL.has(wd)).join(" ");
  notes.areaClashes = [];
  for (const a of areas) {
    const mask = a.maskInNames ? new RegExp(a.maskInNames) : null;
    for (const wd of a.words || []) {
      if (mask && mask.test(fold(wd))) continue;
      for (const k of keys) {
        const name = bare(k.t);
        if (!name || k.exact || name.includes(fold(wd))) continue;
        if (alike(wd.replace(/^(the|la|el) /, ""), name) >= 0.75) notes.areaClashes.push(`area "${a.id}" word "${wd}" sounds like place ${k.id} "${k.t}"`);
      }
    }
  }
  for (const c of notes.areaClashes) warn(`${c}: mask it (maskInNames) or the place may be named instead`);
  const readings = lexicon.readings || {};
  notes.needsReading = [...new Set(places.flatMap((p) => fold(p.name).split(/[^a-z0-9]+/))
    .filter((wd) => wd && NEEDS_READING.test(wd) && !readings[wd]))];
  if (notes.needsReading.length) warn(`words in names whose sound the rules cannot be sure of (x, tl, tz, hu-): ${notes.needsReading.join(", ")}`);

  notes.counts = { places: places.length, picks: places.filter((p) => !p.other && p.kind !== "sights").length, extras: places.filter((p) => p.other).length,
    sights: places.filter((p) => p.kind === "sights").length, names: keys.length, areas: areas.length, collections: collections.length };
  return { errors, warnings, notes };
}
