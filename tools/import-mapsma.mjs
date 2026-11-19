// One-time import (19 Nov 2026): San Miguel de Allende from MapSMA's files (test/fixtures/before/mapsma-page5/, as served on
// 18 Nov 2026) into the city pack's source files, packs/src/mx-sma/. Tables are taken from the code itself, not retyped, so the
// pack holds exactly what /page5 holds today, including its known faults (listed in packs/src/mx-sma/README.md). After this
// import the pack's source files are edited by hand (as data, reviewed as diffs), not re-imported.
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const FIX = ROOT + "test/fixtures/before/mapsma-page5/";
const OUT = ROOT + "packs/src/mx-sma/";
const read = (f) => readFileSync(FIX + f, "utf8");

// Constants that a module keeps to itself: import its source with an export line added.
async function constants(file, names) {
  const src = read(file) + `\nexport const __CONSTANTS = { ${names.join(", ")} };\n`;
  return (await import("data:text/javascript;base64," + Buffer.from(src).toString("base64"))).__CONSTANTS;
}
// A constant inside a function (ask.js's createAsker, the page script): its object literal, evaluated.
function literal(src, name) {
  const m = new RegExp(`const ${name} = (\\{[\\s\\S]*?\\});`).exec(src);
  if (!m) throw new Error(`${name} not found`);
  return new Function(`return (${m[1]});`)();
}

const { ALIASES, EXACT_ONLY, EXACT_NAME, NO_SHORT } = await constants("read.js", ["ALIASES", "EXACT_ONLY", "EXACT_NAME", "NO_SHORT"]);
const { ENGLISH, BY_HAND } = await constants("spanish.js", ["ENGLISH", "BY_HAND"]);
const SIGHT_NAME = literal(read("ask.js"), "SIGHT_NAME");
const MEALS = literal(read("ask.js"), "MEALS");
const inline = read("page5-inline.js");
const HINT_SKIP = new Function(`return ${/const HINT_SKIP = (new Set\(\[[^\]]*\]\));/.exec(inline)[1]};`)();
const HINT_AS = literal(inline, "HINT_AS");
const data = JSON.parse(read("data.json"));
const win = {};
const ctx = vm.createContext({ window: win });
vm.runInContext(read("facts.js"), ctx);
vm.runInContext(read("susan.js"), ctx);
const hoursFile = JSON.parse(read("hours.json"));
const photos = new Set(JSON.parse(read("photos.json")).ids);

const lats = data.PLACES.map((p) => p.lat), lngs = data.PLACES.map((p) => p.lng);
const pad = 0.02;
const round = (x) => Math.round(x * 1e4) / 1e4;
const centre = data.PLACES.find((p) => p.id === "S2");

const city = {
  schema: 1,
  id: "mx-sma",
  names: { en: "San Miguel de Allende", es: "San Miguel de Allende" },
  say: ["san miguel", "san miguel de allende", "sma"],
  tz: "America/Mexico_City", country: "MX", currency: "MXN",
  langs: ["en", "es"], variety: { es: "mx", en: "us" },
  // The centre: the Jardín (place S2); "in Centro" = within 650 m of it and not in Guadalupe (ask.js CENTRO_M, inCentro).
  centre: { place: "S2", lat: centre.lat, lng: centre.lng, fallback: { lat: 20.91445, lng: -100.74375 }, radiusM: 650 },
  bbox: [round(Math.min(...lats) - pad), round(Math.min(...lngs) - pad), round(Math.max(...lats) + pad), round(Math.max(...lngs) + pad)],
  farM: 25000,        // farther than this from the centre, "near me" is measured from the centre (ask.js FAR_M)
  walkMPerMin: 75,    // "walking on San Miguel's hills and cobbles" (ask.js)
  meals: Object.fromEntries(Object.entries(MEALS).map(([k, v]) => [k, { win: v.win, min: v.min }])),
  kinds: data.CATS,
  // How answers name the city and its centre (ask.js's sentences).
  text: {
    en: { city: "San Miguel", centre: "the Jardín", inCentre: " in Centro", localClaim: "Every place on this site is picked by people who live in San Miguel" },
    es: { city: "San Miguel", centre: "el Jardín", inCentre: " en el Centro", localClaim: "Todos los lugares de este sitio los eligió gente que vive en San Miguel" },
  },
  credits: ["Places, positions and facts: MapSMA (mapsma.com), researched 17–18 Nov 2026", "Names and positions partly from © OpenStreetMap contributors"],
};

// Areas, in the order read.js tries them. "words": what a question says (folded); "match": what a place's area or address says.
const areas = [
  { id: "centro", role: "centre",
    words: ["centro", "central", "centra", "sentro", "center", "centre", "downtown", "historic", "jardin", "main square", "old town", "zocalo", "plaza principal"],
    // "jardín" is also a garden: "con jardín", "un jardín", "jardines" are not the main square (read.js)
    notWhen: "\\b(con|un|una|en un|de|with a|a) jardin(es)?\\b|\\bjardines\\b",
    notCentre: [] },
  { id: "san antonio", words: ["san antonio"], match: ["san antonio"], maskInNames: "\\b(colonia )?san antonio\\b", in: { en: " in San Antonio", es: " en San Antonio" } },
  { id: "guadalupe", words: ["guadalupe"], match: ["guadalupe"], maskInNames: "\\bguadalupe\\b", notCentre: true, in: { en: " in Guadalupe", es: " en Guadalupe" } },
  { id: "out of town", words: ["out of town", "countryside", "campo", "fuera de la ciudad", "afueras"], match: ["out of town", "fuera de la ciudad"], role: "outOfTown",
    in: { en: " out of town", es: " fuera de la ciudad" } },
  { id: "aurora", words: ["aurora", "fabrica"], match: ["aurora"], in: { en: " in Aurora", es: " en Aurora" } },
];

const picks = win.SUSAN.picks;
const collections = [
  { id: "susan",
    words: ["susan", "suzanne", "suzan", "susanne", "york", "blogger", "cupcakes", "bloguera"],
    recentDays: 548,     // "recent" picks: written about in the last 18 months (ask.js RECENT_DAYS)
    count: 3,            // a question about her picks gets three places, not four (ask.js)
    alsoKinds: ["wine"], // her picks include wineries (ask.js)
    source: { blog: win.SUSAN.blog, checked: win.SUSAN.checked },
    places: picks,
    text: {
      en: { who: "Susan York", picks: "Susan York's picks", recentPicks: "Susan York's recent picks", wrote: "Susan York wrote about it in {month}" },
      es: { who: "Susan York", picks: "las recomendaciones de Susan York", recentPicks: "las recomendaciones recientes de Susan York", wrote: "Susan York escribió sobre este lugar en {month}",
        more: "recomendaciones más de Susan York", gender: "f" },
    } },
];

const places = data.PLACES.map((p) => {
  const names = [...(ALIASES[p.id] || []).map((t) => ({ t })), ...(EXACT_ONLY[p.id] || []).map((t) => ({ t, exact: true }))];
  const facts = win.FACTS[p.id];
  const out = { id: p.id, name: p.name, kind: p.cat };
  if (data.ALSO[p.id]) out.alsoKinds = data.ALSO[p.id];
  Object.assign(out, { lat: p.lat, lng: p.lng, area: p.area });
  if (p.desc) out.desc = p.desc;
  if (p.acc) out.acc = p.acc;
  if (p.other) out.other = true;
  out.photo = photos.has(p.id);
  if (names.length) out.names = names;
  if (EXACT_NAME.has(p.id)) out.exactName = true;
  if (NO_SHORT.has(p.id)) out.noShort = true;
  if (SIGHT_NAME[p.id]) out.sentence = { en: SIGHT_NAME[p.id][0], es: SIGHT_NAME[p.id][1] };
  if (HINT_SKIP.has(p.id)) out.hint = { skip: true };
  else if (HINT_AS[p.id]) out.hint = { as: HINT_AS[p.id] };
  if (data.INFO[p.id]) out.info = data.INFO[p.id];
  if (facts) out.facts = facts;
  return out;
});
// Places that /page5 knows only from INFO (no position): kept in the report, not as places.
const infoOnly = Object.keys(data.INFO).filter((id) => !data.PLACES.some((p) => p.id === id));

// One source for hours: /photos/hours.json where it has the place (the page lays it over data.js), else data.js.
const hours = { note: "One source of opening hours (Monday = 0; ranges may pass midnight; null = closed). From /photos/hours.json where it had the place (checked date kept), else data.js's HOURS (no date).", places: {} };
const conflicts = [];
for (const p of data.PLACES) {
  const a = data.HOURS[p.id], b = hoursFile.places[p.id];
  if (b) {
    hours.places[p.id] = { h: b.hours, checked: b.checked, source: "hours.json" };
    // data.js said otherwise: kept beside it until someone settles it (the build report lists every "alsoSaid")
    if (a && JSON.stringify(a) !== JSON.stringify(b.hours)) { conflicts.push(p.id); hours.places[p.id].alsoSaid = { h: a, source: "data.js" }; }
  } else if (a) hours.places[p.id] = { h: a, source: "data.js" };
}

const lexicon = {
  note: "Words in this city's names that stay English for the voice, and readings written by hand (tiny-voca phones, from spanish.js).",
  english: [...ENGLISH],
  readings: Object.fromEntries(Object.entries(BY_HAND).map(([w, ph]) => [w, { phones: ph, phoneset: "dizione-en-1" }])),
};

mkdirSync(OUT, { recursive: true });
const write = (name, value) => writeFileSync(OUT + name, JSON.stringify(value, null, 1) + "\n");
write("city.json", city);
write("areas.json", areas);
write("collections.json", collections);
write("places.json", places);
write("hours.json", hours);
write("lexicon.json", lexicon);
writeFileSync(OUT + "README.md", `# San Miguel de Allende (mx-sma): pack source

Imported on 19 Nov 2026 by \`tools/import-mapsma.mjs\` from MapSMA /page5 as served on 18 Nov 2026; edit these files by
hand from now on (they are data: review changes as diffs), then run \`node tools/build-pack.mjs mx-sma\`.

| File | What |
|---|---|
| city.json | time zone, centre, distances, meal hours, kinds of place, how answers name the city |
| areas.json | neighbourhoods and the centre: the words a question uses, what a place's area says |
| places.json | ${places.length} places: names people say, facts, info, the sentence name of a sight, the recognizer hint |
| collections.json | Susan York's picks (${picks.length}) and how answers name them |
| hours.json | opening hours, one source, with checked dates where known |
| lexicon.json | English words inside names, hand-written readings |

Known faults carried over from /page5 on purpose (the golden snapshot records today's answers; fix them as separate changes):

- **Aliases lost to a comment.** In read.js, the line with Jacques' aliases continues with a \`//\` comment that swallows the aliases of
  places 8, 9, 13, 20, 22 and 28 (umaran; kibok, key bok; buon forno; andys tacos, andys taco; don tomas; la mancha). They are not
  in places.json yet.
- **Two sources of hours.** /photos/hours.json has 54 places; 45 of them are also in data.js, and for ${conflicts.length} of those the two
  disagree (${conflicts.join(", ")}); 9 are only in hours.json. hours.json was used (as the page does); data.js's version is kept as
  \`alsoSaid\` beside each disagreement until settled, and the build report lists them.
- **INFO without a place:** ${infoOnly.join(", ") || "none"}.
`);
console.log(`places ${places.length}, areas ${areas.length}, picks ${picks.length}, hours ${Object.keys(hours.places).length} (conflicts ${conflicts.length}), info-only ${infoOnly.length}`);
