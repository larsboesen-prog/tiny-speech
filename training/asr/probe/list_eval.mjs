// What the ears write, and whether the reader gets the same request as from what was said (22 Nov 2026; README.md here, "Restaurants,
// streets and hotels"). For each clip with saved frames (page_path.py): the words with the given word list (engines/ears-match.js), then
// tiny-speech's reader on the heard words and on what was said; the request's parts compared: kinds, price, area, Centro, place named,
// sight, "best", topics, street.
//
//   node training/asr/probe/list_eval.mjs manifest.jsonl CACHE_DIR packs/dist/mx-sma/ears-lexicon-en.json [rows-out.jsonl] [--show]
import { readFileSync, existsSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
const TS = fileURLToPath(new URL("../../../", import.meta.url));
const { buildLexicon, decode } = await import(TS + "engines/ears-match.js");
const { loadCore } = await import(TS + "test/golden/mapsma.mjs");
const { createAsker, nowAt } = await import(TS + "domains/places/ask.js");
const { pack } = await loadCore();
const asker = createAsker({ pack, random: () => 0.5 });
const now = nowAt(pack.tz, new Date("2026-11-21T20:00:00-06:00"));
const [manifest, cache, lexFile, out] = process.argv.slice(2).filter((a) => !a.startsWith("--"));
const vocab = JSON.parse(readFileSync(TS + "engines/ears/vocab.json", "utf8")), V = Object.keys(vocab).length, blank = vocab["<pad>"];
const lex = buildLexicon(JSON.parse(readFileSync(lexFile, "utf8")), vocab);
const npy = (f) => { const b = readFileSync(f), hl = b.readUInt16LE(8), h = b.slice(10, 10 + hl).toString(), s = h.match(/\((\d+), (\d+)\)/); return { lp: new Float32Array(b.buffer.slice(b.byteOffset + 10 + hl, b.byteOffset + b.length)), frames: +s[1] }; };
const norm = (s) => String(s).toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9ñ' ]+/g, " ").replace(/\s+/g, " ").trim();
const req = (t) => { const q = asker.read(t, now); return JSON.stringify({ cats: q.cats || null, price: q.price || null, area: q.area || null, centro: !!q.centro, named: q.named?.id || null, nearSight: q.nearSight || null, best: !!q.best, topics: [...(q.topics || [])].sort(), street: q.street || null, landmark: q.landmark || null }); };
const wer = (a, b) => { const x = norm(a).split(" "), y = norm(b).split(" "); const d = Array.from({ length: x.length + 1 }, (_, i) => [i, ...Array(y.length).fill(0)]); for (let j = 1; j <= y.length; j++) d[0][j] = j; for (let i = 1; i <= x.length; i++) for (let j = 1; j <= y.length; j++) d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (x[i - 1] === y[j - 1] ? 0 : 1)); return [d[x.length][y.length], x.length]; };
const rows = readFileSync(manifest, "utf8").trim().split("\n").map((l) => JSON.parse(l)).filter((r) => existsSync(`${cache}/${r.id}.npy`));
let exact = 0, errs = 0, words = 0, reqOk = 0; const byAcc = {}, res = [];
for (const r of rows) {
  const { lp, frames } = npy(`${cache}/${r.id}.npy`);
  const heard = decode(lp, frames, V, lex, blank);
  const [e, n] = wer(r.text, heard), ok = req(heard) === req(r.text);
  exact += norm(heard) === norm(r.text); errs += e; words += n; reqOk += ok;
  (byAcc[r.accent] ??= { n: 0, ok: 0, exact: 0 }).n++; byAcc[r.accent].ok += ok; byAcc[r.accent].exact += norm(heard) === norm(r.text);
  res.push({ ...r, heard, ok });
}
console.log(`${rows.length} clips: written exactly ${exact} (${(100 * exact / rows.length).toFixed(1)}%), words wrong ${(100 * errs / words).toFixed(1)}%, request as said ${reqOk} (${(100 * reqOk / rows.length).toFixed(1)}%)`);
console.log("  by voice:", Object.entries(byAcc).map(([k, v]) => `${k} ${v.exact}/${v.ok}/${v.n}`).join("  "), "(exact/request/clips)");
if (process.argv.includes("--show")) for (const n of [...new Set(res.map((r) => r.n))]) { const g = res.filter((r) => r.n === n); console.log(`\n"${g[0].text}" request ${g.filter((r) => r.ok).length}/${g.length}`); for (const r of g) console.log(`   ${r.ok ? " " : "✗"} ${r.accent.padEnd(6)} ${r.heard}`); }
if (out) writeFileSync(out, res.map((x) => JSON.stringify(x)).join("\n") + "\n");
