// Names by sound, before and after (22 Nov 2026; README.md here, "Names by sound"). For each clip with saved frames (.npy from
// page_path.py or probe.py --onnx): the words (engines/ears-match.js with the page's word list), the place the reader finds in them
// (BEFORE: what /page5 answered), the names that fit the sounds (engines/ears-spot.js) and soundChoice's decision (AFTER: the place
// answered, or the names offered as buttons).
//
//   node training/asr/probe/names_eval.mjs manifest.jsonl CACHE_DIR packs/dist/mx-sma/ears-lexicon-en.json [--spanish] [--rows out.jsonl]
//
// The place expected: the manifest's `place`, else the one the reader finds in what was said, else a place whose full name (8+
// letters) is in it. --spanish: the Spanish page (no override of a name the words found).
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";

const TS = fileURLToPath(new URL("../../../", import.meta.url));
const { buildLexicon, decode } = await import(TS + "engines/ears-match.js");
const { buildNameSpotter, soundChoice } = await import(TS + "engines/ears-spot.js");
const { loadCore } = await import(TS + "test/golden/mapsma.mjs");
const { createAsker, nowAt } = await import(TS + "domains/places/ask.js");

const args = process.argv.slice(2), pos = args.filter((a, i) => !a.startsWith("--") && !(i > 0 && args[i - 1] === "--rows"));
const [manifest, cache, lexFile] = pos, spanish = args.includes("--spanish"), rowsOut = args.includes("--rows") ? args[args.indexOf("--rows") + 1] : null;
if (!lexFile) { console.error("usage: node names_eval.mjs manifest.jsonl CACHE_DIR ears-lexicon.json [--spanish] [--rows out.jsonl]"); process.exit(2); }
const { pack } = await loadCore();
const asker = createAsker({ pack, random: () => 0.5 });
const now = nowAt(pack.tz, new Date("2026-11-21T20:00:00-06:00"));
const vocab = JSON.parse(readFileSync(TS + "engines/ears/vocab.json", "utf8")), V = Object.keys(vocab).length, blank = vocab["<pad>"];
const lexData = JSON.parse(readFileSync(lexFile, "utf8")), lex = buildLexicon(lexData, vocab);
const names = JSON.parse(readFileSync(TS + "packs/dist/mx-sma/ears-names.json", "utf8")).names;
const spotter = buildNameSpotter(names, lexData, vocab);
const fold = (s) => String(s).toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9ñ' ]+/g, " ").replace(/\s+/g, " ").trim();
const full = pack.places.filter((p) => p.name.length >= 8).map((p) => [p.id, fold(p.name)]);
const npy = (f) => { const b = readFileSync(f), hl = b.readUInt16LE(8), header = b.slice(10, 10 + hl).toString(), shape = header.match(/\((\d+), (\d+)\)/);
  return { lp: new Float32Array(b.buffer.slice(b.byteOffset + 10 + hl, b.byteOffset + b.length)), frames: +shape[1] }; };

const rows = [];
for (const r of readFileSync(manifest, "utf8").trim().split("\n").map((l) => JSON.parse(l))) {
  const f = `${cache}/${r.id}.npy`;
  if (!existsSync(f)) continue;
  const { lp, frames } = npy(f);
  const heard = decode(lp, frames, V, lex, blank), q = asker.read(heard, now);
  const spot = spotter.spot(lp, frames, V, blank, 5);
  const expected = r.place || asker.read(r.text, now).named?.id || (full.find(([, n]) => fold(r.text).includes(n)) || [])[0] || null;
  const c = soundChoice(heard, q, spot, { override: !spanish });
  const before = q.named?.id || null, after = c.pick || (c.ask.length && !c.keep ? null : before);
  rows.push({ id: r.id, group: r.accent || r.voice || "", text: r.text, heard, expected, before, after, offered: c.ask, spot: spot.map((s) => [s.id, +s.perSound.toFixed(3)]) });
}
const tally = (xs) => {
  const t = { clips: xs.length, withName: 0, before: 0, after: 0, offered: 0, wrongBefore: 0, wrongAfter: 0, extraRows: 0 };
  for (const x of xs) {
    if (x.expected) { t.withName++; t.before += x.before === x.expected; t.after += x.after === x.expected; t.offered += x.after !== x.expected && x.offered.includes(x.expected); }
    t.wrongBefore += !!x.before && x.before !== x.expected; t.wrongAfter += !!x.after && x.after !== x.expected;
    t.extraRows += !x.expected && x.offered.length > 0;
  }
  return t;
};
const all = tally(rows);
console.log(`${all.clips} clips, ${all.withName} naming a place: names found ${all.before} → ${all.after}, ${all.offered} more offered as buttons; a wrong place ${all.wrongBefore} → ${all.wrongAfter}; "Did you mean" on ${all.extraRows} questions naming none`);
const groups = [...new Set(rows.map((x) => x.group))];
if (groups.length > 1 && groups.length <= 12) for (const g of groups) { const t = tally(rows.filter((x) => x.group === g)); console.log(`  ${g.padEnd(8)} found ${t.before} → ${t.after} of ${t.withName}, offered ${t.offered}, wrong ${t.wrongBefore} → ${t.wrongAfter}`); }
if (rowsOut) writeFileSync(rowsOut, rows.map((x) => JSON.stringify(x)).join("\n") + "\n");
